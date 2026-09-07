import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  APPLICATION_SCHEMA_VERSION,
  openCommentDatabase,
} from "../src/database/comment-database.js";
import {
  DEFAULT_RAW_ROOT,
  computeRawPayloadSha256,
  parseAndValidateRawSnapshotBytes,
} from "../src/raw-snapshot/raw-snapshot-contract.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "raw-snapshot-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
    rawRoot: path.join(root, "raw-snapshots"),
    inputPath: path.join(root, "snapshot.json"),
  };
}

function runCli(command, args, options = {}) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
  });
}

function writeBytes(filePath, bytes) {
  fs.writeFileSync(filePath, bytes);
  return Buffer.from(bytes);
}

function writeRaw(filePath, payload, formatting = null) {
  const bytes = Buffer.from(formatting ?? (JSON.stringify(payload, null, 2) + "\n"), "utf8");
  writeBytes(filePath, bytes);
  return bytes;
}

function query(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all(...parameters);
  } finally {
    db.close();
  }
}

function scalar(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).get(...parameters);
  } finally {
    db.close();
  }
}

function makeComment(overrides = {}) {
  return {
    level: 0,
    commentId: "comment-1",
    videoId: "video-1",
    parentCommentId: "",
    username: " user ",
    handle: "@handle",
    userId: "user-id",
    avatarUrl: "https://avatar.invalid/comment",
    comment: "  本文、é/é  ",
    postedAt: "58分前",
    createTime: 1725499425,
    createdAt: "2026-09-05T00:00:00+09:00",
    postedDate: "2026-09-05",
    likeCount: 2,
    replyCount: null,
    ...overrides,
  };
}

function makeRaw(overrides = {}) {
  const payload = {
    schemaVersion: 1,
    extractedAt: "2026-09-05T00:00:00+09:00",
    source: {
      pageUrl: "https://www.tiktok.com/@example/video/1",
      canonicalUrl: "https://www.tiktok.com/@example/video/1",
      itemSource: "fixture",
      topLevelKeys: ["schemaVersion", "video"],
    },
    video: {
      id: "video-1",
      url: "https://video.invalid/1",
      canonicalUrl: "https://www.tiktok.com/@example/video/1",
      shareUrl: "",
      embedUrl: "",
      title: "title",
      description: "description",
      createTime: "1725499425",
      publishedAt: "2026-09-04T15:00:00Z",
      publishedDate: "2026-09-04",
      regionCode: "JP",
      duration: 12.5,
      width: 1080,
      height: 1920,
      ratio: "9:16",
      coverUrl: "",
      dynamicCoverUrl: "",
      originCoverUrl: "",
      playbackUrl: "",
      downloadUrl: "",
      isAigc: null,
      isStemVerified: null,
      voiceToText: "",
      playlistId: "",
      labels: [],
      tags: [],
    },
    stats: {
      viewCount: 1,
      likeCount: 2,
      commentCount: 3,
      shareCount: 4,
      favoriteCount: 5,
    },
    author: {
      id: "author-1",
      secUid: "private-profile-value",
      username: "author-name",
      nickname: "author nickname",
      signature: "private signature",
      verified: false,
      privateAccount: true,
      avatarUrl: "https://avatar.invalid/author",
      stats: {
        followerCount: 1,
        followingCount: 2,
        friendCount: 3,
        heartCount: 4,
        videoCount: 5,
        diggCount: 6,
      },
    },
    music: null,
    hashtags: [{ name: "tag" }],
    hashtagDetails: [{ name: "tag", private: "value" }],
    mentions: [],
    effects: [],
    stickers: [],
    comments: {
      loadedCount: 1,
      reportedCount: 10,
      note: "partial load",
      items: [makeComment()],
    },
  };
  return {
    ...payload,
    ...overrides,
    source: { ...payload.source, ...(overrides.source ?? {}) },
    video: { ...payload.video, ...(overrides.video ?? {}) },
    stats: { ...payload.stats, ...(overrides.stats ?? {}) },
    author: { ...payload.author, ...(overrides.author ?? {}) },
    comments: { ...payload.comments, ...(overrides.comments ?? {}) },
  };
}

test("validates raw schema and preserves exact bytes in the content-addressed store", (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const raw = makeRaw();
  const bytes = writeRaw(inputPath, raw);
  const expectedSha = createHash("sha256").update(bytes).digest("hex");
  const result = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp("^imported payload=" + expectedSha + " comments=1\\n$"));
  const rawPath = path.join(rawRoot, "tiktok-v1", expectedSha + ".json");
  assert.deepEqual(fs.readFileSync(rawPath), bytes);
  assert.equal(scalar(dbPath, "PRAGMA user_version").user_version, APPLICATION_SCHEMA_VERSION);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_snapshots").count, 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_video_observations").count, 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_comment_observations").count, 1);
});

test("rejects invalid schema, invalid UTF-8, loaded count mismatch, and conflicting video IDs before writes", (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const invalidPayloads = [
    makeRaw({ comments: { loadedCount: 2 } }),
    makeRaw({ comments: { items: [makeComment({ videoId: "video-2" })] } }),
    makeRaw({ video: { unknown: true } }),
  ];
  for (const payload of invalidPayloads) {
    writeRaw(inputPath, payload);
    const result = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /VALIDATION_ERROR/);
  }
  writeBytes(inputPath, Buffer.from([0xc3, 0x28]));
  const invalidUtf8 = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(invalidUtf8.status, 1);
  assert.match(invalidUtf8.stderr, /VALIDATION_ERROR/);
  assert.equal(fs.existsSync(path.join(rawRoot, "tiktok-v1")), false);
  assert.equal(fs.existsSync(dbPath), false);
});

test("applies effective IDs without trimming and keeps all observation values and null counts", (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const comment = makeComment({
    commentId: " ",
    videoId: "",
    username: "\tユーザー\n",
    handle: " @exact ",
    comment: "  value  ",
    postedAt: "not parsed",
    postedDate: "",
    likeCount: null,
  });
  const raw = makeRaw({
    video: { id: "" },
    author: { id: "" },
    comments: { items: [comment] },
  });
  writeRaw(inputPath, raw);
  const result = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM videos").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM authors").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comments").count, 0);
  const stored = scalar(dbPath, "SELECT video_pk, author_pk, video_id_raw FROM snapshot_video_observations");
  assert.equal(stored.video_pk, null);
  assert.equal(stored.author_pk, null);
  assert.equal(stored.video_id_raw, "");
  const observation = scalar(dbPath, "SELECT username, handle, comment_text, posted_at, posted_date, like_count, reply_count, user_id_raw FROM snapshot_comment_observations");
  assert.deepEqual({ ...observation }, {
    username: "\tユーザー\n",
    handle: " @exact ",
    comment_text: "  value  ",
    posted_at: "not parsed",
    posted_date: "",
    like_count: null,
    reply_count: null,
    user_id_raw: "user-id",
  });
});

test("creates one effective video master from non-empty comment video IDs and keeps repeated comment observations", (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const sharedComment = makeComment({ commentId: "shared-comment", videoId: "video-from-comment" });
  const raw = makeRaw({
    video: { id: "" },
    comments: {
      loadedCount: 2,
      items: [sharedComment, { ...sharedComment, username: "second observation" }],
    },
  });
  writeRaw(inputPath, raw);
  const result = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    query(dbPath, "SELECT external_video_id FROM videos").map((row) => row.external_video_id),
    ["video-from-comment"],
  );
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comments").count, 1);
  assert.deepEqual(
    query(dbPath, "SELECT comment_pk, source_index FROM snapshot_comment_observations ORDER BY source_index")
      .map((row) => [row.comment_pk !== null, row.source_index]),
    [[true, 0], [true, 1]],
  );
});

test("preserves empty raw comment payloads and verifies count integrity", (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const raw = makeRaw({ comments: { loadedCount: 0, items: [] } });
  writeRaw(inputPath, raw);
  const imported = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(imported.status, 0, imported.stderr);
  const verified = runCli("verify-raw-store", ["--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_comment_observations").count, 0);
  const sha = verified.stdout.match(/verified snapshots=1/);
  assert.ok(sha);

  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE raw_snapshots SET loaded_count = 1").run();
  db.close();
  const corruptedDb = runCli("verify-raw-store", ["--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(corruptedDb.status, 1);
  assert.match(corruptedDb.stderr, /DATABASE_INTEGRITY_ERROR/);
});

test("reimports the same bytes idempotently and keeps semantically same different bytes as another snapshot", (t) => {
  const { dbPath, rawRoot, inputPath, root } = makeCase(t);
  const raw = makeRaw();
  const firstBytes = writeRaw(inputPath, raw);
  const first = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(first.status, 0, first.stderr);
  const firstSha = computeRawPayloadSha256(firstBytes);
  const repeated = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, new RegExp("^already imported payload=" + firstSha + " comments=1\\n$"));

  const secondPath = path.join(root, "reformatted.json");
  const secondBytes = writeRaw(secondPath, raw, JSON.stringify({ comments: raw.comments, effects: raw.effects, schemaVersion: raw.schemaVersion, ...raw }) + "\n");
  const second = runCli("import-raw-snapshot", ["--input", secondPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(computeRawPayloadSha256(secondBytes), firstSha);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_snapshots").count, 2);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_comment_observations").count, 2);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM videos").count, 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comments").count, 1);
});

test("detects an existing corrupt content-addressed target", (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const bytes = writeRaw(inputPath, makeRaw());
  const sha = computeRawPayloadSha256(bytes);
  const first = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(first.status, 0, first.stderr);
  fs.writeFileSync(path.join(rawRoot, "tiktok-v1", sha + ".json"), "corrupt");
  const result = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RAW_STORE_CORRUPT/);
});

test("rolls back v2 rows after raw publication when the database transaction fails", async (t) => {
  const { dbPath, rawRoot, inputPath } = makeCase(t);
  const db = await openCommentDatabase(dbPath);
  db.exec(
    "CREATE TRIGGER test_fail_second_raw_observation\n" +
    "BEFORE INSERT ON snapshot_comment_observations\n" +
    "WHEN NEW.source_index = 1\n" +
    "BEGIN\n" +
    "  SELECT RAISE(ABORT, 'controlled test failure');\n" +
    "END;",
  );
  db.close();
  const raw = makeRaw({
    comments: {
      loadedCount: 2,
      items: [makeComment(), makeComment({ commentId: "comment-2" })],
    },
  });
  const bytes = writeRaw(inputPath, raw);
  const result = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /IMPORT_FAILED/);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_snapshots").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM videos").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM authors").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comments").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_comment_observations").count, 0);
  assert.equal(fs.existsSync(path.join(rawRoot, "tiktok-v1", computeRawPayloadSha256(bytes) + ".json")), true);
});

test("verifies referenced raw files and ignores orphan files", (t) => {
  const { dbPath, rawRoot, inputPath, root } = makeCase(t);
  const bytes = writeRaw(inputPath, makeRaw());
  const sha = computeRawPayloadSha256(bytes);
  const imported = runCli("import-raw-snapshot", ["--input", inputPath, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(imported.status, 0, imported.stderr);
  fs.writeFileSync(path.join(rawRoot, "orphan.json"), "orphan");
  let result = runCli("verify-raw-store", ["--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified snapshots=1/);
  fs.unlinkSync(path.join(rawRoot, "tiktok-v1", sha + ".json"));
  result = runCli("verify-raw-store", ["--snapshot-sha", sha, "--db", dbPath, "--raw-root", rawRoot]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RAW_STORE_CORRUPT/);
  assert.equal(fs.existsSync(path.join(rawRoot, "orphan.json")), true);
});

test("raw schema validator exposes draft 2020-12 validation and accepts arbitrary reported count", () => {
  const raw = makeRaw({ comments: { reportedCount: -100 } });
  assert.deepEqual(parseAndValidateRawSnapshotBytes(Buffer.from(JSON.stringify(raw))).payload, raw);
  assert.equal(DEFAULT_RAW_ROOT.endsWith(path.join("var", "raw-snapshots")), true);
});

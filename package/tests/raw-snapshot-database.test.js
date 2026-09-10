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
  MIGRATIONS_DIR,
  backfillRawInputs,
  importRawInput,
  importRawSnapshotBytes,
  openCommentDatabase,
} from "../src/database/comment-database.js";
import {
  computeRawPayloadSha256,
  parseAndValidateRawSnapshotBytes,
  rawSnapshotRelativePath,
} from "../src/raw-snapshot/raw-snapshot-contract.js";
import { readRawInput, verifyRawInputs } from "../src/database/raw-snapshot-repository.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "raw-snapshot-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
    inputPath: path.join(root, "snapshot.json"),
    rawRoot: path.join(root, "legacy-raw"),
  };
}

function runCli(command, args, options = {}) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
  });
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

function writeRaw(filePath, payload, formatting = null) {
  const bytes = Buffer.from(formatting ?? `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return bytes;
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

function makeSnapshotDto(number, overrides = {}) {
  const comments = overrides.comments ?? [{
    externalCommentId: `comment-${number}`,
    level: 0,
    commentIdRaw: `comment-${number}`,
    videoIdRaw: `video-${number}`,
    parentCommentIdRaw: "",
    username: `user-${number}`,
    handle: `@handle-${number}`,
    userIdRaw: `user-id-${number}`,
    commentText: `comment-${number}`,
    postedAt: `posted-${number}`,
    createdAt: `created-${number}`,
    postedDate: `date-${number}`,
    likeCount: null,
    replyCount: null,
  }];
  const base = {
    materializationKind: "rich-snapshot",
    platform: "tiktok",
    extractedAt: `2026-09-05T00:00:0${number}Z`,
    sourcePageUrl: `page-${number}`,
    sourceCanonicalUrl: `canonical-${number}`,
    itemSource: "fixture",
    loadedCount: comments.length,
    reportedCount: 100 + number,
    coverageNote: `coverage-${number}`,
    video: {
      externalVideoId: `video-${number}`,
      externalAuthorId: `author-${number}`,
      videoIdRaw: `video-${number}`,
      canonicalUrl: `video-canonical-${number}`,
      title: `title-${number}`,
      description: `description-${number}`,
      publishedAt: `published-${number}`,
      publishedDate: `published-date-${number}`,
      regionCode: "JP",
      duration: 1,
      viewCount: 1,
      likeCount: 2,
      commentCount: 3,
      shareCount: 4,
      favoriteCount: 5,
    },
    comments,
  };
  return {
    ...base,
    ...overrides,
    loadedCount: overrides.loadedCount ?? comments.length,
    video: { ...base.video, ...(overrides.video ?? {}) },
    comments,
  };
}

function createV2Fixture(caseData, bytes) {
  const payloadSha256 = computeRawPayloadSha256(bytes);
  const rawRelpath = rawSnapshotRelativePath(payloadSha256);
  fs.mkdirSync(path.dirname(path.join(caseData.rawRoot, rawRelpath)), { recursive: true });
  fs.writeFileSync(path.join(caseData.rawRoot, rawRelpath), bytes);

  const db = new DatabaseSync(caseData.dbPath);
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "001-init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "002-raw-snapshots.sql"), "utf8"));
  db.prepare(
    `INSERT INTO raw_snapshots
      (platform, raw_schema_version, payload_sha256, raw_relpath, extracted_at,
       source_page_url, source_canonical_url, item_source, loaded_count,
       reported_count, coverage_note, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "tiktok", 1, payloadSha256, rawRelpath, "2026-09-05T00:00:00.000Z",
    "page", "canonical", "fixture", 1, 10, "coverage", "2026-09-05T01:00:00.000Z",
  );
  db.prepare("INSERT INTO videos (platform, external_video_id) VALUES (?, ?)").run("tiktok", "video-1");
  db.prepare("INSERT INTO authors (platform, external_author_id) VALUES (?, ?)").run("tiktok", "author-1");
  db.prepare(
    `INSERT INTO snapshot_video_observations
      (snapshot_id, video_pk, author_pk, video_id_raw, canonical_url, title,
       description, published_at, published_date, region_code, duration,
       view_count, like_count, comment_count, share_count, favorite_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 1, 1, "video-1", "canonical", "title", "description", "published", "date", "JP", 1, 1, 2, 3, 4, 5);
  db.prepare("INSERT INTO comments (video_pk, external_comment_id) VALUES (?, ?)").run(1, "comment-1");
  db.prepare(
    `INSERT INTO snapshot_comment_observations
      (snapshot_id, source_index, comment_pk, level, comment_id_raw, video_id_raw,
       parent_comment_id_raw, username, handle, user_id_raw, comment_text,
       posted_at, created_at, posted_date, like_count, reply_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 0, 1, 0, "comment-1", "video-1", "", "user", "@user", "user-id", "body", "posted", "created", "date", 2, null);
  db.close();
  return { payloadSha256, rawRelpath };
}

function richRowCounts(dbPath) {
  return {
    rawInputs: scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_inputs").count,
    snapshots: scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_snapshots").count,
    videos: scalar(dbPath, "SELECT COUNT(*) AS count FROM videos").count,
    authors: scalar(dbPath, "SELECT COUNT(*) AS count FROM authors").count,
    comments: scalar(dbPath, "SELECT COUNT(*) AS count FROM comments").count,
    videoObservations: scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_video_observations").count,
    commentObservations: scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_comment_observations").count,
  };
}

test("stores exact raw bytes in SQLite and maps the single-snapshot adapter", async (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const raw = makeRaw();
  const bytes = writeRaw(inputPath, raw);
  const result = await importRawSnapshotBytes(bytes, { dbPath });
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(result.status, "imported");
  assert.equal(result.payloadSha256, sha);
  assert.deepEqual(query(dbPath, "SELECT payload_sha256, byte_length, input_format FROM raw_inputs").map((row) => ({ ...row })), [
    { payload_sha256: sha, byte_length: bytes.length, input_format: "tiktokRawSnapshot-1.0.0" },
  ]);
  const stored = scalar(dbPath, "SELECT payload_bytes FROM raw_inputs");
  assert.deepEqual(Buffer.from(stored.payload_bytes), bytes);
  assert.deepEqual(query(dbPath, "SELECT snapshot_index, payload_sha256 FROM raw_snapshots").map((row) => ({ ...row })), [{ snapshot_index: 0, payload_sha256: sha }]);
  assert.equal(fs.existsSync(path.join(root, "tiktok-v1")), false);
  assert.equal(scalar(dbPath, "PRAGMA user_version").user_version, APPLICATION_SCHEMA_VERSION);
});

test("rejects invalid raw inputs before persistent writes and preserves effective-ID semantics", async (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const invalidBytes = [
    Buffer.from(JSON.stringify(makeRaw({ comments: { loadedCount: 2 } })), "utf8"),
    Buffer.from(JSON.stringify(makeRaw({ comments: { items: [makeComment({ videoId: "video-2" })] } })), "utf8"),
    Buffer.from(JSON.stringify(makeRaw({ video: { unknown: true } })), "utf8"),
    Buffer.from([0xc3, 0x28]),
  ];
  for (const bytes of invalidBytes) {
    await assert.rejects(importRawSnapshotBytes(bytes, { dbPath }), /VALIDATION_ERROR/);
  }
  assert.equal(fs.existsSync(dbPath), false);

  const exact = makeRaw({
    video: { id: "" },
    author: { id: "" },
    comments: {
      items: [makeComment({ commentId: " ", videoId: "", username: "\tユーザー\n", handle: " @exact ", comment: "  value  ", postedAt: "not parsed", postedDate: "", likeCount: null })],
    },
  });
  const bytes = writeRaw(inputPath, exact);
  await importRawSnapshotBytes(bytes, { dbPath });
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM videos").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM authors").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comments").count, 0);
  assert.deepEqual({ ...scalar(dbPath, "SELECT video_pk, author_pk, video_id_raw FROM snapshot_video_observations") }, {
    video_pk: null, author_pk: null, video_id_raw: "",
  });
  assert.deepEqual({ ...scalar(dbPath, "SELECT username, handle, comment_text, posted_at, posted_date, like_count, reply_count, user_id_raw FROM snapshot_comment_observations") }, {
    username: "\tユーザー\n", handle: " @exact ", comment_text: "  value  ", posted_at: "not parsed", posted_date: "", like_count: null, reply_count: null, user_id_raw: "user-id",
  });
});

test("supports repeated observations and empty comment payloads", async (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const repeated = makeRaw({
    video: { id: "" },
    comments: {
      loadedCount: 2,
      items: [makeComment({ commentId: "shared", videoId: "video-from-comment" }), makeComment({ commentId: "shared", videoId: "video-from-comment", username: "second" })],
    },
  });
  const repeatedBytes = writeRaw(inputPath, repeated);
  await importRawSnapshotBytes(repeatedBytes, { dbPath });
  assert.deepEqual(query(dbPath, "SELECT external_video_id FROM videos").map((row) => ({ ...row })), [{ external_video_id: "video-from-comment" }]);
  assert.deepEqual(query(dbPath, "SELECT source_index, comment_pk IS NOT NULL AS linked FROM snapshot_comment_observations ORDER BY source_index").map((row) => ({ ...row })), [
    { source_index: 0, linked: 1 }, { source_index: 1, linked: 1 },
  ]);

  const emptyBytes = writeRaw(inputPath, makeRaw({ comments: { loadedCount: 0, items: [] } }));
  await importRawSnapshotBytes(emptyBytes, { dbPath });
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM snapshot_comment_observations").count, 2);
  const db = await openCommentDatabase(dbPath);
  try {
    assert.deepEqual(verifyRawInputs(db), { status: "verified", rawInputCount: 2, snapshotCount: 2 });
  } finally {
    db.close();
  }
});

test("reimports exact bytes idempotently, separates byte-different JSON, and fails closed on conflicts", async (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const raw = makeRaw();
  const firstBytes = writeRaw(inputPath, raw);
  const first = await importRawSnapshotBytes(firstBytes, { dbPath });
  const repeated = await importRawSnapshotBytes(firstBytes, { dbPath });
  assert.equal(repeated.status, "already-imported");
  assert.deepEqual(richRowCounts(dbPath), {
    rawInputs: 1, snapshots: 1, videos: 1, authors: 1, comments: 1, videoObservations: 1, commentObservations: 1,
  });

  const secondBytes = writeRaw(path.join(root, "reformatted.json"), raw, JSON.stringify({ ...raw, hashtags: [], music: null }) + "\n");
  assert.notEqual(computeRawPayloadSha256(secondBytes), first.payloadSha256);
  await importRawSnapshotBytes(secondBytes, { dbPath });
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_inputs").count, 2);

  const parsed = parseAndValidateRawSnapshotBytes(firstBytes);
  const changedDto = makeSnapshotDto(99);
  const originalDto = {
    materializationKind: "rich-snapshot",
    platform: "tiktok",
    extractedAt: parsed.payload.extractedAt,
    sourcePageUrl: parsed.payload.source.pageUrl,
    sourceCanonicalUrl: parsed.payload.source.canonicalUrl,
    itemSource: parsed.payload.source.itemSource,
    loadedCount: 1,
    reportedCount: 10,
    coverageNote: "partial load",
    video: {
      externalVideoId: "video-1", externalAuthorId: "author-1", videoIdRaw: "video-1", canonicalUrl: parsed.payload.video.canonicalUrl,
      title: "title", description: "description", publishedAt: "2026-09-04T15:00:00Z", publishedDate: "2026-09-04", regionCode: "JP", duration: 12.5,
      viewCount: 1, likeCount: 2, commentCount: 3, shareCount: 4, favoriteCount: 5,
    },
    comments: [{
      externalCommentId: "comment-1", level: 0, commentIdRaw: "comment-1", videoIdRaw: "video-1", parentCommentIdRaw: "", username: " user ", handle: "@handle", userIdRaw: "user-id", commentText: "  本文、é/é  ", postedAt: "58分前", createdAt: "2026-09-05T00:00:00+09:00", postedDate: "2026-09-05", likeCount: 2, replyCount: null,
    }],
  };
  await assert.rejects(
    importRawInput({ payloadBytes: firstBytes, inputFormat: "tiktokRawSnapshot-1.0.0", snapshots: [{ ...originalDto, comments: [{ ...originalDto.comments[0], commentText: "changed" }] }] }, { dbPath }),
    /RAW_INPUT_MATERIALIZATION_CONFLICT/,
  );
  await assert.rejects(
    importRawInput({ payloadBytes: firstBytes, inputFormat: "other-format", snapshots: [originalDto] }, { dbPath }),
    /RAW_INPUT_CONFLICT/,
  );
  assert.equal(changedDto.video.externalVideoId, "video-99");
});

test("stores one raw input with multiple snapshots and rolls back all state on failure", async (t) => {
  const caseData = makeCase(t);
  const { dbPath } = caseData;
  const request = {
    payloadBytes: Buffer.from("{\"rich\":true}", "utf8"),
    inputFormat: "collector-wrapper-1.0.0",
    snapshots: [makeSnapshotDto(1), makeSnapshotDto(2)],
  };
  const imported = await importRawInput(request, { dbPath });
  assert.equal(imported.snapshotCount, 2);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM raw_inputs").count, 1);
  assert.deepEqual(query(dbPath, "SELECT payload_sha256, snapshot_index FROM raw_snapshots ORDER BY snapshot_index").map((row) => ({ ...row })), [
    { payload_sha256: imported.payloadSha256, snapshot_index: 0 },
    { payload_sha256: imported.payloadSha256, snapshot_index: 1 },
  ]);
  assert.deepEqual(query(dbPath, "SELECT snapshot_id, source_index FROM snapshot_comment_observations ORDER BY snapshot_id, source_index").map((row) => ({ ...row })), [
    { snapshot_id: 1, source_index: 0 }, { snapshot_id: 2, source_index: 0 },
  ]);
  assert.deepEqual(query(dbPath, "SELECT platform, external_video_id FROM videos ORDER BY video_pk").map((row) => ({ ...row })), [
    { platform: "tiktok", external_video_id: "video-1" }, { platform: "tiktok", external_video_id: "video-2" },
  ]);
  const ambiguous = runCli("verify-raw-inputs", ["--snapshot-sha", imported.payloadSha256, "--db", dbPath]);
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /SNAPSHOT_SELECTION_AMBIGUOUS/);

  const failingDbPath = path.join(caseData.root, "failing.sqlite3");
  const db = await openCommentDatabase(failingDbPath);
  db.exec(`
    CREATE TRIGGER test_fail_second_snapshot
    BEFORE INSERT ON raw_snapshots
    WHEN NEW.snapshot_index = 1
    BEGIN
      SELECT RAISE(ABORT, 'controlled test failure');
    END;
  `);
  db.close();
  await assert.rejects(importRawInput(request, { dbPath: failingDbPath }), /IMPORT_FAILED/);
  assert.deepEqual(richRowCounts(failingDbPath), {
    rawInputs: 0, snapshots: 0, videos: 0, authors: 0, comments: 0, videoObservations: 0, commentObservations: 0,
  });
});

test("returns exact raw bytes and recovers rich-only fields without a filesystem", async (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const raw = makeRaw({ author: { signature: "rich signature" }, hashtags: [{ name: "rich-tag" }] });
  const bytes = writeRaw(inputPath, raw);
  const imported = await importRawSnapshotBytes(bytes, { dbPath });
  fs.rmSync(path.join(root, "tiktok-v1"), { recursive: true, force: true });
  const db = await openCommentDatabase(dbPath);
  try {
    const result = readRawInput(db, imported.payloadSha256);
    assert.deepEqual(result.payloadBytes, bytes);
    const recovered = parseAndValidateRawSnapshotBytes(result.payloadBytes).payload;
    assert.equal(recovered.author.signature, "rich signature");
    assert.equal(recovered.hashtags[0].name, "rich-tag");
  } finally {
    db.close();
  }
});

test("detects BLOB and normalized integrity corruption", async (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const bytes = writeRaw(inputPath, makeRaw());
  await importRawSnapshotBytes(bytes, { dbPath });
  let db = await openCommentDatabase(dbPath);
  db.prepare("UPDATE raw_inputs SET payload_bytes = ?").run(Buffer.alloc(bytes.length, 88));
  assert.throws(() => readRawInput(db, computeRawPayloadSha256(bytes)), /DATABASE_INTEGRITY_ERROR/);
  db.close();

  db = await openCommentDatabase(dbPath);
  db.prepare("UPDATE raw_inputs SET payload_bytes = ?").run(bytes);
  db.prepare("UPDATE raw_snapshots SET loaded_count = 2").run();
  assert.throws(() => verifyRawInputs(db), /DATABASE_INTEGRITY_ERROR/);
  db.close();
});

test("migrates a populated v2 database only with verified legacy raw bytes", async (t) => {
  const caseData = makeCase(t);
  const bytes = writeRaw(caseData.inputPath, makeRaw());
  const legacy = createV2Fixture(caseData, bytes);
  const result = await backfillRawInputs({ dbPath: caseData.dbPath, rawRoot: caseData.rawRoot });
  assert.deepEqual(result, { status: "migrated", schemaVersion: 8 });
  assert.equal(scalar(caseData.dbPath, "PRAGMA user_version").user_version, 8);
  assert.deepEqual(Buffer.from(scalar(caseData.dbPath, "SELECT payload_bytes FROM raw_inputs").payload_bytes), bytes);
  assert.deepEqual({ ...scalar(caseData.dbPath, "SELECT snapshot_id, observation_id, snapshot_index FROM raw_snapshots JOIN snapshot_comment_observations USING (snapshot_id)") }, {
    snapshot_id: 1, observation_id: 1, snapshot_index: 0,
  });
  assert.deepEqual({ ...scalar(caseData.dbPath, "SELECT video_pk, author_pk FROM snapshot_video_observations") }, {
    video_pk: 1, author_pk: 1,
  });
  assert.deepEqual({ ...scalar(caseData.dbPath, "SELECT comment_pk, comment_text FROM snapshot_comment_observations") }, {
    comment_pk: 1, comment_text: "body",
  });
  fs.rmSync(caseData.rawRoot, { recursive: true, force: true });
  const db = await openCommentDatabase(caseData.dbPath);
  try {
    assert.deepEqual(readRawInput(db, legacy.payloadSha256).payloadBytes, bytes);
    assert.deepEqual(verifyRawInputs(db), { status: "verified", rawInputCount: 1, snapshotCount: 1 });
  } finally {
    db.close();
  }
  assert.deepEqual(query(caseData.dbPath, "SELECT name FROM pragma_table_info('raw_snapshots') ORDER BY cid").map((row) => row.name), [
    "snapshot_id", "materialization_kind", "platform", "payload_sha256", "snapshot_index", "extracted_at", "source_page_url", "source_canonical_url", "item_source", "loaded_count", "reported_count", "coverage_note",
  ]);
});

test("rejects normal open and failed backfills without changing populated v2", async (t) => {
  const makePopulated = () => {
    const caseData = makeCase(t);
    const bytes = writeRaw(caseData.inputPath, makeRaw());
    createV2Fixture(caseData, bytes);
    return { caseData, bytes };
  };

  const normal = makePopulated();
  await assert.rejects(openCommentDatabase(normal.caseData.dbPath), /RAW_INPUT_BACKFILL_REQUIRED/);
  assert.equal(scalar(normal.caseData.dbPath, "PRAGMA user_version").user_version, 2);
  assert.equal(scalar(normal.caseData.dbPath, "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'raw_inputs'").count, 0);

  const missing = makePopulated();
  await assert.rejects(backfillRawInputs({ dbPath: missing.caseData.dbPath, rawRoot: path.join(missing.caseData.root, "missing") }), /LEGACY_RAW_INPUT_MISSING/);
  assert.equal(scalar(missing.caseData.dbPath, "PRAGMA user_version").user_version, 2);

  const mismatch = makePopulated();
  fs.writeFileSync(path.join(mismatch.caseData.rawRoot, "tiktok-v1", fs.readdirSync(path.join(mismatch.caseData.rawRoot, "tiktok-v1"))[0]), "wrong");
  await assert.rejects(backfillRawInputs({ dbPath: mismatch.caseData.dbPath, rawRoot: mismatch.caseData.rawRoot }), /LEGACY_RAW_INPUT_MISMATCH/);
  assert.equal(scalar(mismatch.caseData.dbPath, "PRAGMA user_version").user_version, 2);

  const changed = makePopulated();
  await assert.rejects(backfillRawInputs({
    dbPath: changed.caseData.dbPath,
    rawRoot: changed.caseData.rawRoot,
    afterPrepare(db) {
      db.prepare("UPDATE raw_snapshots SET raw_relpath = ?").run("changed");
    },
  }), /MIGRATION_SOURCE_CHANGED/);
  assert.equal(scalar(changed.caseData.dbPath, "PRAGMA user_version").user_version, 2);
});

test("auto-migrates an empty v2 database and makes backfill idempotent on v8", async (t) => {
  const caseData = makeCase(t);
  const db = new DatabaseSync(caseData.dbPath);
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "001-init.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "002-raw-snapshots.sql"), "utf8"));
  db.close();
  const opened = await openCommentDatabase(caseData.dbPath);
  opened.close();
  assert.equal(scalar(caseData.dbPath, "PRAGMA user_version").user_version, 8);
  const result = await backfillRawInputs({ dbPath: caseData.dbPath, rawRoot: caseData.rawRoot });
  assert.deepEqual(result, { status: "already-migrated", schemaVersion: 8 });
});

test("exposes backfill through the CLI and requires both migration paths", (t) => {
  const caseData = makeCase(t);
  let result = runCli("backfill-raw-inputs", ["--db", caseData.dbPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
  result = runCli("backfill-raw-inputs", ["--raw-root", caseData.rawRoot]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
});

test("validates the raw contract and exposes no filesystem store API", () => {
  const raw = makeRaw({ comments: { reportedCount: -100 } });
  assert.deepEqual(parseAndValidateRawSnapshotBytes(Buffer.from(JSON.stringify(raw))).payload, raw);
  assert.equal(typeof rawSnapshotRelativePath("a".repeat(64)), "string");
});

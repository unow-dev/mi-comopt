import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  adaptNewCommentsWrapperBytes,
  mapNewCommentsWrapperToSnapshots,
} from "../src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js";
import {
  NEW_COMMENTS_WRAPPER_INPUT_FORMAT,
  NewCommentsWrapperContractError,
  parseAndValidateNewCommentsWrapperBytes,
  validateNewCommentsWrapper,
} from "../src/collector/new-comments-wrapper/new-comments-wrapper-contract.js";
import {
  APPLICATION_SCHEMA_VERSION,
  importRawInput,
  importRawSnapshotBytes,
  openCommentDatabase,
} from "../src/database/comment-database.js";
import { readRawInput, readSelectedSnapshots } from "../src/database/raw-snapshot-repository.js";
import {
  buildAnalysisArtifacts,
  DATABASE_SCHEMA_VERSION,
} from "../src/processing/analysis-input/raw-snapshot-projection.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const fixturePath = path.join(
  repositoryRoot,
  "docs/active/issues/20260907-new-comments-dto-adapter/new-comments-dto-adapter-handoff/fixtures/representative-v1.json",
);
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");
const fixtureBytes = fs.readFileSync(fixturePath);

function fixturePayload() {
  return JSON.parse(fixtureBytes.toString("utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "new-comments-wrapper-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
    inputPath: path.join(root, "new-comments.json"),
  };
}

function query(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all(...parameters);
  } finally {
    db.close();
  }
}

function runCli(command, args) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

test("wrapper contract accepts the representative fixture and observed nullable metadata", () => {
  const parsed = parseAndValidateNewCommentsWrapperBytes(fixtureBytes);
  assert.equal(parsed.payload.items.length, 2);
  assert.equal(parsed.payload.items[0].comments.reportedCount, null);
  assert.equal(parsed.payload.items[0].video.duration, null);
  assert.equal(parsed.payload.items[0].stats.viewCount, null);
  assert.equal(parsed.payload.items[0].author.stats.followerCount, null);
  assert.equal(parsed.payload.items[0].music.duration, null);
});

test("wrapper contract rejects invalid encoding, JSON, shape, and semantic invariants", () => {
  assert.throws(
    () => parseAndValidateNewCommentsWrapperBytes(Buffer.from([0xc3, 0x28])),
    (error) => error instanceof NewCommentsWrapperContractError && /UTF-8/.test(error.message),
  );
  assert.throws(() => parseAndValidateNewCommentsWrapperBytes(Buffer.from("not json", "utf8")), /JSON/);

  const invalidCases = [
    {
      name: "unknown root key",
      mutate(payload) { payload.extra = true; },
      pattern: /extra/,
    },
    {
      name: "unknown item key",
      mutate(payload) { payload.items[0].extra = true; },
      pattern: /items\[0\].extra/,
    },
    {
      name: "unknown nested key",
      mutate(payload) { payload.items[0].comments.items[0].extra = true; },
      pattern: /items\[0\].comments\.items\[0\].extra/,
    },
    {
      name: "missing required field",
      mutate(payload) { delete payload.items[0].video.title; },
      pattern: /items\[0\]\.video\.title/,
    },
    {
      name: "wrong field type",
      mutate(payload) { payload.items[0].comments.loadedCount = "2"; },
      pattern: /loadedCount/,
    },
    {
      name: "empty items",
      mutate(payload) { payload.items = []; },
      pattern: /items/,
    },
    {
      name: "loaded count mismatch",
      mutate(payload) { payload.items[0].comments.loadedCount = 1; },
      pattern: /loadedCount.*items\.length/,
    },
    {
      name: "conflicting video IDs",
      mutate(payload) { payload.items[0].comments.items[0].videoId = "different-video"; },
      pattern: /conflicting.*video IDs/,
    },
  ];
  for (const invalidCase of invalidCases) {
    const payload = fixturePayload();
    invalidCase.mutate(payload);
    assert.throws(
      () => validateNewCommentsWrapper(payload),
      invalidCase.pattern,
      invalidCase.name,
    );
  }
});

test("wrapper contract permits an empty comment item list and opaque rich arrays", () => {
  const payload = fixturePayload();
  payload.items[0].comments.loadedCount = 0;
  payload.items[0].comments.items = [];
  payload.items[0].hashtags = [{ unknown: [1, null, "opaque"] }];
  payload.items[0].video.labels = [{ unknown: true }];
  payload.items[0].mentions = [null, "opaque"];
  assert.equal(validateNewCommentsWrapper(payload), payload);
});

test("adapter preserves bytes and source order while applying exact ID and null rules", () => {
  const payload = fixturePayload();
  payload.items[0].source.pageUrl = "  page URL  ";
  payload.items[0].video.title = "  title  ";
  payload.items[0].comments.items[0].comment = "  comment  ";
  payload.items[0].comments.items[0].postedAt = "  posted  ";
  payload.items[0].comments.items[0].commentId = "";
  payload.items[0].author.id = "";
  payload.items[0].video.id = "";
  payload.items[0].comments.items[0].videoId = "effective-video";
  payload.items[0].comments.items[1].videoId = "effective-video";
  payload.items[0].comments.reportedCount = null;
  payload.items[0].stats.commentCount = 999;
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const request = adaptNewCommentsWrapperBytes(bytes);
  const first = request.snapshots[0];

  assert.deepEqual(request.payloadBytes, bytes);
  assert.equal(request.inputFormat, NEW_COMMENTS_WRAPPER_INPUT_FORMAT);
  assert.deepEqual(request.snapshots.map((snapshot) => snapshot.video.title), ["  title  ", "fixture rich title"]);
  assert.deepEqual(first.comments.map((comment) => comment.commentText), ["  comment  ", "fixture comment 2"]);
  assert.equal(first.video.externalVideoId, "effective-video");
  assert.equal(first.video.externalAuthorId, null);
  assert.equal(first.comments[0].externalCommentId, null);
  assert.equal(first.comments[0].commentIdRaw, "");
  assert.equal(first.reportedCount, null);
  assert.equal(first.video.commentCount, 999);
  assert.equal(first.video.duration, null);
  assert.equal(first.comments[0].postedAt, "  posted  ");
  assert.equal(first.coverageNote, payload.items[0].comments.note);
});

test("adapter keeps duplicate observations and maps every item exactly once", () => {
  const payload = fixturePayload();
  payload.items[0].comments.items[1] = clone(payload.items[0].comments.items[0]);
  const snapshots = mapNewCommentsWrapperToSnapshots(validateNewCommentsWrapper(payload));
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].comments.length, 2);
  assert.deepEqual(
    snapshots[0].comments.map((comment) => comment.commentText),
    ["fixture comment 1", "fixture comment 1"],
  );
  assert.deepEqual(snapshots.map((snapshot) => snapshot.sourcePageUrl), [
    payload.items[0].source.pageUrl,
    payload.items[1].source.pageUrl,
  ]);
});

test("latest generic import preserves all seven nullable fields and distinguishes null from zero", async (t) => {
  const { dbPath } = makeCase(t);
  const request = adaptNewCommentsWrapperBytes(fixtureBytes);
  const imported = await importRawInput(request, { dbPath });
  assert.equal(imported.snapshotCount, 2);
  assert.equal(imported.commentObservationCount, 3);
  assert.equal(APPLICATION_SCHEMA_VERSION, 7);
  assert.equal(DATABASE_SCHEMA_VERSION, 7);
  assert.equal(query(dbPath, "PRAGMA user_version")[0].user_version, 7);
  assert.deepEqual(
    query(dbPath, "SELECT reported_count FROM raw_snapshots ORDER BY snapshot_index").map((row) => row.reported_count),
    [null, 294],
  );
  assert.deepEqual(
    query(dbPath, `SELECT duration, view_count, like_count, comment_count, share_count, favorite_count
      FROM snapshot_video_observations ORDER BY snapshot_id`).map((row) => ({ ...row })),
    [
      { duration: null, view_count: null, like_count: null, comment_count: null, share_count: null, favorite_count: null },
      { duration: 55, view_count: 181000, like_count: 13800, comment_count: 294, share_count: 245, favorite_count: 1111 },
    ],
  );

  const db = await openCommentDatabase(dbPath);
  try {
    assert.deepEqual(query(dbPath, "PRAGMA foreign_key_check"), []);
    const raw = readRawInput(db, imported.payloadSha256);
    assert.deepEqual(raw.payloadBytes, fixtureBytes);
    const selected = readSelectedSnapshots(db, [{ payloadSha256: imported.payloadSha256, snapshotIndex: 0 }]);
    assert.equal(selected[0].snapshot.reportedCount, null);
  } finally {
    db.close();
  }

  const changed = {
    ...request,
    snapshots: request.snapshots.map((snapshot, index) => index === 0 ? {
      ...snapshot,
      reportedCount: 0,
      video: {
        ...snapshot.video,
        duration: 0,
        viewCount: 0,
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
        favoriteCount: 0,
      },
    } : snapshot),
  };
  await assert.rejects(importRawInput(changed, { dbPath }), /RAW_INPUT_MATERIALIZATION_CONFLICT/);
});

test("wrapper CLI imports one raw input with ordered snapshots and connects to analysis projection", async (t) => {
  const { dbPath, inputPath } = makeCase(t);
  fs.writeFileSync(inputPath, fixtureBytes);
  const result = runCli("import-new-comments", ["--input", inputPath, "--db", dbPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^imported payload=[0-9a-f]{64} snapshots=2 comments=3\n$/);
  const sha = createHash("sha256").update(fixtureBytes).digest("hex");
  assert.deepEqual(
    query(dbPath, "SELECT payload_sha256, byte_length, input_format FROM raw_inputs").map((row) => ({ ...row })),
    [{ payload_sha256: sha, byte_length: fixtureBytes.length, input_format: NEW_COMMENTS_WRAPPER_INPUT_FORMAT }],
  );
  assert.deepEqual(
    query(dbPath, "SELECT snapshot_index, loaded_count FROM raw_snapshots ORDER BY snapshot_index").map((row) => ({ ...row })),
    [{ snapshot_index: 0, loaded_count: 2 }, { snapshot_index: 1, loaded_count: 1 }],
  );
  assert.deepEqual(
    query(dbPath, "SELECT snapshot_id, source_index FROM snapshot_comment_observations ORDER BY snapshot_id, source_index").map((row) => ({ ...row })),
    [{ snapshot_id: 1, source_index: 0 }, { snapshot_id: 1, source_index: 1 }, { snapshot_id: 2, source_index: 0 }],
  );
  const db = await openCommentDatabase(dbPath);
  try {
    const selected = readSelectedSnapshots(db, [
      { payloadSha256: sha, snapshotIndex: 0 },
      { payloadSha256: sha, snapshotIndex: 1 },
    ]);
    const artifacts = buildAnalysisArtifacts(selected);
    assert.equal(artifacts.manifest.database_schema_version, 7);
    assert.equal(artifacts.manifest.snapshots[0].reported_count, null);
    assert.match(artifacts.manifestJson, /"reported_count": null/);
  } finally {
    db.close();
  }
});

test("invalid wrapper item is rejected before any database materialization", async (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const payload = fixturePayload();
  payload.items[1].comments.note = 1;
  fs.writeFileSync(inputPath, JSON.stringify(payload), "utf8");
  const result = runCli("import-new-comments-wrapper", ["--input", inputPath, "--db", dbPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /items\[1\].*note/);
  assert.equal(fs.existsSync(dbPath), false);
});

test("legacy raw snapshot input remains strict and database/processing stay wrapper-independent", async (t) => {
  const { dbPath } = makeCase(t);
  const legacy = fixturePayload().items[0];
  const legacyLike = {
    schemaVersion: 1,
    extractedAt: legacy.extractedAt,
    source: legacy.source,
    video: legacy.video,
    stats: legacy.stats,
    author: legacy.author,
    music: legacy.music,
    hashtags: legacy.hashtags,
    hashtagDetails: legacy.hashtagDetails,
    mentions: legacy.mentions,
    effects: legacy.effects,
    stickers: legacy.stickers,
    comments: legacy.comments,
  };
  await assert.rejects(importRawSnapshotBytes(Buffer.from(JSON.stringify(legacyLike), "utf8"), { dbPath }), /VALIDATION_ERROR/);
  assert.equal(fs.existsSync(dbPath), false);

  const databaseSource = fs.readFileSync(path.join(packageRoot, "src/database/comment-database.js"), "utf8");
  const repositorySource = fs.readFileSync(path.join(packageRoot, "src/database/raw-snapshot-repository.js"), "utf8");
  const processingSource = fs.readFileSync(path.join(packageRoot, "src/processing/analysis-input/raw-snapshot-projection.js"), "utf8");
  assert.doesNotMatch(databaseSource, /new-comments-wrapper|collector-inputs/);
  assert.doesNotMatch(repositorySource, /new-comments-wrapper|collector-inputs/);
  assert.doesNotMatch(processingSource, /new-comments-wrapper|collector-inputs/);
});

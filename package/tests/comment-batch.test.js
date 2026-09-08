import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  adaptCommentBatchBytes,
  mapCommentBatchToSnapshot,
} from "../src/collector/comment-batch/comment-batch-adapter.js";
import { adaptNewCommentsWrapperBytes } from "../src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js";
import {
  COMMENT_BATCH_INPUT_FORMAT,
  CommentBatchContractError,
  parseAndValidateCommentBatchBytes,
  validateCommentBatch,
} from "../src/collector/comment-batch/comment-batch-contract.js";
import { importRawInput, openCommentDatabase } from "../src/database/comment-database.js";
import { readSelectedSnapshots, verifyRawInputs } from "../src/database/raw-snapshot-repository.js";
import { buildAnalysisArtifacts } from "../src/processing/analysis-input/raw-snapshot-projection.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");
const richFixturePath = path.join(
  repositoryRoot,
  "docs/active/issues/20260907-new-comments-dto-adapter/new-comments-dto-adapter-handoff/fixtures/representative-v1.json",
);

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comment-batch-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dbPath: path.join(root, "comments.sqlite3"), inputPath: path.join(root, "comments.json") };
}

function query(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all(...parameters).map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

function batchRows() {
  return [
    { username: " user ", handle: "@one", comment: "本文、é/é", postedAt: "not parsed", postedDate: "" },
    { username: "", handle: "   ", comment: "", postedAt: "opaque", postedDate: "2026/unknown" },
    { username: " user ", handle: "@one", comment: "本文、é/é", postedAt: "not parsed", postedDate: "" },
  ];
}

function runCli(command, args) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

test("comment-batch contract is strict while preserving opaque strings and duplicates", () => {
  const rows = batchRows();
  assert.equal(validateCommentBatch(rows), rows);
  assert.deepEqual(parseAndValidateCommentBatchBytes(Buffer.from(JSON.stringify(rows))).payload, rows);
  assert.deepEqual(parseAndValidateCommentBatchBytes(Buffer.from("[]")).payload, []);
  assert.throws(
    () => parseAndValidateCommentBatchBytes(Buffer.from([0xc3, 0x28])),
    (error) => error instanceof CommentBatchContractError && error.code === "VALIDATION_ERROR" && /UTF-8/.test(error.message),
  );
  assert.throws(() => validateCommentBatch({}), /schema validation failed/);
  assert.throws(() => validateCommentBatch([{ ...rows[0], extra: true }]), /extra/);
  assert.throws(() => validateCommentBatch([{ ...rows[0], comment: null }]), /comment/);
  assert.throws(() => validateCommentBatch([{ username: "", handle: "", comment: "", postedAt: "" }]), /postedDate/);
});

test("comment-batch adapter preserves exact bytes, order, duplicates, and the one-materialization rule", () => {
  const bytes = Buffer.from(JSON.stringify(batchRows()), "utf8");
  const request = adaptCommentBatchBytes(bytes);
  assert.deepEqual(request.payloadBytes, bytes);
  assert.equal(request.inputFormat, COMMENT_BATCH_INPUT_FORMAT);
  assert.equal(request.snapshots.length, 1);
  assert.deepEqual(request.snapshots[0], {
    materializationKind: "comment-batch",
    platform: "tiktok",
    loadedCount: 3,
    comments: [
      { username: " user ", handle: "@one", commentText: "本文、é/é", postedAt: "not parsed", postedDate: "" },
      { username: "", handle: "   ", commentText: "", postedAt: "opaque", postedDate: "2026/unknown" },
      { username: " user ", handle: "@one", commentText: "本文、é/é", postedAt: "not parsed", postedDate: "" },
    ],
  });
  assert.deepEqual(mapCommentBatchToSnapshot([]), {
    materializationKind: "comment-batch",
    platform: "tiktok",
    loadedCount: 0,
    comments: [],
  });
});

test("comment-batch persistence round-trips exact five fields without rich or master rows", async (t) => {
  const { dbPath } = makeCase(t);
  const bytes = Buffer.from(JSON.stringify(batchRows()), "utf8");
  const request = adaptCommentBatchBytes(bytes);
  const imported = await importRawInput(request, { dbPath });
  const expectedSha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(imported.status, "imported");
  assert.equal(imported.payloadSha256, expectedSha);
  assert.equal(imported.snapshotCount, 1);
  assert.equal(imported.commentObservationCount, 3);
  assert.equal(query(dbPath, "PRAGMA user_version")[0].user_version, 6);
  const rawRow = query(dbPath, "SELECT payload_bytes, input_format FROM raw_inputs")[0];
  assert.deepEqual(Buffer.from(rawRow.payload_bytes), bytes);
  assert.equal(rawRow.input_format, COMMENT_BATCH_INPUT_FORMAT);
  assert.deepEqual({ ...query(dbPath, `SELECT materialization_kind, platform, extracted_at, source_page_url,
      source_canonical_url, item_source, loaded_count, reported_count, coverage_note
      FROM raw_snapshots`)[0] }, {
    materialization_kind: "comment-batch",
    platform: "tiktok",
    extracted_at: null,
    source_page_url: null,
    source_canonical_url: null,
    item_source: null,
    loaded_count: 3,
    reported_count: null,
    coverage_note: null,
  });
  assert.deepEqual(query(dbPath, "SELECT COUNT(*) AS count FROM snapshot_video_observations"), [{ count: 0 }]);
  assert.deepEqual(query(dbPath, "SELECT COUNT(*) AS count FROM videos"), [{ count: 0 }]);
  assert.deepEqual(query(dbPath, "SELECT COUNT(*) AS count FROM authors"), [{ count: 0 }]);
  assert.deepEqual(query(dbPath, "SELECT COUNT(*) AS count FROM comments"), [{ count: 0 }]);
  assert.deepEqual(query(dbPath, `SELECT source_index, comment_pk, level, comment_id_raw,
      video_id_raw, parent_comment_id_raw, username, handle, user_id_raw,
      comment_text, posted_at, created_at, posted_date, like_count, reply_count
      FROM snapshot_comment_observations ORDER BY source_index`), [
    {
      source_index: 0, comment_pk: null, level: null, comment_id_raw: null, video_id_raw: null,
      parent_comment_id_raw: null, username: " user ", handle: "@one", user_id_raw: null,
      comment_text: "本文、é/é", posted_at: "not parsed", created_at: null, posted_date: "", like_count: null, reply_count: null,
    },
    {
      source_index: 1, comment_pk: null, level: null, comment_id_raw: null, video_id_raw: null,
      parent_comment_id_raw: null, username: "", handle: "   ", user_id_raw: null,
      comment_text: "", posted_at: "opaque", created_at: null, posted_date: "2026/unknown", like_count: null, reply_count: null,
    },
    {
      source_index: 2, comment_pk: null, level: null, comment_id_raw: null, video_id_raw: null,
      parent_comment_id_raw: null, username: " user ", handle: "@one", user_id_raw: null,
      comment_text: "本文、é/é", posted_at: "not parsed", created_at: null, posted_date: "", like_count: null, reply_count: null,
    },
  ]);

  const db = await openCommentDatabase(dbPath);
  try {
    const selected = readSelectedSnapshots(db, [{ payloadSha256: expectedSha, snapshotIndex: 0 }]);
    assert.equal(Object.hasOwn(selected[0].snapshot, "materializationKind"), false);
    assert.deepEqual(selected[0].observations.map((observation) => observation.commentText), ["本文、é/é", "", "本文、é/é"]);
    const artifacts = buildAnalysisArtifacts(selected);
    assert.deepEqual(artifacts.records, batchRows().map((row) => ({
      username: row.username,
      handle: row.handle,
      comment: row.comment,
      postedAt: row.postedAt,
      postedDate: row.postedDate,
    })));
    assert.equal(artifacts.manifest.schema_version, 3);
    assert.equal(artifacts.manifest.snapshots[0].extracted_at, null);
    assert.equal(Object.hasOwn(artifacts.manifest.snapshots[0], "materialization_kind"), false);
    assert.deepEqual(verifyRawInputs(db), { status: "verified", rawInputCount: 1, snapshotCount: 1 });
  } finally {
    db.close();
  }
  assert.equal((await importRawInput(request, { dbPath })).status, "already-imported");
});

test("comment-batch CLI imports, reimports, exports through snapshot-sha, and rejects invalid files before DB writes", async (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const bytes = Buffer.from(JSON.stringify(batchRows()), "utf8");
  fs.writeFileSync(inputPath, bytes);
  let result = runCli("import-comment-batch", ["--input", inputPath, "--db", dbPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^imported payload=[0-9a-f]{64} snapshots=1 comments=3\n$/);
  result = runCli("import-comment-batch", ["--input", inputPath, "--db", dbPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^already imported payload=[0-9a-f]{64} snapshots=1 comments=3\n$/);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const output = path.join(root, "output.json");
  const manifest = path.join(root, "manifest.json");
  result = runCli("export-analysis-input", [
    "--snapshot-sha", sha,
    "--output", output,
    "--manifest", manifest,
    "--db", dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).length, 3);

  fs.writeFileSync(inputPath, JSON.stringify([{ ...batchRows()[0], extra: true }]), "utf8");
  const invalidDbPath = path.join(root, "invalid.sqlite3");
  result = runCli("import-comment-batch", ["--input", inputPath, "--db", invalidDbPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /extra/);
  assert.equal(fs.existsSync(invalidDbPath), false);
});

test("rich and comment-batch snapshots use the same deterministic analysis projection", async (t) => {
  const { dbPath } = makeCase(t);
  const richBytes = fs.readFileSync(richFixturePath);
  const batchBytes = Buffer.from(JSON.stringify(batchRows()), "utf8");
  const richRequest = adaptNewCommentsWrapperBytes(richBytes);
  const batchRequest = adaptCommentBatchBytes(batchBytes);
  const richResult = await importRawInput(richRequest, { dbPath });
  const batchResult = await importRawInput(batchRequest, { dbPath });
  const db = await openCommentDatabase(dbPath);
  try {
    const selected = readSelectedSnapshots(db, [
      { payloadSha256: richResult.payloadSha256, snapshotIndex: 0 },
      { payloadSha256: batchResult.payloadSha256, snapshotIndex: 0 },
    ]);
    const artifacts = buildAnalysisArtifacts(selected);
    assert.equal(artifacts.records.length, 5);
    assert.equal(artifacts.manifest.snapshots.length, 2);
    assert.equal(artifacts.manifest.schema_version, 3);
    assert.equal(artifacts.manifest.snapshots.some((snapshot) => Object.hasOwn(snapshot, "materialization_kind")), false);
  } finally {
    db.close();
  }
});

test("repository detects source-index and kind-specific corruption", async (t) => {
  const { dbPath } = makeCase(t);
  const request = adaptCommentBatchBytes(Buffer.from(JSON.stringify(batchRows()), "utf8"));
  const imported = await importRawInput(request, { dbPath });
  const db = await openCommentDatabase(dbPath);
  try {
    db.prepare("UPDATE snapshot_comment_observations SET source_index = 3 WHERE source_index = 2").run();
    assert.throws(
      () => readSelectedSnapshots(db, [{ payloadSha256: imported.payloadSha256, snapshotIndex: 0 }]),
      /DATABASE_INTEGRITY_ERROR/,
    );
    db.prepare("UPDATE snapshot_comment_observations SET source_index = 2 WHERE source_index = 3").run();
    db.prepare(`INSERT INTO snapshot_video_observations
      (snapshot_id, video_id_raw, canonical_url, title, description, published_at,
       published_date, region_code, duration, view_count, like_count, comment_count,
       share_count, favorite_count)
      VALUES (1, 'bad', 'bad', 'bad', 'bad', 'bad', 'bad', 'bad', 0, 0, 0, 0, 0, 0)`).run();
    assert.throws(() => verifyRawInputs(db), /DATABASE_INTEGRITY_ERROR/);
  } finally {
    db.close();
  }
});

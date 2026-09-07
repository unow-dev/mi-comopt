import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateRawSnapshot } from "../scripts/release-utils.mjs";
import { computeRawPayloadSha256 } from "../src/raw-snapshot/raw-snapshot-contract.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "raw-analysis-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
  };
}

function runCli(command, args) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function comment(number, values = {}) {
  return {
    level: 0,
    commentId: "comment-" + number,
    videoId: "video-" + number,
    parentCommentId: "",
    username: "user-" + number,
    handle: "@handle-" + number,
    userId: "user-id-" + number,
    avatarUrl: "",
    comment: "comment-" + number,
    postedAt: "posted-" + number,
    createTime: "create-" + number,
    createdAt: "created-" + number,
    postedDate: "date-" + number,
    likeCount: null,
    replyCount: null,
    ...values,
  };
}

function rawSnapshot(number, commentItems = [comment(number)]) {
  const id = "video-" + number;
  return {
    schemaVersion: 1,
    extractedAt: "2026-09-05T00:00:0" + number + "Z",
    source: {
      pageUrl: "page-" + number,
      canonicalUrl: "canonical-" + number,
      itemSource: "fixture",
      topLevelKeys: [],
    },
    video: {
      id,
      url: "",
      canonicalUrl: "video-canonical-" + number,
      shareUrl: "",
      embedUrl: "",
      title: "title-" + number,
      description: "description-" + number,
      createTime: 1,
      publishedAt: "published-" + number,
      publishedDate: "published-date-" + number,
      regionCode: "",
      duration: 1,
      width: 1,
      height: 1,
      ratio: "",
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
      id: "author-" + number,
      secUid: "",
      username: "",
      nickname: "",
      signature: "",
      verified: false,
      privateAccount: false,
      avatarUrl: "",
      stats: {
        followerCount: 0,
        followingCount: 0,
        friendCount: 0,
        heartCount: 0,
        videoCount: 0,
        diggCount: 0,
      },
    },
    music: null,
    hashtags: [],
    hashtagDetails: [],
    mentions: [],
    effects: [],
    stickers: [],
    comments: {
      loadedCount: commentItems.length,
      reportedCount: 100 + number,
      note: "coverage-" + number,
      items: commentItems,
    },
  };
}

function writeRaw(root, name, value, compact = false) {
  const file = path.join(root, name);
  const text = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2) + "\n";
  fs.writeFileSync(file, text);
  return { file, bytes: Buffer.from(text, "utf8") };
}

function importRaw(caseData, file) {
  return runCli("import-raw-snapshot", [
    "--input", file,
    "--db", caseData.dbPath,
  ]);
}

test("exports explicit snapshots as deterministic exact-five-field JSON and manifest", (t) => {
  const caseData = makeCase(t);
  const first = writeRaw(caseData.root, "first.json", rawSnapshot(1), true);
  const secondRaw = rawSnapshot(2, [
    comment(2, { comment: "same across source sets" }),
    comment(2, { commentId: "comment-2b", comment: "same across source sets" }),
  ]);
  const second = writeRaw(caseData.root, "second.json", secondRaw);
  assert.equal(importRaw(caseData, second.file).status, 0);
  assert.equal(importRaw(caseData, first.file).status, 0);
  const firstSha = computeRawPayloadSha256(first.bytes);
  const secondSha = computeRawPayloadSha256(second.bytes);
  const orderedShas = [firstSha, secondSha].sort();
  const outputA = path.join(caseData.root, "new-a.json");
  const manifestA = path.join(caseData.root, "new-a.manifest.json");
  const exportedA = runCli("export-analysis-input", [
    "--snapshot-ref", orderedShas[1] + ":0",
    "--snapshot-ref", orderedShas[0] + ":0",
    "--output", outputA,
    "--manifest", manifestA,
    "--db", caseData.dbPath,
  ]);
  assert.equal(exportedA.status, 0, exportedA.stderr);
  const outputBytes = fs.readFileSync(outputA);
  const output = JSON.parse(outputBytes);
  validateRawSnapshot(output);
  assert.deepEqual(output.map((record) => record.comment), orderedShas[0] === firstSha
    ? ["comment-1", "same across source sets", "same across source sets"]
    : ["same across source sets", "same across source sets", "comment-1"]);
  for (const record of output) assert.deepEqual(Object.keys(record), ["username", "handle", "comment", "postedAt", "postedDate"]);
  const manifest = JSON.parse(fs.readFileSync(manifestA, "utf8"));
  assert.deepEqual(Object.keys(manifest), [
    "schema_version",
    "projection_version",
    "database_schema_version",
    "output_sha256",
    "output_record_count",
    "snapshots",
  ]);
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.projection_version, "1.0.0");
  assert.equal(manifest.database_schema_version, 4);
  assert.equal(manifest.output_sha256, createHash("sha256").update(outputBytes).digest("hex"));
  assert.equal(manifest.output_record_count, 3);
  assert.deepEqual(manifest.snapshots.map((snapshot) => [snapshot.payload_sha256, snapshot.snapshot_index, snapshot.input_format]), orderedShas.map((sha) => [sha, 0, "tiktokRawSnapshot-1.0.0"]));
  for (const snapshot of manifest.snapshots) assert.equal(Object.hasOwn(snapshot, "raw_schema_version"), false);
  assert.deepEqual(manifest.snapshots.map((snapshot) => [snapshot.output_start_index, snapshot.record_count]), [
    [0, orderedShas[0] === firstSha ? 1 : 2],
    [orderedShas[0] === firstSha ? 1 : 2, orderedShas[0] === firstSha ? 2 : 1],
  ]);
  assert.equal(Object.hasOwn(manifest, "generated_at"), false);

  const outputB = path.join(caseData.root, "new-b.json");
  const manifestB = path.join(caseData.root, "new-b.manifest.json");
  const exportedB = runCli("export-analysis-input", [
    "--snapshot-ref", orderedShas[0] + ":0",
    "--snapshot-ref", orderedShas[1] + ":0",
    "--output", outputB,
    "--manifest", manifestB,
    "--db", caseData.dbPath,
  ]);
  assert.equal(exportedB.status, 0, exportedB.stderr);
  assert.deepEqual(fs.readFileSync(outputB), outputBytes);
  assert.deepEqual(fs.readFileSync(manifestB), fs.readFileSync(manifestA));
});

test("export is DB-only, refuses implicit or unknown selection, and fails closed on existing artifacts", (t) => {
  const caseData = makeCase(t);
  const fixture = writeRaw(caseData.root, "fixture.json", rawSnapshot(3));
  assert.equal(importRaw(caseData, fixture.file).status, 0);
  const sha = computeRawPayloadSha256(fixture.bytes);
  const legacyRoot = path.join(caseData.root, "legacy-raw");
  fs.mkdirSync(legacyRoot);
  fs.rmSync(legacyRoot, { recursive: true, force: true });
  const output = path.join(caseData.root, "output.json");
  const manifest = path.join(caseData.root, "manifest.json");
  let result = runCli("export-analysis-input", [
    "--snapshot-ref", sha + ":0",
    "--output", output,
    "--manifest", manifest,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(output, "existing");
  result = runCli("export-analysis-input", [
    "--snapshot-ref", sha + ":0",
    "--output", output,
    "--manifest", path.join(caseData.root, "new-manifest.json"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXPORT_WRITE_FAILED/);
  assert.equal(fs.readFileSync(output, "utf8"), "existing");

  const unknown = "f".repeat(64);
  result = runCli("export-analysis-input", [
    "--snapshot-ref", unknown + ":0",
    "--output", path.join(caseData.root, "unknown.json"),
    "--manifest", path.join(caseData.root, "unknown.manifest.json"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SNAPSHOT_NOT_FOUND/);
  result = runCli("export-analysis-input", [
    "--output", path.join(caseData.root, "none.json"),
    "--manifest", path.join(caseData.root, "none.manifest.json"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
  result = runCli("export-analysis-input", [
    "--snapshot-ref", sha + ":0",
    "--snapshot-ref", sha + ":0",
    "--output", path.join(caseData.root, "duplicate.json"),
    "--manifest", path.join(caseData.root, "duplicate.manifest.json"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
});

test("supports the one-child legacy SHA alias and rejects ambiguous or mixed selectors", (t) => {
  const caseData = makeCase(t);
  const fixture = writeRaw(caseData.root, "fixture.json", rawSnapshot(4));
  assert.equal(importRaw(caseData, fixture.file).status, 0);
  const sha = computeRawPayloadSha256(fixture.bytes);
  const output = path.join(caseData.root, "legacy-output.json");
  const manifest = path.join(caseData.root, "legacy-manifest.json");
  let result = runCli("export-analysis-input", [
    "--snapshot-sha", sha,
    "--output", output,
    "--manifest", manifest,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  result = runCli("verify-raw-inputs", ["--snapshot-sha", sha, "--db", caseData.dbPath]);
  assert.equal(result.status, 0, result.stderr);
  result = runCli("export-analysis-input", [
    "--snapshot-ref", sha + ":0",
    "--snapshot-sha", sha,
    "--output", path.join(caseData.root, "mixed.json"),
    "--manifest", path.join(caseData.root, "mixed.manifest.json"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
  result = runCli("import-raw-snapshot", ["--input", fixture.file, "--db", caseData.dbPath, "--raw-root", caseData.root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
});

test("projection core is SQLite-independent and keeps canonical ordering", async () => {
  const projectionPath = path.join(packageRoot, "src", "processing", "analysis-input", "raw-snapshot-projection.js");
  const source = fs.readFileSync(projectionPath, "utf8");
  assert.doesNotMatch(source, /node:sqlite/);
  const { buildAnalysisArtifacts } = await import("../src/processing/analysis-input/raw-snapshot-projection.js");
  const artifacts = buildAnalysisArtifacts([
    {
      snapshot: {
        payloadSha256: "b".repeat(64),
        platform: "tiktok",
        snapshotIndex: 0,
        inputFormat: "tiktokRawSnapshot-1.0.0",
        extractedAt: "b",
        sourceCanonicalUrl: "b",
        loadedCount: 1,
        reportedCount: 1,
        coverageNote: "b",
      },
      observations: [{ sourceIndex: 2, username: "b", handle: "b", commentText: "b", postedAt: "b", postedDate: "b" }],
    },
    {
      snapshot: {
        payloadSha256: "a".repeat(64),
        platform: "tiktok",
        snapshotIndex: 0,
        inputFormat: "tiktokRawSnapshot-1.0.0",
        extractedAt: "a",
        sourceCanonicalUrl: "a",
        loadedCount: 2,
        reportedCount: 2,
        coverageNote: "a",
      },
      observations: [
        { sourceIndex: 1, username: "a1", handle: "a1", commentText: "a1", postedAt: "a1", postedDate: "a1" },
        { sourceIndex: 0, username: "a0", handle: "a0", commentText: "a0", postedAt: "a0", postedDate: "a0" },
      ],
    },
  ]);
  assert.deepEqual(artifacts.records.map((record) => record.comment), ["a0", "a1", "b"]);
});

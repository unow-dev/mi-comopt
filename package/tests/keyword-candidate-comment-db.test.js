import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInput, openCommentDatabase } from "../src/database/comment-database.js";
import { readSnapshotThreeClassLabels } from "../src/database/three-class-label-repository.js";
import { adaptKeywordCandidates } from "../src/ui/candidate-data-adapter.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");
const candidateWorkflowScript = path.join(packageRoot, "scripts", "candidate-workflow.mjs");
const dataRoot = path.join(packageRoot, "src", "data");
const publicationBaseFiles = [
  "candidate_registry.json",
  "candidate_evaluation.json",
  "filterKeywordCandidates.json",
  "filterKeywordCandidates.meta.json",
  "run_manifest.json",
];
const handoffArchiveFiles = [
  "prompt.txt",
  "PROMPT_CONTRACT_v1.md",
  "candidate_generation_request.json",
  "candidate_view.json",
  "pre_evaluation.json",
  "evaluation_policy.json",
  "taxonomy.json",
  "source_dataset.json",
  "candidate-proposal.schema.json",
  "common.schema.json",
  "handoff_manifest.json",
];

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keyword-candidate-comment-db-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
    publicationRoot: path.join(root, "publications-root"),
  };
}

function runCli(command, args) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function runCandidateWorkflow(args) {
  return spawnSync(process.execPath, [candidateWorkflowScript, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function handoffZipMembers(zipPath) {
  const result = spawnSync("python3", ["-c", [
    "import json, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as archive:",
    "    print(json.dumps(archive.namelist()))",
  ].join("\n"), zipPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function unpackHandoff(zipPath, outputDir) {
  const result = spawnSync("python3", ["-c", [
    "import sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as archive:",
    "    archive.extractall(sys.argv[2])",
  ].join("\n"), zipPath, outputDir], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function makePublicationRoot(caseData) {
  const baseRunId = JSON.parse(fs.readFileSync(path.join(dataRoot, "filterKeywordCandidates.meta.json"), "utf8")).run_id;
  const baseDir = path.join(caseData.publicationRoot, "publications", baseRunId);
  fs.mkdirSync(baseDir, { recursive: true });
  for (const name of publicationBaseFiles) fs.copyFileSync(path.join(dataRoot, name), path.join(baseDir, name));
  fs.symlinkSync(path.join("publications", baseRunId), path.join(caseData.publicationRoot, "current"), "dir");
}

async function makeLabeledSnapshot(caseData) {
  const inputBytes = Buffer.from(JSON.stringify([
    { username: "direct-user", handle: "@direct", comment: "direct comment", postedAt: "posted-0", postedDate: "2026-09-09" },
    { username: "normal-user", handle: "@normal", comment: "ordinary comment", postedAt: "posted-1", postedDate: "2026-09-09" },
  ]), "utf8");
  const imported = await importRawInput(adaptCommentBatchBytes(inputBytes), { dbPath: caseData.dbPath });
  const db = await openCommentDatabase(caseData.dbPath);
  try {
    const observations = db.prepare(
      "SELECT observation_id FROM snapshot_comment_observations WHERE snapshot_id = ? ORDER BY source_index",
    ).all(db.prepare("SELECT snapshot_id FROM raw_snapshots WHERE payload_sha256 = ?").get(imported.payloadSha256).snapshot_id);
    db.prepare(
      "INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)",
    ).run(observations[0].observation_id, "direct_nuisance");
    db.prepare(
      "INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)",
    ).run(observations[1].observation_id, "normal");
    const snapshotId = db.prepare(
      "SELECT snapshot_id FROM raw_snapshots WHERE payload_sha256 = ? AND snapshot_index = 0",
    ).get(imported.payloadSha256).snapshot_id;
    assert.deepEqual(readSnapshotThreeClassLabels(db, snapshotId), [
      { sourceIndex: 0, label: "direct_nuisance" },
      { sourceIndex: 1, label: "normal" },
    ]);
  } finally {
    db.close();
  }
  return `${imported.payloadSha256}:0`;
}

test("migration 007 creates publication storage without uniqueness on request identity", async (t) => {
  const caseData = makeCase(t);
  const db = await openCommentDatabase(caseData.dbPath);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 8);
    assert.deepEqual(
      db.prepare("PRAGMA table_info(keyword_candidate_publications)").all().map((row) => row.name),
      [
        "run_id", "snapshot_id", "request_id", "input_fingerprint", "source_dataset_artifact_sha256",
        "base_run_id", "published_at", "applied_at", "is_current", "handoff_manifest_json",
        "candidate_generation_request_json", "candidate_proposal_json", "run_manifest_json",
        "current_meta_json", "filter_keyword_candidates_json",
      ],
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_keyword_candidate_publications_current'").get().count,
      1,
    );
  } finally {
    db.close();
  }
});

test("handoff generation fails closed for incomplete labels, existing output, and unsupported selectors", async (t) => {
  const caseData = makeCase(t);
  const snapshotRef = await makeLabeledSnapshot(caseData);
  makePublicationRoot(caseData);
  const db = new DatabaseSync(caseData.dbPath);
  try {
    db.exec(
      `DELETE FROM snapshot_comment_three_class_labels
       WHERE observation_id = (
         SELECT observation_id FROM snapshot_comment_observations
         WHERE source_index = 1
       )`,
    );
  } finally {
    db.close();
  }
  const missingOutput = path.join(caseData.root, "missing-label-handoff.zip");
  let result = runCli("generate-keyword-candidate-handoff", [
    "--snapshot-ref", snapshotRef,
    "--publication-root", caseData.publicationRoot,
    "--output", missingOutput,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /THREE_CLASS_LABELS_INCOMPLETE/);
  assert.equal(fs.existsSync(missingOutput), false);

  const repaired = new DatabaseSync(caseData.dbPath);
  try {
    const observation = repaired.prepare(
      "SELECT observation_id FROM snapshot_comment_observations WHERE source_index = 1",
    ).get();
    repaired.prepare(
      "INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)",
    ).run(observation.observation_id, "normal");
  } finally {
    repaired.close();
  }
  const existingOutput = path.join(caseData.root, "existing-handoff.zip");
  fs.writeFileSync(existingOutput, "preserve");
  result = runCli("generate-keyword-candidate-handoff", [
    "--snapshot-ref", snapshotRef,
    "--publication-root", caseData.publicationRoot,
    "--output", existingOutput,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HANDOFF_OUTPUT_EXISTS/);
  assert.equal(fs.readFileSync(existingOutput, "utf8"), "preserve");

  result = runCli("generate-keyword-candidate-handoff", [
    "--snapshot-sha", "a".repeat(64),
    "--publication-root", caseData.publicationRoot,
    "--output", path.join(caseData.root, "unsupported-selector.zip"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
});

test("UI export leaves the target unchanged when the DB has no current publication", async (t) => {
  const caseData = makeCase(t);
  const output = path.join(caseData.root, "filterKeywordCandidates.json");
  fs.writeFileSync(output, "sentinel");
  const result = runCli("export-keyword-candidates-ui", ["--output", output, "--db", caseData.dbPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /KEYWORD_CANDIDATE_PUBLICATION_NOT_FOUND/);
  assert.equal(fs.readFileSync(output, "utf8"), "sentinel");
});

test("DB labels generate a handoff and the full publication round-trip reaches UI JSON", async (t) => {
  const caseData = makeCase(t);
  const snapshotRef = await makeLabeledSnapshot(caseData);
  makePublicationRoot(caseData);
  const handoffZip = path.join(caseData.root, "handoff.zip");
  const handoffDir = path.join(caseData.root, "handoff");

  let result = runCli("generate-keyword-candidate-handoff", [
    "--snapshot-ref", snapshotRef,
    "--publication-root", caseData.publicationRoot,
    "--output", handoffZip,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(handoffZipMembers(handoffZip), handoffArchiveFiles);
  unpackHandoff(handoffZip, handoffDir);
  const sourceBytes = fs.readFileSync(path.join(handoffDir, "source_dataset.json"));
  const source = JSON.parse(sourceBytes);
  assert.deepEqual(Object.keys(source), ["schema_version", "labeling_status", "snapshot_ref", "records"]);
  assert.deepEqual(Object.keys(source.records[0]), ["source_index", "username", "handle", "comment", "postedAt", "postedDate", "label"]);
  assert.equal(source.records[0].label, "direct_nuisance");
  assert.equal(source.records[1].label, "normal");
  assert.equal(source.records[0].observation_id, undefined);
  assert.equal(source.records[0].workset_id, undefined);
  const request = JSON.parse(fs.readFileSync(path.join(handoffDir, "candidate_generation_request.json"), "utf8"));
  assert.equal(
    request.source_dataset.artifact_sha256,
    `sha256:${crypto.createHash("sha256").update(sourceBytes).digest("hex")}`,
  );
  assert.equal(request.source_dataset.artifact_ref, snapshotRef);
  const unpublishedDb = new DatabaseSync(caseData.dbPath);
  try {
    assert.equal(unpublishedDb.prepare("SELECT COUNT(*) AS count FROM keyword_candidate_publications").get().count, 0);
  } finally {
    unpublishedDb.close();
  }

  const proposalPath = path.join(caseData.root, "candidate_proposal.json");
  fs.writeFileSync(proposalPath, `${JSON.stringify({
    schema_version: 1,
    request_id: request.request_id,
    input_fingerprint: request.input_fingerprint,
    actions: [],
  }, null, 2)}\n`);
  result = runCandidateWorkflow([
    "full-update",
    "--registry", path.join(caseData.publicationRoot, "current", "candidate_registry.json"),
    "--request", path.join(handoffDir, "candidate_generation_request.json"),
    "--proposal", proposalPath,
    "--dataset", path.join(handoffDir, "source_dataset.json"),
    "--policy", path.join(handoffDir, "evaluation_policy.json"),
    "--taxonomy", path.join(handoffDir, "taxonomy.json"),
    "--parent-manifest", path.join(caseData.publicationRoot, "current", "run_manifest.json"),
    "--candidate-view", path.join(handoffDir, "candidate_view.json"),
    "--pre-evaluation", path.join(handoffDir, "pre_evaluation.json"),
    "--handoff-manifest", path.join(handoffDir, "handoff_manifest.json"),
    "--run-id", "run_923e4567-e89b-42d3-a456-426614174000",
    "--outdir", caseData.publicationRoot,
  ]);
  assert.equal(result.status, 0, result.stderr);

  result = runCli("apply-keyword-candidate-publication", [
    "--handoff-manifest", path.join(handoffDir, "handoff_manifest.json"),
    "--publication-root", caseData.publicationRoot,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const applied = JSON.parse(result.stdout);
  assert.equal(applied.status, "applied");
  const appliedDb = new DatabaseSync(caseData.dbPath);
  try {
    const row = appliedDb.prepare("SELECT * FROM keyword_candidate_publications WHERE is_current = 1").get();
    assert.equal(row.snapshot_id > 0, true);
    assert.equal(row.run_id, applied.runId);
    assert.equal(row.request_id, request.request_id);
    assert.equal(row.source_dataset_artifact_sha256, request.source_dataset.artifact_sha256);
    assert.equal(row.base_run_id, request.base_publication.run_id);
    assert.equal(row.handoff_manifest_json, fs.readFileSync(path.join(handoffDir, "handoff_manifest.json"), "utf8"));
    assert.equal(row.candidate_generation_request_json, fs.readFileSync(path.join(handoffDir, "candidate_generation_request.json"), "utf8"));
  } finally {
    appliedDb.close();
  }

  const exportedPath = path.join(caseData.root, "ui", "filterKeywordCandidates.json");
  result = runCli("export-keyword-candidates-ui", ["--output", exportedPath, "--db", caseData.dbPath]);
  assert.equal(result.status, 0, result.stderr);
  const exportedBytes = fs.readFileSync(exportedPath);
  assert.deepEqual(exportedBytes, fs.readFileSync(path.join(caseData.publicationRoot, "current", "filterKeywordCandidates.json")));
  assert.equal(adaptKeywordCandidates(JSON.parse(exportedBytes)).length >= 0, true);
});

test("identical DB publication apply is idempotent and does not change applied_at", async (t) => {
  const caseData = makeCase(t);
  const snapshotRef = await makeLabeledSnapshot(caseData);
  makePublicationRoot(caseData);
  const handoffZip = path.join(caseData.root, "handoff.zip");
  const handoffDir = path.join(caseData.root, "handoff");
  let result = runCli("generate-keyword-candidate-handoff", [
    "--snapshot-ref", snapshotRef,
    "--publication-root", caseData.publicationRoot,
    "--output", handoffZip,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  unpackHandoff(handoffZip, handoffDir);
  const request = JSON.parse(fs.readFileSync(path.join(handoffDir, "candidate_generation_request.json"), "utf8"));
  const proposalPath = path.join(caseData.root, "proposal.json");
  fs.writeFileSync(proposalPath, `${JSON.stringify({ schema_version: 1, request_id: request.request_id, input_fingerprint: request.input_fingerprint, actions: [] })}\n`);
  result = runCandidateWorkflow([
    "full-update",
    "--registry", path.join(caseData.publicationRoot, "current", "candidate_registry.json"),
    "--request", path.join(handoffDir, "candidate_generation_request.json"),
    "--proposal", proposalPath,
    "--dataset", path.join(handoffDir, "source_dataset.json"),
    "--policy", path.join(handoffDir, "evaluation_policy.json"),
    "--taxonomy", path.join(handoffDir, "taxonomy.json"),
    "--parent-manifest", path.join(caseData.publicationRoot, "current", "run_manifest.json"),
    "--candidate-view", path.join(handoffDir, "candidate_view.json"),
    "--pre-evaluation", path.join(handoffDir, "pre_evaluation.json"),
    "--handoff-manifest", path.join(handoffDir, "handoff_manifest.json"),
    "--run-id", "run_a23e4567-e89b-42d3-a456-426614174000",
    "--outdir", caseData.publicationRoot,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const applyArgs = [
    "--handoff-manifest", path.join(handoffDir, "handoff_manifest.json"),
    "--publication-root", caseData.publicationRoot,
    "--db", caseData.dbPath,
  ];
  result = runCli("apply-keyword-candidate-publication", applyArgs);
  assert.equal(result.status, 0, result.stderr);
  const firstDb = new DatabaseSync(caseData.dbPath);
  const first = firstDb.prepare("SELECT applied_at FROM keyword_candidate_publications").get().applied_at;
  firstDb.close();
  result = runCli("apply-keyword-candidate-publication", applyArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "already-applied");
  const secondDb = new DatabaseSync(caseData.dbPath);
  const second = secondDb.prepare("SELECT applied_at FROM keyword_candidate_publications").get().applied_at;
  secondDb.close();
  assert.equal(second, first);
});

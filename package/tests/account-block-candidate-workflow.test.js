import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildAccountCandidates,
  prefixedSha256,
  serializeJson,
  validateDataset,
  validateSummary,
} from "../src/processing/account-block-candidates/account-block-candidate-workflow.js";

const packageRoot = path.resolve(".");
const workflowScript = path.join(packageRoot, "scripts/account-block-candidate-workflow.mjs");
const verifyScript = path.join(packageRoot, "scripts/verify-data.mjs");
const policyPath = path.resolve("contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));

function row({ username = "user", handle = "alice", comment = "comment", postedAt = "9-1", postedDate = "2026-09-01", label = "direct_nuisance" } = {}) {
  return { username, handle, comment, postedAt, postedDate, label };
}

function direct(handle, number, overrides = {}) {
  return row({
    handle,
    comment: `${handle} comment ${number}`,
    postedAt: `9-${String(number).padStart(2, "0")}`,
    postedDate: `2026-09-${String(number).padStart(2, "0")}`,
    ...overrides,
  });
}

function result(dataset, configuredPolicy = policy) {
  return buildAccountCandidates(dataset, configuredPolicy);
}

function bareHash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeJson(file, value) {
  fs.writeFileSync(file, serializeJson(value), "utf8");
}

function runScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: packageRoot, encoding: "utf8" });
}

function makeInputFiles(root, dataset, overrides = {}) {
  const datasetPath = path.join(root, "three_class_labeled.json");
  const summaryPath = path.join(root, "summary.json");
  const policyPathForTest = path.join(root, "accountBlockCandidatePolicy.json");
  const keywordMetaPath = path.join(root, "filterKeywordCandidates.meta.json");
  const datasetBytes = Buffer.from(serializeJson(dataset), "utf8");
  const datasetSha = bareHash(datasetBytes);
  const summary = {
    final_published: true,
    final_output_sha256: datasetSha,
    three_class_policy_version: "1.4.0",
    unresolved_optional_p2_reviews: 3,
    ...overrides.summary,
  };
  const policyForTest = { ...policy, ...overrides.policy };
  writeJson(datasetPath, dataset);
  writeJson(summaryPath, summary);
  writeJson(policyPathForTest, policyForTest);
  writeJson(keywordMetaPath, {
    schema_version: 1,
    dataset_artifact_sha256: `sha256:${summary.final_output_sha256}`,
    ...overrides.keywordMeta,
  });
  return { datasetPath, summaryPath, policyPath: policyPathForTest, keywordMetaPath, datasetSha, summary };
}

function runGenerator(root, input, extra = []) {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  fs.copyFileSync(input.keywordMetaPath, path.join(dataDir, "filterKeywordCandidates.meta.json"));
  return {
    dataDir,
    result: runScript(workflowScript, [
      "--dataset", input.datasetPath,
      "--summary", input.summaryPath,
      "--policy", input.policyPath,
      "--keyword-meta", input.keywordMetaPath,
      "--publish-dir", dataDir,
      "--run-id", "run_123e4567-e89b-42d3-a456-426614174000",
      "--published-at", "2026-09-02T00:00:00Z",
      ...extra,
    ]),
  };
}

test("F01/F02/F03: distinct direct event count controls candidates and evidence sample", () => {
  const one = result([direct("alice", 1)]);
  assert.deepEqual(one.candidates, []);

  const two = result([direct("alice", 1), direct("alice", 2)]);
  assert.equal(two.candidates[0].handle, "alice");
  assert.equal(two.candidates[0].direct_nuisance_count, 2);
  assert.equal(two.candidates[0].evidence_sample.length, 2);

  const four = result([direct("alice", 1), direct("alice", 2), direct("alice", 3), direct("alice", 4)]);
  assert.equal(four.candidates[0].direct_nuisance_count, 4);
  assert.equal(four.candidates[0].evidence_sample.length, 2);
});

test("F04/F05: username-only duplicates collapse and label conflicts fail closed", () => {
  const duplicate = direct("alice", 1, { username: "first" });
  const sameEventDifferentUsername = { ...duplicate, username: "second" };
  const output = result([duplicate, sameEventDifferentUsername, direct("alice", 2)]);
  assert.equal(output.candidates[0].direct_nuisance_count, 2);
  assert.equal(output.statistics.distinct_behavior_event_count, 2);
  assert.equal(output.statistics.collapsed_source_rows, 1);

  assert.throws(
    () => result([
      direct("alice", 1, { label: "direct_nuisance" }),
      direct("alice", 1, { label: "reactive" }),
    ]),
    (caught) => caught.errors?.some((item) => item.code === "BEHAVIOR_EVENT_LABEL_CONFLICT"),
  );
});

test("F06/F07/F08: exact event tuple and exact handle are identity boundaries", () => {
  const postedAtDiff = [direct("alice", 1, { comment: "same", postedAt: "9-1", postedDate: "2026-09-01" }), direct("alice", 1, { comment: "same", postedAt: "9-2", postedDate: "2026-09-01" })];
  assert.equal(result(postedAtDiff).candidates[0].direct_nuisance_count, 2);

  const postedDateDiff = [direct("alice", 1, { comment: "same", postedAt: "9-1", postedDate: "2026-09-01" }), direct("alice", 1, { comment: "same", postedAt: "9-1", postedDate: "2026-09-02" })];
  assert.equal(result(postedDateDiff).candidates[0].direct_nuisance_count, 2);

  const differentHandles = [direct("alice", 1, { comment: "same", postedAt: "9-1", postedDate: "2026-09-01" }), direct("bob", 1, { comment: "same", postedAt: "9-1", postedDate: "2026-09-01" })];
  assert.deepEqual(result(differentHandles).candidates, []);
});

test("F09/F10: blank direct handles and only non-direct rows are handled safely", () => {
  assert.throws(() => result([direct("   ", 1), direct("   ", 2)]), (caught) => caught.errors?.some((item) => item.code === "BLANK_DIRECT_HANDLE"));
  assert.deepEqual(result([row({ label: "reactive" }), row({ label: "normal", comment: "ordinary" })]).candidates, []);
});

test("F11/F22/F23: candidates and fingerprint samples are deterministic", () => {
  const dataset = [
    direct("alice", 1),
    direct("alice", 2),
    direct("alice", 3),
    direct("bob", 1),
    direct("bob", 2),
    direct("charlie", 1),
    direct("charlie", 2),
  ];
  const shuffled = [dataset[4], dataset[1], dataset[6], dataset[2], dataset[0], dataset[5], dataset[3]];
  assert.equal(serializeJson(result(dataset).candidates), serializeJson(result(shuffled).candidates));
  assert.deepEqual(result(dataset).candidates.map((candidate) => candidate.handle), ["alice", "bob", "charlie"].sort((left, right) => {
    const leftHash = bareHash(Buffer.from(JSON.stringify([left]), "utf8"));
    const rightHash = bareHash(Buffer.from(JSON.stringify([right]), "utf8"));
    return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
  }));
  assert.deepEqual(result(dataset).candidates[0].evidence_sample, result(shuffled).candidates[0].evidence_sample);
});

test("F14/F15/F21: dataset and policy validation is fail closed", () => {
  assert.throws(() => validateDataset([row({ label: "unknown" })]), /検証/);
  assert.throws(() => validateDataset([{ ...row(), postedAt: undefined }]), /検証/);
  assert.throws(() => result([direct("alice", 1), direct("alice", 2)], { ...policy, evidence_sample_size: 3 }), /検証/);
});

test("F12/F13/F17: summary gate accepts zero candidates but rejects unpublished or mismatched input", () => {
  const bytes = Buffer.from("[]", "utf8");
  const base = {
    final_published: true,
    final_output_sha256: bareHash(bytes),
    three_class_policy_version: "1.4.0",
    unresolved_optional_p2_reviews: 0,
  };
  assert.doesNotThrow(() => validateSummary(base, bytes));
  assert.throws(() => validateSummary({ ...base, final_published: false }, bytes), /検証/);
  assert.throws(() => validateSummary({ ...base, final_output_sha256: "0".repeat(64) }, bytes), /検証/);
});

test("F16/F18/F19/F20: CLI publication and verify:data enforce artifact bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-candidate-test-"));
  const dataset = [direct("alice", 1), direct("alice", 2), row({ label: "normal", comment: "ordinary" })];
  const input = makeInputFiles(root, dataset);
  const generated = runGenerator(root, input);
  assert.equal(generated.result.status, 0, generated.result.stderr);
  const verified = runScript(verifyScript, ["--data-dir", generated.dataDir, "--policy", input.policyPath]);
  assert.equal(verified.status, 0, verified.stderr);

  fs.appendFileSync(path.join(generated.dataDir, "accountBlockCandidates.json"), " ");
  const candidateTamper = runScript(verifyScript, ["--data-dir", generated.dataDir, "--policy", input.policyPath]);
  assert.notEqual(candidateTamper.status, 0);

  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "account-candidate-test-"));
  const freshInput = makeInputFiles(fresh, dataset);
  const freshGenerated = runGenerator(fresh, freshInput);
  assert.equal(freshGenerated.result.status, 0, freshGenerated.result.stderr);
  const manifestPath = path.join(freshGenerated.dataDir, "accountBlockCandidateRunManifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.statistics.candidate_count = 99;
  writeJson(manifestPath, manifest);
  const manifestTamper = runScript(verifyScript, ["--data-dir", freshGenerated.dataDir, "--policy", freshInput.policyPath]);
  assert.notEqual(manifestTamper.status, 0);

  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "account-candidate-test-"));
  const snapshotInput = makeInputFiles(snapshotRoot, dataset);
  const snapshotGenerated = runGenerator(snapshotRoot, snapshotInput);
  assert.equal(snapshotGenerated.result.status, 0, snapshotGenerated.result.stderr);
  writeJson(path.join(snapshotGenerated.dataDir, "filterKeywordCandidates.meta.json"), { schema_version: 1, dataset_artifact_sha256: `sha256:${"f".repeat(64)}` });
  const snapshotMismatch = runScript(verifyScript, ["--data-dir", snapshotGenerated.dataDir, "--policy", snapshotInput.policyPath]);
  assert.notEqual(snapshotMismatch.status, 0);

  const malformed = fs.mkdtempSync(path.join(os.tmpdir(), "account-candidate-test-"));
  const malformedInput = makeInputFiles(malformed, dataset);
  fs.writeFileSync(malformedInput.datasetPath, "{", "utf8");
  const malformedResult = runGenerator(malformed, malformedInput);
  assert.notEqual(malformedResult.result.status, 0);
  assert.match(malformedResult.result.stderr, /INVALID_JSON/);
});

test("publication failure leaves existing account artifacts untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-candidate-test-"));
  const dataset = [direct("alice", 1), direct("alice", 1, { label: "reactive" })];
  const input = makeInputFiles(root, dataset);
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  const oldFiles = {
    "accountBlockCandidates.json": "old candidates",
    "accountBlockCandidates.meta.json": "old meta",
    "accountBlockCandidateRunManifest.json": "old manifest",
  };
  for (const [name, value] of Object.entries(oldFiles)) fs.writeFileSync(path.join(dataDir, name), value, "utf8");
  const result = runScript(workflowScript, [
    "--dataset", input.datasetPath,
    "--summary", input.summaryPath,
    "--policy", input.policyPath,
    "--keyword-meta", input.keywordMetaPath,
    "--publish-dir", dataDir,
  ]);
  assert.notEqual(result.status, 0);
  for (const [name, value] of Object.entries(oldFiles)) assert.equal(fs.readFileSync(path.join(dataDir, name), "utf8"), value);
});

test("public artifact never contains username or non-direct evidence", () => {
  const output = result([
    direct("alice", 1, { username: "private-name" }),
    direct("alice", 2, { username: "private-name-2" }),
    row({ handle: "alice", label: "normal", comment: "normal body" }),
  ]);
  const serialized = serializeJson(output.candidates);
  assert.doesNotMatch(serialized, /username|private-name|normal body|reactive_count|normal_count/);
});

test("candidate output uses the required JSON byte format", () => {
  const bytes = Buffer.from(serializeJson(result([direct("alice", 1), direct("alice", 2)]).candidates), "utf8");
  assert.equal(bytes.toString("utf8").endsWith("\n"), true);
  assert.equal(prefixedSha256(bytes), `sha256:${bareHash(bytes)}`);
});

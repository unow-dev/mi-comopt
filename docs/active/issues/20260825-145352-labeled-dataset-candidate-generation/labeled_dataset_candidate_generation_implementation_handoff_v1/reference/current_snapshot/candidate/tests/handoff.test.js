import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveCurrentPublicationDir } from "../src/lib/publication.js";

const packageRoot = path.resolve(".");
const workflowScript = path.join(packageRoot, "scripts/candidate-workflow.mjs");
const handoffDocs = path.resolve("../docs/active/issues/20260824-065153-candidate-keyword-update-flow/candidate_keyword_update_handoff_v1.0.0");
const policyFile = path.join(handoffDocs, "policy/evaluation/1.0.0.json");
const taxonomyFile = path.join(handoffDocs, "policy/taxonomy/1.0.0.json");
const datasetFile = path.join(packageRoot, "tests/fixtures/e2e-dataset.json");
const baseData = path.join(packageRoot, "src/data");
const handoffNames = [
  "PROMPT_CONTRACT_v1.md",
  "candidate-proposal.schema.json",
  "candidate_generation_request.json",
  "candidate_view.json",
  "common.schema.json",
  "evaluation_policy.json",
  "handoff_manifest.json",
  "pre_evaluation.json",
  "prompt.txt",
  "source_dataset.json",
  "taxonomy.json",
];

function makePublicationRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-handoff-test-"));
  const publication = path.join(root, "publications", "base");
  fs.mkdirSync(publication, { recursive: true });
  for (const name of [
    "candidate_registry.json",
    "candidate_evaluation.json",
    "filterKeywordCandidates.json",
    "filterKeywordCandidates.meta.json",
    "run_manifest.json",
  ]) fs.copyFileSync(path.join(baseData, name), path.join(publication, name));
  fs.symlinkSync("publications/base", path.join(root, "current"), "dir");
  return root;
}

function runWorkflow(args) {
  return spawnSync(process.execPath, [workflowScript, ...args], { cwd: packageRoot, encoding: "utf8" });
}

function prepare(root, outdir) {
  const result = runWorkflow([
    "prepare-handoff",
    "--publication-root", root,
    "--dataset", datasetFile,
    "--policy", policyFile,
    "--taxonomy", taxonomyFile,
    "--source-ref", "fixture://e2e-dataset",
    "--request-id", "cgr_123e4567-e89b-42d3-a456-426614174000",
    "--outdir", outdir,
  ]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hash(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

test("resolveCurrentPublicationDir fixes the immutable target", () => {
  const root = makePublicationRoot();
  const resolved = resolveCurrentPublicationDir(root);
  const next = path.join(root, "publications", "next");
  fs.mkdirSync(next);
  fs.renameSync(path.join(root, "current"), path.join(root, "old-current"));
  fs.symlinkSync("publications/next", path.join(root, "current"), "dir");
  assert.equal(resolved, fs.realpathSync(path.join(root, "old-current")));
});

test("prepare-handoff emits deterministic 11-file bundle and raw copies", () => {
  const root = makePublicationRoot();
  const firstDir = path.join(root, "handoff-one");
  const secondDir = path.join(root, "handoff-two");
  const firstOutput = prepare(root, firstDir);
  prepare(root, secondDir);
  assert.equal(firstOutput.outdir, firstDir);
  assert.deepEqual(fs.readdirSync(firstDir).sort(), handoffNames);
  assert.deepEqual(
    handoffNames.map((name) => fs.readFileSync(path.join(firstDir, name))),
    handoffNames.map((name) => fs.readFileSync(path.join(secondDir, name))),
  );
  assert.deepEqual(fs.readFileSync(path.join(firstDir, "source_dataset.json")), fs.readFileSync(datasetFile));
  assert.deepEqual(fs.readFileSync(path.join(firstDir, "evaluation_policy.json")), fs.readFileSync(policyFile));
  assert.deepEqual(fs.readFileSync(path.join(firstDir, "taxonomy.json")), fs.readFileSync(taxonomyFile));
  const request = JSON.parse(fs.readFileSync(path.join(firstDir, "candidate_generation_request.json"), "utf8"));
  assert.equal(request.source_dataset.artifact_sha256, "sha256:2222222222222222222222222222222222222222222222222222222222222222");
  assert.notEqual(request.source_dataset.artifact_sha256, hash(fs.readFileSync(datasetFile)));
  const manifest = JSON.parse(fs.readFileSync(path.join(firstDir, "handoff_manifest.json"), "utf8"));
  for (const name of handoffNames.filter((item) => item !== "handoff_manifest.json")) assert.equal(manifest.files[name], hash(fs.readFileSync(path.join(firstDir, name))), name);
});

test("prepare-handoff rejects existing outdir without touching it", () => {
  const root = makePublicationRoot();
  const outdir = path.join(root, "existing");
  fs.mkdirSync(outdir);
  const sentinel = path.join(outdir, "sentinel");
  fs.writeFileSync(sentinel, "keep me");
  const result = runWorkflow([
    "prepare-handoff",
    "--publication-root", root,
    "--dataset", datasetFile,
    "--policy", policyFile,
    "--taxonomy", taxonomyFile,
    "--source-ref", "fixture://e2e-dataset",
    "--request-id", "cgr_123e4567-e89b-42d3-a456-426614174000",
    "--outdir", outdir,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HANDOFF_OUTPUT_EXISTS/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep me");
});

test("full-update verifies handoff bytes before publication", () => {
  const root = makePublicationRoot();
  const handoffDir = path.join(root, "handoff");
  prepare(root, handoffDir);
  const request = JSON.parse(fs.readFileSync(path.join(handoffDir, "candidate_generation_request.json"), "utf8"));
  const proposalFile = path.join(root, "candidate_proposal.json");
  fs.writeFileSync(proposalFile, `${JSON.stringify({ schema_version: 1, request_id: request.request_id, input_fingerprint: request.input_fingerprint, actions: [] }, null, 2)}\n`);
  const datasetPath = path.join(handoffDir, "source_dataset.json");
  fs.writeFileSync(datasetPath, `${fs.readFileSync(datasetPath, "utf8")}\n`);
  const result = runWorkflow([
    "full-update",
    "--registry", path.join(root, "current/candidate_registry.json"),
    "--request", path.join(handoffDir, "candidate_generation_request.json"),
    "--proposal", proposalFile,
    "--dataset", datasetPath,
    "--policy", path.join(handoffDir, "evaluation_policy.json"),
    "--taxonomy", path.join(handoffDir, "taxonomy.json"),
    "--candidate-view", path.join(handoffDir, "candidate_view.json"),
    "--pre-evaluation", path.join(handoffDir, "pre_evaluation.json"),
    "--handoff-manifest", path.join(handoffDir, "handoff_manifest.json"),
    "--outdir", root,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HANDOFF_MANIFEST_MISMATCH/);
  assert.equal(fs.readlinkSync(path.join(root, "current")), "publications/base");
});

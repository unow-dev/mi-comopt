import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");
const pipelineScript = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "Integrated_Labeling_Handoff_v1.5.0",
  "src",
  "pipeline.py",
);
const packagerScript = path.join(packageRoot, "scripts", "pack-three-class-workset.py");
const richFixturePath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "issues",
  "20260907-new-comments-dto-adapter",
  "new-comments-dto-adapter-handoff",
  "fixtures",
  "representative-v1.json",
);

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "three-class-workset-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
    stateDir: path.join(root, "state"),
  };
}

function runCli(command, args) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function writeJson(file, value, compact = false) {
  const bytes = Buffer.from(compact ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(file, bytes);
  return bytes;
}

function importBatch(caseData, rows, { compact = false, name = "batch.json" } = {}) {
  const inputPath = path.join(caseData.root, name);
  const bytes = writeJson(inputPath, rows, compact);
  const result = runCli("import-comment-batch", ["--input", inputPath, "--db", caseData.dbPath]);
  assert.equal(result.status, 0, result.stderr);
  return {
    payloadSha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

function referenceFor(rows, file, labels = []) {
  return writeJson(file, rows.map((row, index) => ({ ...row, label: labels[index] ?? "normal" })));
}

function generate(caseData, selectors, referencePath, workspacePath) {
  return runCli("generate-three-class-workset", [
    ...selectors,
    "--reference", referencePath,
    "--workspace", workspacePath,
    "--db", caseData.dbPath,
    "--state-dir", caseData.stateDir,
  ]);
}

function zipNames(zipPath) {
  const result = spawnSync("python3", ["-c", "import json, sys, zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", zipPath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function zipMemberBytes(zipPath, member) {
  const result = spawnSync("python3", ["-c", "import base64, sys, zipfile; print(base64.b64encode(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2])).decode())", zipPath, member], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return Buffer.from(result.stdout.trim(), "base64");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function worksetIdFromManifest(manifest) {
  const preimage = {
    schema_version: manifest.schema_version,
    protocol_version: manifest.protocol_version,
    request_id: manifest.request_id,
    members: manifest.members,
  };
  return createHash("sha256").update(JSON.stringify(canonicalValue(preimage)), "utf8").digest("hex");
}

function taskFiles(workspace, directory, prefix) {
  const root = path.join(workspace, "request", directory);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => name.startsWith(prefix) && name.endsWith(".json")).sort().map((name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8")));
}

const rowA = {
  username: "alice",
  handle: "@alice",
  comment: "ordinary comment",
  postedAt: "2026-09-08T00:00:00.000Z",
  postedDate: "2026-09-08",
};

test("generates a zero-handoff workspace and a bounded, self-verifying workset ZIP", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, [rowA]);
  const referencePath = path.join(caseData.root, "reference.json");
  referenceFor([rowA], referencePath);
  const exportedPath = path.join(caseData.root, "export.json");
  const exportedManifestPath = path.join(caseData.root, "export.manifest.json");
  const exported = runCli("export-analysis-input", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--output", exportedPath,
    "--manifest", exportedManifestPath,
    "--db", caseData.dbPath,
  ]);
  assert.equal(exported.status, 0, exported.stderr);

  const workspace = path.join(caseData.root, "workspace");
  const generated = generate(caseData, ["--snapshot-ref", `${imported.payloadSha256}:0`], referencePath, workspace);
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(generated.stdout, /generated workset=[0-9a-f]{64} request=[0-9a-f]{64} state=FINALIZED_NO_HANDOFF/);

  const workspaceManifest = JSON.parse(fs.readFileSync(path.join(workspace, "workset_manifest.json"), "utf8"));
  const requestManifest = JSON.parse(fs.readFileSync(path.join(workspace, "request", "manifest.json"), "utf8"));
  const receipt = JSON.parse(fs.readFileSync(path.join(workspace, "prepare_receipt.json"), "utf8"));
  assert.equal(workspaceManifest.request_id, requestManifest.request_id);
  assert.equal(workspaceManifest.request_id, receipt.request_id);
  assert.equal(workspaceManifest.workset_id, worksetIdFromManifest(workspaceManifest));
  assert.deepEqual(fs.readFileSync(path.join(workspace, "provenance", "analysis_input.json")), fs.readFileSync(exportedPath));
  assert.deepEqual(fs.readFileSync(path.join(workspace, "provenance", "analysis_input.manifest.json")), fs.readFileSync(exportedManifestPath));
  assert.deepEqual(fs.readFileSync(path.join(workspace, "provenance", "analysis_input.json")), fs.readFileSync(path.join(workspace, "snapshot", "input.json")));

  const zipPath = path.join(workspace, `three_class_workset_${workspaceManifest.workset_id}.zip`);
  const names = zipNames(zipPath);
  const expectedNames = ["README_FIRST.md", "provenance/analysis_input.json", "provenance/analysis_input.manifest.json", ...workspaceManifest.members.filter((member) => member.path.startsWith("request/")).map((member) => member.path), "workset_manifest.json"].sort();
  assert.deepEqual(names, expectedNames);
  assert.equal(names.some((name) => name.startsWith("snapshot/")), false);
  assert.equal(names.some((name) => name === "prepare_receipt.json"), false);
  assert.deepEqual(zipMemberBytes(zipPath, "README_FIRST.md"), fs.readFileSync(path.join(workspace, "README_FIRST.md")));
  assert.deepEqual(zipMemberBytes(zipPath, "provenance/analysis_input.json"), fs.readFileSync(path.join(workspace, "provenance", "analysis_input.json")));
  assert.deepEqual(zipMemberBytes(zipPath, "workset_manifest.json"), fs.readFileSync(path.join(workspace, "workset_manifest.json")));
  for (const member of workspaceManifest.members) {
    const bytes = fs.readFileSync(path.join(workspace, member.path));
    assert.equal(member.sha256, createHash("sha256").update(bytes).digest("hex"), member.path);
    assert.equal(member.bytes, bytes.length, member.path);
  }
  const readme = fs.readFileSync(path.join(workspace, "README_FIRST.md"), "utf8");
  assert.match(readme, /request\//);
  assert.match(readme, /provenance/);
  assert.match(readme, /zero-handoff/);
  assert.equal(fs.existsSync(path.join(workspace, "finalization_receipt.json")), true);
});

test("normalizes selector order and SHA/ref spelling while excluding unrelated snapshots from identity", (t) => {
  const caseData = makeCase(t);
  const first = importBatch(caseData, [rowA], { name: "first.json" });
  const rowB = { ...rowA, handle: "@bob", comment: "second ordinary comment" };
  const second = importBatch(caseData, [rowB], { name: "second.json" });
  const referencePath = path.join(caseData.root, "reference.json");
  referenceFor([rowA, rowB], referencePath);

  const firstWorkspace = path.join(caseData.root, "first-workspace");
  const firstResult = generate(caseData, ["--snapshot-ref", `${second.payloadSha256}:0`, "--snapshot-ref", `${first.payloadSha256}:0`], referencePath, firstWorkspace);
  assert.equal(firstResult.status, 0, firstResult.stderr);
  const firstManifest = JSON.parse(fs.readFileSync(path.join(firstWorkspace, "workset_manifest.json"), "utf8"));

  const secondWorkspace = path.join(caseData.root, "second-workspace");
  const secondResult = generate(caseData, ["--snapshot-ref", `${first.payloadSha256}:0`, "--snapshot-ref", `${second.payloadSha256}:0`], referencePath, secondWorkspace);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  const secondManifest = JSON.parse(fs.readFileSync(path.join(secondWorkspace, "workset_manifest.json"), "utf8"));
  assert.equal(firstManifest.request_id, secondManifest.request_id);
  assert.equal(firstManifest.workset_id, secondManifest.workset_id);
  assert.deepEqual(firstManifest.members, secondManifest.members);
  assert.deepEqual(fs.readFileSync(path.join(firstWorkspace, "provenance", "analysis_input.json")), fs.readFileSync(path.join(secondWorkspace, "provenance", "analysis_input.json")));

  const refWorkspace = path.join(caseData.root, "ref-workspace");
  const refResult = generate(caseData, ["--snapshot-ref", `${first.payloadSha256}:0`], referencePath, refWorkspace);
  assert.equal(refResult.status, 0, refResult.stderr);
  const refManifest = JSON.parse(fs.readFileSync(path.join(refWorkspace, "workset_manifest.json"), "utf8"));
  const shaWorkspace = path.join(caseData.root, "sha-workspace");
  const shaResult = generate(caseData, ["--snapshot-sha", first.payloadSha256], referencePath, shaWorkspace);
  assert.equal(shaResult.status, 0, shaResult.stderr);
  const shaManifest = JSON.parse(fs.readFileSync(path.join(shaWorkspace, "workset_manifest.json"), "utf8"));
  assert.equal(refManifest.request_id, shaManifest.request_id);
  assert.equal(refManifest.workset_id, shaManifest.workset_id);

  const unrelated = { ...rowA, handle: "@unrelated", comment: "unrelated snapshot" };
  importBatch(caseData, [unrelated], { name: "unrelated.json" });
  const afterWorkspace = path.join(caseData.root, "after-unrelated-workspace");
  const afterResult = generate(caseData, ["--snapshot-ref", `${first.payloadSha256}:0`], referencePath, afterWorkspace);
  assert.equal(afterResult.status, 0, afterResult.stderr);
  const afterManifest = JSON.parse(fs.readFileSync(path.join(afterWorkspace, "workset_manifest.json"), "utf8"));
  assert.equal(afterManifest.workset_id, refManifest.workset_id);
});

test("keeps request identity separate from provenance identity for byte-different equivalent projections", (t) => {
  const caseData = makeCase(t);
  const first = importBatch(caseData, [rowA], { name: "pretty.json" });
  const second = importBatch(caseData, [rowA], { compact: true, name: "compact.json" });
  assert.notEqual(first.payloadSha256, second.payloadSha256);
  const referencePath = path.join(caseData.root, "reference.json");
  referenceFor([rowA], referencePath);
  const firstWorkspace = path.join(caseData.root, "pretty-workspace");
  const secondWorkspace = path.join(caseData.root, "compact-workspace");
  assert.equal(generate(caseData, ["--snapshot-ref", `${first.payloadSha256}:0`], referencePath, firstWorkspace).status, 0);
  assert.equal(generate(caseData, ["--snapshot-ref", `${second.payloadSha256}:0`], referencePath, secondWorkspace).status, 0);
  const firstManifest = JSON.parse(fs.readFileSync(path.join(firstWorkspace, "workset_manifest.json"), "utf8"));
  const secondManifest = JSON.parse(fs.readFileSync(path.join(secondWorkspace, "workset_manifest.json"), "utf8"));
  assert.equal(firstManifest.request_id, secondManifest.request_id);
  assert.notEqual(firstManifest.workset_id, secondManifest.workset_id);
  assert.deepEqual(fs.readFileSync(path.join(firstWorkspace, "provenance", "analysis_input.json")), fs.readFileSync(path.join(secondWorkspace, "provenance", "analysis_input.json")));
  assert.notDeepEqual(fs.readFileSync(path.join(firstWorkspace, "provenance", "analysis_input.manifest.json")), fs.readFileSync(path.join(secondWorkspace, "provenance", "analysis_input.manifest.json")));
});

test("preserves the existing human-handoff artifact and remains finalize-compatible", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, [rowA]);
  const referencePath = path.join(caseData.root, "empty-reference.json");
  referenceFor([], referencePath);
  const workspace = path.join(caseData.root, "human-workspace");
  const generated = generate(caseData, ["--snapshot-ref", `${imported.payloadSha256}:0`], referencePath, workspace);
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(generated.stdout, /state=AWAITING_RESPONSE/);
  const requestManifest = JSON.parse(fs.readFileSync(path.join(workspace, "request", "manifest.json"), "utf8"));
  const stageTasks = taskFiles(workspace, "stage13", "S");
  const threeTasks = taskFiles(workspace, "three_class", "T");
  assert.equal(stageTasks.length, 1);
  const innerHandoff = path.join(workspace, `classification_handoff_${requestManifest.request_id}.zip`);
  assert.equal(fs.existsSync(innerHandoff), true);
  const outerZip = path.join(workspace, `three_class_workset_${JSON.parse(fs.readFileSync(path.join(workspace, "workset_manifest.json"), "utf8")).workset_id}.zip`);
  assert.equal(zipNames(outerZip).some((name) => name.startsWith("classification_handoff_")), false);

  const stageDecisions = Object.fromEntries(stageTasks.map((task) => [task.task_id, { label: "normal", note: "test decision" }]));
  const threeDecisions = Object.fromEntries(threeTasks.map((task) => {
    const activation = task.activation;
    const active = activation.kind === "unconditional" || (stageDecisions[activation.stage13_task_id]?.label === activation.stage13_label);
    return [task.task_id, active ? { reason_code: "normal_context", note: "test decision" } : null];
  }));
  const responsePath = path.join(caseData.root, "response.json");
  writeJson(responsePath, {
    schema_version: 1,
    request_id: requestManifest.request_id,
    stage13_decisions: stageDecisions,
    three_class_decisions: threeDecisions,
  });
  const finalized = spawnSync("python3", [pipelineScript, "finalize-single-roundtrip", "--workspace", workspace, "--response", responsePath, "--state-dir", caseData.stateDir], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(fs.existsSync(path.join(workspace, "final", "three_class_labeled.json")), true);
  assert.equal(fs.existsSync(innerHandoff), true);
  assert.equal(fs.existsSync(outerZip), true);
});

test("passes mixed rich and comment-batch snapshots through the unchanged projection boundary", (t) => {
  const caseData = makeCase(t);
  const richImport = runCli("import-new-comments", ["--input", richFixturePath, "--db", caseData.dbPath]);
  assert.equal(richImport.status, 0, richImport.stderr);
  const richSha = richImport.stdout.match(/payload=([0-9a-f]{64})/)[1];
  const batch = importBatch(caseData, [rowA]);
  const referencePath = path.join(caseData.root, "empty-reference.json");
  referenceFor([], referencePath);
  const workspace = path.join(caseData.root, "mixed-workspace");
  const generated = generate(caseData, [
    "--snapshot-ref", `${richSha}:1`,
    "--snapshot-ref", `${batch.payloadSha256}:0`,
  ], referencePath, workspace);
  assert.equal(generated.status, 0, generated.stderr);
  const projectionManifest = JSON.parse(fs.readFileSync(path.join(workspace, "provenance", "analysis_input.manifest.json"), "utf8"));
  assert.equal(projectionManifest.snapshots.length, 2);
  assert.deepEqual(projectionManifest.snapshots.map((snapshot) => snapshot.input_format).sort(), ["tiktokCommentBatch-1.0.0", "tiktokNewCommentsWrapper-1.0.0"].sort());
  assert.equal(projectionManifest.output_record_count, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, "provenance", "analysis_input.json"), "utf8")).length, 2);
});

test("fails closed for missing selection, existing workspace, pipeline errors, and transport symlinks", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, [rowA]);
  const referencePath = path.join(caseData.root, "reference.json");
  referenceFor([rowA], referencePath);
  const missingSelection = runCli("generate-three-class-workset", ["--reference", referencePath, "--workspace", path.join(caseData.root, "missing"), "--db", caseData.dbPath]);
  assert.equal(missingSelection.status, 2);
  assert.equal(fs.existsSync(path.join(caseData.root, "missing")), false);
  const duplicateSelector = generate(caseData, ["--snapshot-ref", `${imported.payloadSha256}:0`, "--snapshot-ref", `${imported.payloadSha256}:0`], referencePath, path.join(caseData.root, "duplicate-selector"));
  assert.equal(duplicateSelector.status, 2);
  const mixedSelector = generate(caseData, ["--snapshot-ref", `${imported.payloadSha256}:0`, "--snapshot-sha", imported.payloadSha256], referencePath, path.join(caseData.root, "mixed-selector"));
  assert.equal(mixedSelector.status, 2);
  const unknownSelector = generate(caseData, ["--snapshot-sha", "f".repeat(64)], referencePath, path.join(caseData.root, "unknown-selector"));
  assert.equal(unknownSelector.status, 1);
  assert.match(unknownSelector.stderr, /SNAPSHOT_NOT_FOUND/);

  const existing = path.join(caseData.root, "existing");
  fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing, "keep.txt"), "keep");
  const existingResult = generate(caseData, ["--snapshot-ref", `${imported.payloadSha256}:0`], referencePath, existing);
  assert.equal(existingResult.status, 1);
  assert.equal(fs.readFileSync(path.join(existing, "keep.txt"), "utf8"), "keep");

  const invalidReference = path.join(caseData.root, "invalid-reference.json");
  writeJson(invalidReference, { invalid: true });
  const failed = generate(caseData, ["--snapshot-ref", `${imported.payloadSha256}:0`], invalidReference, path.join(caseData.root, "pipeline-failure"));
  assert.equal(failed.status, 1);
  assert.equal(fs.existsSync(path.join(caseData.root, "pipeline-failure")), false);
  assert.equal(fs.readdirSync(caseData.root).some((name) => name.startsWith(".pipeline-failure.workset-")), false);

  const synthetic = path.join(caseData.root, "synthetic");
  fs.mkdirSync(path.join(synthetic, "provenance"), { recursive: true });
  fs.mkdirSync(path.join(synthetic, "request"));
  fs.writeFileSync(path.join(synthetic, "README_FIRST.md"), "readme");
  fs.writeFileSync(path.join(synthetic, "provenance", "analysis_input.json"), "[]\n");
  fs.writeFileSync(path.join(synthetic, "provenance", "analysis_input.manifest.json"), "{}\n");
  writeJson(path.join(synthetic, "request", "manifest.json"), { request_id: "a".repeat(64) });
  fs.symlinkSync(path.join(synthetic, "README_FIRST.md"), path.join(synthetic, "request", "symlink.txt"));
  const packaging = spawnSync("python3", [packagerScript, "--workspace", synthetic], { encoding: "utf8" });
  assert.equal(packaging.status, 3);
  assert.match(packaging.stderr, /symlink/);
  assert.equal(fs.existsSync(path.join(synthetic, "workset_manifest.json")), false);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFINITION_SNAPSHOT_HASHES, buildWorkDefinitions, validateAndHashDefinition } from "../src/workflow/definitions.js";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const HANDOFF = path.join(REPO_ROOT, "docs/active/issues/20260917-work-orchestrator-update-optimization/comment_db_v3_implementation_worker_handoff_20260917");
const NORMATIVE = path.join(HANDOFF, "normative");
const EXTRACTED = path.join(NORMATIVE, "extracted/comment_db_implementation_handoff_v3_closed2_20260917");
const LEDGER_PATH = path.join(HANDOFF, "implementation-evidence-v3.json");
const TRACEABILITY_PATH = path.join(EXTRACTED, "traceability-v3.json");

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

test("[V3-RV07] normative ZIP and extracted manifest remain immutable", () => {
  const zip = path.join(NORMATIVE, "comment_db_implementation_handoff_v3_closed2_20260917.zip");
  assert.equal(sha256(readFileSync(zip)), "0f7ff879a7233dda01da2016a315dc5e35e1a0d0535eee6a5cdc5e023ceabfcb");
  const manifest = readFileSync(path.join(EXTRACTED, "MANIFEST.sha256"), "utf8").trim().split(/\r?\n/).filter(Boolean);
  for (const line of manifest) {
    const match = /^([0-9a-f]{64})  \.\/(.+)$/.exec(line);
    assert.ok(match, `invalid manifest line: ${line}`);
    const filePath = path.join(EXTRACTED, match[2]);
    assert.ok(statSync(filePath).isFile(), `manifest file is missing: ${match[2]}`);
    assert.equal(sha256(readFileSync(filePath)), match[1], `manifest mismatch: ${match[2]}`);
  }
});

test("[V3-RV07] evidence ledger covers exactly 85 requirements and every mandatory verification mapping", () => {
  const traceability = JSON.parse(readFileSync(TRACEABILITY_PATH, "utf8"));
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  assert.equal(traceability.requirements.length, 85);
  assert.equal(ledger.requirements.length, 85);
  const traceById = new Map(traceability.requirements.map((item) => [item.requirementId, item]));
  assert.deepEqual(new Set(ledger.requirements.map((item) => item.requirementId)), new Set(traceById.keys()));
  for (const item of ledger.requirements) {
    const source = traceById.get(item.requirementId);
    assert.deepEqual(item.verificationIds, source.verificationIds, item.requirementId);
    assert.ok(ledger.allowedStatuses.includes(item.status), `${item.requirementId} has an invalid status`);
    if (item.status !== "not_started") assert.ok(item.implementationRefs.length > 0, `${item.requirementId} lacks implementation refs`);
  }
});

test("[V3-RV02][V3-RV03] frozen v2 definition hashes remain unchanged", () => {
  const definitions = buildWorkDefinitions().map((definition) => validateAndHashDefinition(definition));
  for (const definition of definitions) {
    const key = `${definition.workDefinitionId}@${definition.revision}`;
    if (Object.hasOwn(DEFINITION_SNAPSHOT_HASHES, key)) assert.equal(definition.definitionHash, DEFINITION_SNAPSHOT_HASHES[key], key);
  }
});

test("[V3-RV07] supporting handoff Markdown does not add uppercase RFC-2119 obligations", () => {
  const files = readdirSync(HANDOFF).filter((name) => name.endsWith(".md"));
  for (const name of files) {
    const text = readFileSync(path.join(HANDOFF, name), "utf8");
    assert.doesNotMatch(text, /\b(?:MUST|SHALL|MUST NOT|SHALL NOT)\b/, `${name} contains an unregistered uppercase RFC-2119 keyword`);
  }
});

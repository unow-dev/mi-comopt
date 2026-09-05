import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  validateGeneratedArtifacts,
} from "../src/processing/keyword-candidates/artifact-validation.js";
import {
  prefixedSha256,
  validateArtifactBindings,
  validateKeywordMeta,
  validatePolicy,
} from "../src/lib/account-block-candidate-workflow.js";

export const KEYWORD_ARTIFACTS = [
  "candidate_registry.json",
  "candidate_evaluation.json",
  "filterKeywordCandidates.json",
  "filterKeywordCandidates.meta.json",
  "run_manifest.json",
];
export const ACCOUNT_ARTIFACTS = [
  "accountBlockCandidates.json",
  "accountBlockCandidates.meta.json",
  "accountBlockCandidateRunManifest.json",
];
export const PUBLIC_ARTIFACTS = [...KEYWORD_ARTIFACTS, ...ACCOUNT_ARTIFACTS];
export const RAW_FIELDS = ["username", "handle", "comment", "postedAt", "postedDate"];
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const KEYWORD_CONTRACT_ROOT = path.resolve(new URL("../contracts/keyword-candidates", import.meta.url).pathname);
const ACCOUNT_CONTRACT_ROOT = path.resolve(new URL("../contracts/account-block-candidates", import.meta.url).pathname);
const ACCOUNT_GENERATOR = path.resolve(new URL("./account-block-candidate-workflow.mjs", import.meta.url).pathname);

function fail(message) {
  const error = new Error(message);
  error.code = "RELEASE_VERIFICATION_FAILED";
  throw error;
}

export function readJsonWithBytes(file, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(path.resolve(file));
  } catch (caught) {
    fail(`${label}を読み込めません: ${caught.message}`);
  }
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch (caught) {
    fail(`${label}のJSONが不正です: ${caught.message}`);
  }
}

export function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function normalizeSha(value, label) {
  const unprefixed = typeof value === "string" && value.startsWith("sha256:") ? value.slice(7) : value;
  if (typeof unprefixed !== "string" || !/^[0-9a-f]{64}$/.test(unprefixed)) fail(`${label} must be a 64-character lowercase SHA-256 hex value`);
  return `sha256:${unprefixed}`;
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) fail(`${label} must be a UTC second-precision timestamp`);
}

function assertRunId(value, label) {
  if (typeof value !== "string" || !RUN_ID.test(value)) fail(`${label} must be a UUIDv4 run_id`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\u001f") !== wanted.join("\u001f")) fail(`${label} fields do not match the release contract`);
}

export function validateRawSnapshot(value, label = "raw") {
  if (!Array.isArray(value)) fail(`${label} must be a top-level JSON array`);
  const wanted = [...RAW_FIELDS].sort();
  value.forEach((record, index) => {
    exactKeys(record, RAW_FIELDS, `${label}[${index}]`);
    if (Object.keys(record).sort().join("\u001f") !== wanted.join("\u001f")) fail(`${label}[${index}] fields do not match the five-field contract`);
    for (const field of RAW_FIELDS) {
      if (typeof record[field] !== "string") fail(`${label}[${index}].${field} must be a JSON string`);
    }
  });
  return value;
}

function validateLabeledSnapshot(value, labels, label) {
  if (!Array.isArray(value)) fail(`${label} must be a JSON array`);
  value.forEach((record, index) => {
    exactKeys(record, [...RAW_FIELDS, "label"], `${label}[${index}]`);
    for (const field of RAW_FIELDS) if (typeof record[field] !== "string") fail(`${label}[${index}].${field} must be a JSON string`);
    if (!labels.includes(record.label)) fail(`${label}[${index}].label is invalid`);
  });
  return value;
}

function assertAligned(raw, labeled, label) {
  if (raw.length !== labeled.length) fail(`${label} count does not match raw count`);
  for (let index = 0; index < raw.length; index += 1) {
    for (const field of RAW_FIELDS) if (raw[index][field] !== labeled[index][field]) fail(`${label}[${index}] is not aligned with raw`);
  }
}

function readDataArtifacts(dataDir) {
  const root = path.resolve(dataDir);
  const files = Object.fromEntries(PUBLIC_ARTIFACTS.map((name) => [name, readJsonWithBytes(path.join(root, name), name)]));
  return { root, files };
}

function readCanonicalContracts() {
  const evaluationPolicy = readJsonWithBytes(path.join(KEYWORD_CONTRACT_ROOT, "evaluation-policy-1.0.0.json"), "keyword evaluation policy");
  const taxonomy = readJsonWithBytes(path.join(KEYWORD_CONTRACT_ROOT, "taxonomy-1.0.0.json"), "keyword taxonomy");
  const accountPolicy = readJsonWithBytes(path.join(ACCOUNT_CONTRACT_ROOT, "accountBlockCandidatePolicy-1.0.0.json"), "account policy");
  return { evaluationPolicy, taxonomy, accountPolicy };
}

function validateKeywordSide(files, contracts) {
  const registry = files["candidate_registry.json"].value;
  const evaluation = files["candidate_evaluation.json"].value;
  const publishedCandidates = files["filterKeywordCandidates.json"].value;
  const meta = files["filterKeywordCandidates.meta.json"].value;
  const manifest = files["run_manifest.json"].value;
  try {
    validateGeneratedArtifacts({
      registry,
      evaluation,
      publishedCandidates,
      currentMeta: meta,
      manifest,
      taxonomy: contracts.taxonomy.value,
    });
  } catch (caught) {
    fail(caught.message ?? String(caught));
  }
  if (meta.evaluation_policy_content_sha256 !== prefixedSha256(contracts.evaluationPolicy.bytes)) fail("keyword evaluation policy is not bound to the canonical runtime contract");
  if (meta.taxonomy_content_sha256 !== prefixedSha256(contracts.taxonomy.bytes)) fail("keyword taxonomy is not bound to the canonical runtime contract");
  if (meta.run_id !== manifest.run_id) fail("keyword meta run_id does not match run manifest");
  if (meta.published_at !== manifest.published_at) fail("keyword meta published_at does not match run manifest");
  if (manifest.run_type === "full_update") normalizeSha(manifest.parent_manifest_content_sha256, "keyword parent manifest SHA");
  assertRunId(meta.run_id, "keyword meta.run_id");
  assertTimestamp(meta.published_at, "keyword meta.published_at");
  return { meta, manifest };
}

function validateAccountSide(files, contracts, keywordMeta) {
  try {
    validatePolicy(contracts.accountPolicy.value);
    validateKeywordMeta(keywordMeta);
    validateArtifactBindings({
      candidates: files["accountBlockCandidates.json"].value,
      candidatesBytes: files["accountBlockCandidates.json"].bytes,
      meta: files["accountBlockCandidates.meta.json"].value,
      metaBytes: files["accountBlockCandidates.meta.json"].bytes,
      manifest: files["accountBlockCandidateRunManifest.json"].value,
      manifestBytes: files["accountBlockCandidateRunManifest.json"].bytes,
      policy: contracts.accountPolicy.value,
      policyBytes: contracts.accountPolicy.bytes,
      generatorBytes: fs.readFileSync(ACCOUNT_GENERATOR),
      keywordMeta,
    });
  } catch (caught) {
    fail(caught.message ?? String(caught));
  }
  const meta = files["accountBlockCandidates.meta.json"].value;
  const manifest = files["accountBlockCandidateRunManifest.json"].value;
  assertRunId(meta.run_id, "account meta.run_id");
  assertTimestamp(meta.published_at, "account meta.published_at");
  return { meta, manifest };
}

export function validateReleaseRecord(release) {
  exactKeys(release, ["schema_version", "updated_at", "raw", "stage13", "three_class", "keyword", "account"], "data-release.json");
  if (release.schema_version !== 1) fail("data-release.json schema_version must be 1");
  assertTimestamp(release.updated_at, "data-release.updated_at");
  exactKeys(release.raw, ["sha256", "record_count", "scope_id", "source_ref"], "data-release.raw");
  normalizeSha(release.raw.sha256, "data-release.raw.sha256");
  if (!Number.isInteger(release.raw.record_count) || release.raw.record_count < 0) fail("data-release.raw.record_count must be a non-negative integer");
  if (typeof release.raw.scope_id !== "string" || release.raw.scope_id.length === 0) fail("data-release.raw.scope_id must be non-empty");
  if (typeof release.raw.source_ref !== "string" || release.raw.source_ref.length === 0) fail("data-release.raw.source_ref must be non-empty");
  exactKeys(release.stage13, ["sha256", "reference_sha256"], "data-release.stage13");
  normalizeSha(release.stage13.sha256, "data-release.stage13.sha256");
  normalizeSha(release.stage13.reference_sha256, "data-release.stage13.reference_sha256");
  exactKeys(release.three_class, ["sha256"], "data-release.three_class");
  normalizeSha(release.three_class.sha256, "data-release.three_class.sha256");
  for (const side of ["keyword", "account"]) {
    exactKeys(release[side], ["run_id", "published_at", "dataset_sha256"], `data-release.${side}`);
    assertRunId(release[side].run_id, `data-release.${side}.run_id`);
    assertTimestamp(release[side].published_at, `data-release.${side}.published_at`);
    normalizeSha(release[side].dataset_sha256, `data-release.${side}.dataset_sha256`);
  }
  const shared = release.three_class.sha256;
  if (release.keyword.dataset_sha256 !== shared || release.account.dataset_sha256 !== shared) fail("three-class, keyword and account dataset SHA values must match");
  return release;
}

export function buildDataRelease({ rawInput, stage13Input, stage13ReferenceInput, threeClassInput, dataDir, scopeId, sourceRef, updatedAt }) {
  const raw = validateRawSnapshot(rawInput.value);
  const stage13 = validateLabeledSnapshot(stage13Input.value, ["normal", "nuisance"], "stage13");
  validateLabeledSnapshot(stage13ReferenceInput.value, ["normal", "nuisance"], "stage13_reference");
  const threeClass = validateLabeledSnapshot(threeClassInput.value, ["direct_nuisance", "reactive", "normal"], "three_class");
  assertAligned(raw, stage13, "stage13");
  assertAligned(raw, threeClass, "three_class");
  const { files } = readDataArtifacts(dataDir);
  const contracts = readCanonicalContracts();
  const keyword = validateKeywordSide(files, contracts);
  const account = validateAccountSide(files, contracts, keyword.meta);
  if (typeof scopeId !== "string" || scopeId.length === 0) fail("--scope-id must be non-empty");
  if (typeof sourceRef !== "string" || sourceRef.length === 0) fail("--source-ref must be non-empty");
  const release = {
    schema_version: 1,
    updated_at: updatedAt,
    raw: { sha256: sha256(rawInput.bytes), record_count: raw.length, scope_id: scopeId, source_ref: sourceRef },
    stage13: { sha256: sha256(stage13Input.bytes), reference_sha256: sha256(stage13ReferenceInput.bytes) },
    three_class: { sha256: sha256(threeClassInput.bytes) },
    keyword: { run_id: keyword.meta.run_id, published_at: keyword.meta.published_at, dataset_sha256: normalizeSha(keyword.meta.dataset_artifact_sha256, "keyword dataset SHA") },
    account: { run_id: account.meta.run_id, published_at: account.meta.published_at, dataset_sha256: normalizeSha(account.meta.dataset_artifact_sha256, "account dataset SHA") },
  };
  validateReleaseRecord(release);
  return release;
}

export function verifyRelease({ release, dataDir }) {
  validateReleaseRecord(release);
  const { files } = readDataArtifacts(dataDir);
  const contracts = readCanonicalContracts();
  const keyword = validateKeywordSide(files, contracts);
  const account = validateAccountSide(files, contracts, keyword.meta);
  if (release.keyword.run_id !== keyword.meta.run_id || release.keyword.run_id !== keyword.manifest.run_id) fail("release keyword run_id does not match public artifacts");
  if (release.account.run_id !== account.meta.run_id || release.account.run_id !== account.manifest.run_id) fail("release account run_id does not match public artifacts");
  if (release.keyword.published_at !== keyword.meta.published_at || release.keyword.published_at !== keyword.manifest.published_at) fail("release keyword published_at does not match public artifacts");
  if (release.account.published_at !== account.meta.published_at || release.account.published_at !== account.manifest.published_at) fail("release account published_at does not match public artifacts");
  if (release.keyword.dataset_sha256 !== normalizeSha(keyword.meta.dataset_artifact_sha256, "keyword dataset SHA")) fail("release keyword dataset SHA does not match public artifacts");
  if (release.account.dataset_sha256 !== normalizeSha(account.meta.dataset_artifact_sha256, "account dataset SHA")) fail("release account dataset SHA does not match public artifacts");
  return true;
}

export function serializeRelease(release) {
  return `${JSON.stringify(release, null, 2)}\n`;
}

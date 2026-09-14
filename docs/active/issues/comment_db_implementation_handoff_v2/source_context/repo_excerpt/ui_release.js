import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildAccountCandidates,
  prefixedSha256,
  serializeJson,
  validateCandidateArtifact,
  validatePolicy as validateAccountPolicy,
} from "../account-block-candidates/account-block-candidate-workflow.js";
import { contentSha256 } from "../keyword-candidates/candidate-workflow.js";
import { buildOverviewArtifact, validateOverviewArtifact } from "./overview.js";
import { validateSourceDataset } from "./source-dataset.js";

export const UI_RELEASE_ROOT = "optimicom-ui-release.json";
export const UI_RELEASE_SCHEMA_VERSION = 1;
export const UI_ARTIFACT_KEYS = ["comments", "overview", "keywords", "accounts"];
const UI_ARTIFACT_PREFIXES = {
  comments: "source-dataset",
  overview: "overview",
  keywords: "filter-keyword-candidates",
  accounts: "account-block-candidates",
};
const LABELS = ["normal", "reactive", "direct_nuisance"];
const KEYWORD_RECOMMENDATIONS = ["高推奨", "中推奨", "任意"];
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEYWORD_FIELDS = [
  "candidate_id",
  "keyword",
  "variants",
  "category_id",
  "category",
  "recommendation",
  "match_type",
  "direct_nuisance_hits",
  "reactive_hits",
  "normal_hits",
  "precision_excluding_reactive",
  "direct_recall_contribution",
  "normal_hit_rate",
  "utility_score",
  "introduced_at",
];

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, context) {
  if (!isObject(value) || Object.keys(value).sort().join("\u001f") !== [...expected].sort().join("\u001f")) {
    fail("UI_RELEASE_INVALID", `${context} fields are invalid`);
  }
}

function assertTimestamp(value, context) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail("UI_RELEASE_INVALID", `${context} must be an ISO timestamp`);
}

function assertSha(value, context) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("UI_RELEASE_INVALID", `${context} must be sha256:<64 lowercase hex>`);
}

function assertRunId(value, context) {
  if (typeof value !== "string" || !RUN_ID.test(value)) fail("UI_RELEASE_INVALID", `${context} must be a UUIDv4 run_id`);
}

function assertNonNegativeInteger(value, context) {
  if (!Number.isSafeInteger(value) || value < 0) fail("UI_RELEASE_INVALID", `${context} must be a non-negative integer`);
}

function validateKeywordCandidates(candidates) {
  if (!Array.isArray(candidates)) fail("KEYWORD_ARTIFACT_INVALID", "keyword artifact must be an array");
  candidates.forEach((candidate, index) => {
    exactKeys(candidate, KEYWORD_FIELDS, `keywords[${index}]`);
    for (const field of ["candidate_id", "keyword", "category_id", "category", "match_type"]) {
      if (typeof candidate[field] !== "string") fail("KEYWORD_ARTIFACT_INVALID", `keywords[${index}].${field} must be a string`);
    }
    if (!Array.isArray(candidate.variants) || candidate.variants.some((variant) => typeof variant !== "string")) fail("KEYWORD_ARTIFACT_INVALID", `keywords[${index}].variants is invalid`);
    if (!KEYWORD_RECOMMENDATIONS.includes(candidate.recommendation)) fail("KEYWORD_ARTIFACT_INVALID", `keywords[${index}].recommendation is invalid`);
    if (candidate.match_type !== "normalized_substring") fail("KEYWORD_ARTIFACT_INVALID", `keywords[${index}].match_type is invalid`);
    for (const field of ["direct_nuisance_hits", "reactive_hits", "normal_hits"]) assertNonNegativeInteger(candidate[field], `keywords[${index}].${field}`);
    if (!Number.isSafeInteger(candidate.utility_score)) fail("KEYWORD_ARTIFACT_INVALID", `keywords[${index}].utility_score is invalid`);
    for (const field of ["precision_excluding_reactive", "direct_recall_contribution", "normal_hit_rate"]) {
      if (candidate[field] !== null && (typeof candidate[field] !== "number" || !Number.isFinite(candidate[field]) || candidate[field] < 0 || candidate[field] > 1)) fail("KEYWORD_ARTIFACT_INVALID", `keywords[${index}].${field} is invalid`);
    }
    if (candidate.introduced_at !== null) assertTimestamp(candidate.introduced_at, `keywords[${index}].introduced_at`);
  });
  return candidates;
}

function buildAccountProjection(sourceDataset) {
  return sourceDataset.records.map(({ source_index: _sourceIndex, ...record }) => record);
}

export function buildOptimicomUiArtifacts({ sourceDataset, sourceDatasetBytes, keywords, keywordBytes, accountPolicy, overview = undefined }) {
  validateSourceDataset(sourceDataset);
  if (!Buffer.isBuffer(sourceDatasetBytes)) fail("SOURCE_DATASET_INVALID", "source dataset bytes are required");
  const expectedSourceBytes = Buffer.from(serializeJson(sourceDataset), "utf8");
  if (!expectedSourceBytes.equals(sourceDatasetBytes)) fail("SOURCE_DATASET_INVALID", "source dataset bytes do not match deterministic serialization");
  validateKeywordCandidates(keywords);
  if (!Buffer.isBuffer(keywordBytes)) fail("KEYWORD_ARTIFACT_INVALID", "keyword artifact bytes are required");
  let parsedKeywordBytes;
  try { parsedKeywordBytes = JSON.parse(keywordBytes.toString("utf8")); } catch (error) { fail("KEYWORD_ARTIFACT_INVALID", `keyword artifact bytes are not valid JSON: ${error.message}`); }
  if (JSON.stringify(parsedKeywordBytes) !== JSON.stringify(keywords)) fail("KEYWORD_ARTIFACT_INVALID", "keyword artifact bytes do not preserve current publication order/content");
  validateAccountPolicy(accountPolicy);
  const accountResult = buildAccountCandidates(buildAccountProjection(sourceDataset), accountPolicy);
  validateCandidateArtifact(accountResult.candidates, accountPolicy);
  const overviewArtifact = overview ?? buildOverviewArtifact(sourceDataset);
  validateOverviewArtifact(overviewArtifact);
  const dataArtifacts = {
    comments: sourceDatasetBytes,
    overview: Buffer.from(serializeJson(overviewArtifact), "utf8"),
    keywords: keywordBytes,
    accounts: Buffer.from(serializeJson(accountResult.candidates), "utf8"),
  };
  const artifactMeta = Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => {
    const bytes = dataArtifacts[key];
    const artifactSha256 = prefixedSha256(bytes);
    return [key, {
      path: `artifacts/${UI_ARTIFACT_PREFIXES[key]}.${artifactSha256.slice(7)}.json`,
      artifact_sha256: artifactSha256,
      record_count: key === "comments"
        ? sourceDataset.records.length
        : key === "overview" ? overviewArtifact.daily.length
          : key === "keywords" ? keywords.length : accountResult.candidates.length,
    }];
  }));
  return {
    dataArtifacts,
    artifactMeta,
    accountCandidates: accountResult.candidates,
    overview: overviewArtifact,
  };
}

export function buildOptimicomUiRelease({
  sourceDataset,
  sourceDatasetBytes,
  keywords,
  keywordBytes,
  publication,
  currentMeta,
  accountPolicy,
  accountPolicyBytes,
  keywordPolicy,
  generatedAt = new Date().toISOString(),
}) {
  if (!isObject(publication) || !isObject(currentMeta)) fail("KEYWORD_PUBLICATION_INVALID", "keyword publication metadata is required");
  if (currentMeta.schema_version !== 1 || publication.run_id !== currentMeta.run_id) fail("KEYWORD_PUBLICATION_INVALID", "current publication metadata is inconsistent");
  assertRunId(publication.run_id, "source.keyword_publication.run_id");
  assertTimestamp(publication.published_at, "source.keyword_publication.published_at");
  assertTimestamp(publication.applied_at, "source.keyword_publication.applied_at");
  assertSha(currentMeta.candidates_content_sha256, "source.keyword_publication.candidates_content_sha256");
  if (currentMeta.candidates_content_sha256 !== contentSha256(keywords)) fail("KEYWORD_PUBLICATION_INVALID", "keyword semantic hash does not match current publication");
  if (keywordPolicy && currentMeta.evaluation_policy_content_sha256 !== contentSha256(keywordPolicy)) fail("KEYWORD_PUBLICATION_INVALID", "keyword policy hash does not match current publication");
  if (keywordPolicy && currentMeta.evaluation_policy_version !== keywordPolicy.policy_version) fail("KEYWORD_PUBLICATION_INVALID", "keyword policy version does not match current publication");
  validateAccountPolicy(accountPolicy);
  if (!Buffer.isBuffer(accountPolicyBytes)) fail("ACCOUNT_POLICY_INVALID", "account policy bytes are required");
  const artifacts = buildOptimicomUiArtifacts({ sourceDataset, sourceDatasetBytes, keywords, keywordBytes, accountPolicy });
  assertTimestamp(generatedAt, "generated_at");
  const sourceDatasetSha = prefixedSha256(sourceDatasetBytes);
  if (publication.source_dataset_artifact_sha256 !== sourceDatasetSha) fail("KEYWORD_PUBLICATION_INVALID", "source dataset SHA does not match current publication");
  return {
    manifest: {
      schema_version: UI_RELEASE_SCHEMA_VERSION,
      generated_at: generatedAt,
      source: {
        db_schema_version: 8,
        snapshot_ref: {
          payload_sha256: sourceDataset.snapshot_ref.payload_sha256,
          snapshot_index: sourceDataset.snapshot_ref.snapshot_index,
        },
        source_dataset_artifact_sha256: sourceDatasetSha,
        keyword_publication: {
          run_id: publication.run_id,
          published_at: publication.published_at,
          applied_at: publication.applied_at,
          candidates_content_sha256: currentMeta.candidates_content_sha256,
        },
      },
      policies: {
        keyword: {
          version: keywordPolicy?.policy_version ?? currentMeta.evaluation_policy_version,
          content_sha256: keywordPolicy ? contentSha256(keywordPolicy) : currentMeta.evaluation_policy_content_sha256,
        },
        account: {
          version: accountPolicy.policy_version,
          content_sha256: prefixedSha256(accountPolicyBytes),
        },
      },
      artifacts: artifacts.artifactMeta,
    },
    dataArtifacts: artifacts.dataArtifacts,
    accountCandidates: artifacts.accountCandidates,
    overview: artifacts.overview,
  };
}

function safeArtifactPath(value, context) {
  if (typeof value !== "string" || path.posix.isAbsolute(value) || value.includes("?") || value.includes("#") || value.split("/").includes("..")) fail("UI_RELEASE_INVALID", `${context} path is unsafe`);
  return value;
}

export function validateOptimicomUiReleaseManifest(manifest) {
  exactKeys(manifest, ["schema_version", "generated_at", "source", "policies", "artifacts"], "release");
  if (manifest.schema_version !== 1) fail("UI_RELEASE_INVALID", "schema_version must be 1");
  assertTimestamp(manifest.generated_at, "generated_at");
  exactKeys(manifest.source, ["db_schema_version", "snapshot_ref", "source_dataset_artifact_sha256", "keyword_publication"], "release.source");
  if (manifest.source.db_schema_version !== 8) fail("UI_RELEASE_INVALID", "db_schema_version must be 8");
  exactKeys(manifest.source.snapshot_ref, ["payload_sha256", "snapshot_index"], "release.source.snapshot_ref");
  if (!HEX_SHA256.test(manifest.source.snapshot_ref.payload_sha256) || !Number.isSafeInteger(manifest.source.snapshot_ref.snapshot_index) || manifest.source.snapshot_ref.snapshot_index < 0) fail("UI_RELEASE_INVALID", "snapshot_ref is invalid");
  assertSha(manifest.source.source_dataset_artifact_sha256, "source.source_dataset_artifact_sha256");
  exactKeys(manifest.source.keyword_publication, ["run_id", "published_at", "applied_at", "candidates_content_sha256"], "release.source.keyword_publication");
  assertRunId(manifest.source.keyword_publication.run_id, "source.keyword_publication.run_id");
  assertTimestamp(manifest.source.keyword_publication.published_at, "source.keyword_publication.published_at");
  assertTimestamp(manifest.source.keyword_publication.applied_at, "source.keyword_publication.applied_at");
  assertSha(manifest.source.keyword_publication.candidates_content_sha256, "source.keyword_publication.candidates_content_sha256");
  exactKeys(manifest.policies, ["keyword", "account"], "release.policies");
  for (const key of ["keyword", "account"]) {
    exactKeys(manifest.policies[key], ["version", "content_sha256"], `release.policies.${key}`);
    if (typeof manifest.policies[key].version !== "string" || manifest.policies[key].version.length === 0) fail("UI_RELEASE_INVALID", `release.policies.${key}.version is invalid`);
    assertSha(manifest.policies[key].content_sha256, `release.policies.${key}.content_sha256`);
  }
  exactKeys(manifest.artifacts, UI_ARTIFACT_KEYS, "release.artifacts");
  for (const key of UI_ARTIFACT_KEYS) {
    const artifact = manifest.artifacts[key];
    exactKeys(artifact, ["path", "artifact_sha256", "record_count"], `release.artifacts.${key}`);
    const artifactPath = safeArtifactPath(artifact.path, `release.artifacts.${key}`);
    const expectedPrefix = `artifacts/${UI_ARTIFACT_PREFIXES[key]}.`;
    if (!artifactPath.startsWith(expectedPrefix) || !artifactPath.endsWith(".json")) fail("UI_RELEASE_INVALID", `release.artifacts.${key}.path is invalid`);
    assertSha(artifact.artifact_sha256, `release.artifacts.${key}.artifact_sha256`);
    if (artifactPath !== `${expectedPrefix}${artifact.artifact_sha256.slice(7)}.json`) fail("UI_RELEASE_INVALID", `release.artifacts.${key}.path is not content addressed`);
    assertNonNegativeInteger(artifact.record_count, `release.artifacts.${key}.record_count`);
  }
  if (manifest.artifacts.comments.artifact_sha256 !== manifest.source.source_dataset_artifact_sha256) fail("UI_RELEASE_INVALID", "comments artifact is not the source dataset");
  return manifest;
}

function parseArtifact(bytes, key) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    fail("UI_ARTIFACT_INVALID", `${key} is not valid JSON: ${error.message}`);
  }
}

export function validateOptimicomUiArtifactBytes(manifest, dataArtifacts) {
  validateOptimicomUiReleaseManifest(manifest);
  const parsedArtifacts = {};
  for (const key of UI_ARTIFACT_KEYS) {
    const bytes = dataArtifacts[key];
    if (!Buffer.isBuffer(bytes)) fail("UI_ARTIFACT_MISSING", `${key} artifact bytes are missing`);
    if (prefixedSha256(bytes) !== manifest.artifacts[key].artifact_sha256) fail("UI_ARTIFACT_SHA_MISMATCH", `${key} artifact SHA does not match release`);
    const value = parseArtifact(bytes, key);
    parsedArtifacts[key] = value;
    if (key === "comments") {
      validateSourceDataset(value);
      if (value.snapshot_ref.payload_sha256 !== manifest.source.snapshot_ref.payload_sha256 || value.snapshot_ref.snapshot_index !== manifest.source.snapshot_ref.snapshot_index) fail("UI_ARTIFACT_INVALID", "comments snapshot identity does not match release");
      if (value.records.length !== manifest.artifacts.comments.record_count) fail("UI_ARTIFACT_COUNT_MISMATCH", "comments record count does not match release");
    } else if (key === "overview") {
      validateOverviewArtifact(value);
      if (value.daily.length !== manifest.artifacts.overview.record_count) fail("UI_ARTIFACT_COUNT_MISMATCH", "overview record count does not match release");
    } else if (key === "keywords") {
      validateKeywordCandidates(value);
      if (contentSha256(value) !== manifest.source.keyword_publication.candidates_content_sha256) fail("KEYWORD_ARTIFACT_HASH_MISMATCH", "keyword semantic hash does not match release");
      if (value.length !== manifest.artifacts.keywords.record_count) fail("UI_ARTIFACT_COUNT_MISMATCH", "keyword record count does not match release");
    } else {
      validateCandidateArtifact(value, { schema_version: 1, policy_version: manifest.policies.account.version, candidate_label: "direct_nuisance", minimum_behavior_events: 2, evidence_sample_size: 2 });
      if (value.length !== manifest.artifacts.accounts.record_count) fail("UI_ARTIFACT_COUNT_MISMATCH", "account record count does not match release");
    }
  }
  const expectedCommentsBytes = Buffer.from(serializeJson(parsedArtifacts.comments), "utf8");
  if (!expectedCommentsBytes.equals(dataArtifacts.comments)) fail("UI_ARTIFACT_INVALID", "comments artifact is not the deterministic source dataset bytes");
  const expectedOverview = buildOverviewArtifact(parsedArtifacts.comments);
  if (JSON.stringify(expectedOverview) !== JSON.stringify(parsedArtifacts.overview)) fail("OVERVIEW_INVALID", "overview cannot be reproduced from comments artifact");
  const accountPolicy = {
    schema_version: 1,
    policy_version: manifest.policies.account.version,
    candidate_label: "direct_nuisance",
    minimum_behavior_events: 2,
    evidence_sample_size: 2,
  };
  const expectedAccounts = buildAccountCandidates(buildAccountProjection(parsedArtifacts.comments), accountPolicy).candidates;
  if (JSON.stringify(expectedAccounts) !== JSON.stringify(parsedArtifacts.accounts)) fail("ACCOUNT_ARTIFACT_INVALID", "account artifact cannot be reproduced from comments artifact");
  return true;
}

export function validateOptimicomUiReleaseAtRoot(releasePath) {
  const absolute = path.resolve(releasePath);
  const rootDir = path.dirname(absolute);
  let manifestBytes;
  try {
    manifestBytes = fs.readFileSync(absolute);
  } catch (error) {
    fail("UI_RELEASE_NOT_FOUND", `${absolute}: ${error.message}`);
  }
  const manifest = parseArtifact(manifestBytes, "release manifest");
  validateOptimicomUiReleaseManifest(manifest);
  const dataArtifacts = Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => {
    const artifactPath = safeArtifactPath(manifest.artifacts[key].path, `release.artifacts.${key}`);
    const resolved = path.resolve(rootDir, artifactPath);
    if (!resolved.startsWith(`${rootDir}${path.sep}`)) fail("UI_RELEASE_INVALID", `${key} artifact escapes release root`);
    try {
      return [key, fs.readFileSync(resolved)];
    } catch (error) {
      fail("UI_ARTIFACT_MISSING", `${key}: ${error.message}`);
    }
  }));
  validateOptimicomUiArtifactBytes(manifest, dataArtifacts);
  return { manifest, manifestBytes, dataArtifacts, rootDir };
}

export function releaseIdentity(manifest) {
  validateOptimicomUiReleaseManifest(manifest);
  return JSON.stringify({ source: manifest.source, policies: manifest.policies, artifacts: manifest.artifacts });
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readSelectedSnapshotsInReferenceOrder } from "../database/raw-snapshot-repository.js";
import { projectCumulativeCorpus } from "../processing/analysis-input/raw-snapshot-projection.js";
import {
  buildCumulativeSourceDataset,
  serializeCumulativeSourceDataset,
} from "../processing/optimicom-ui-release/source-dataset.js";
import {
  buildOptimicomUiRelease,
  UI_ARTIFACT_KEYS,
  UI_RELEASE_ROOT,
} from "../processing/optimicom-ui-release/release.js";
import {
  advanceFirstPublicationHistory,
  applyChangeSet,
  buildPublishedCandidates,
  conflictSet,
  contentSha256,
  evaluateCandidates,
} from "../processing/keyword-candidates/candidate-workflow.js";
import {
  canonicalJson,
  prefixedSha256,
} from "../state/canonical.js";
import { stateError } from "../state/errors.js";
import { PACKAGE_ROOT, REPOSITORY_ROOT } from "../database/comment-database.js";

export const DEFAULT_UI_PUBLICATION_ROOT = path.join(
  REPOSITORY_ROOT,
  "work",
  "20260826",
  "candidate-publication-final",
);
export const UI_PUBLIC_ROOT = "docs/active/temp/optimicom-react-tailwind/public";
export { UI_RELEASE_ROOT };

const KEYWORD_POLICY_PATH = path.join(
  PACKAGE_ROOT,
  "contracts",
  "keyword-candidates",
  "evaluation-policy-1.0.0.json",
);
const KEYWORD_TAXONOMY_PATH = path.join(
  PACKAGE_ROOT,
  "contracts",
  "keyword-candidates",
  "taxonomy-1.0.0.json",
);
const ACCOUNT_POLICY_PATH = path.join(
  PACKAGE_ROOT,
  "contracts",
  "account-block-candidates",
  "accountBlockCandidatePolicy-1.0.0.json",
);

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw stateError("UI_RELEASE_BUILD_FAILED", `${label} is invalid JSON: ${error.message}`);
  }
}

function requiredVersion(controlPlane, versionId, label) {
  const version = controlPlane.readVersion(versionId);
  if (!version) throw stateError("UI_RELEASE_BUILD_FAILED", `${label} ${versionId} was not found`);
  return version;
}

function stateOf(version) {
  return version?.payload?.state ?? version?.payload ?? {};
}

function utcSecond(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw stateError("UI_RELEASE_BUILD_FAILED", `invalid release timestamp: ${value}`);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function deterministicUuid(seed) {
  const characters = crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32).split("");
  characters[12] = "4";
  characters[16] = ["8", "9", "a", "b"][Number.parseInt(characters[16], 16) % 4];
  return [
    characters.slice(0, 8).join(""),
    characters.slice(8, 12).join(""),
    characters.slice(12, 16).join(""),
    characters.slice(16, 20).join(""),
    characters.slice(20).join(""),
  ].join("-");
}

function normalizeSnapshotRefs(corpusState) {
  const refs = corpusState?.snapshot_refs ?? corpusState?.snapshotRefs;
  if (!Array.isArray(refs) || refs.length === 0) throw stateError("UI_RELEASE_BUILD_FAILED", "corpus version has no snapshot references");
  return refs.map((reference) => {
    const payloadSha256 = reference?.payloadSha256 ?? reference?.payload_sha256;
    const snapshotIndex = reference?.snapshotIndex ?? reference?.snapshot_index;
    if (!/^[0-9a-f]{64}$/.test(String(payloadSha256)) || !Number.isSafeInteger(Number(snapshotIndex)) || Number(snapshotIndex) < 0) {
      throw stateError("UI_RELEASE_BUILD_FAILED", "corpus snapshot reference is invalid");
    }
    return { payloadSha256, snapshotIndex: Number(snapshotIndex) };
  });
}

function sourceDatasetFromRelease(controlPlane, pins) {
  const corpusVersion = requiredVersion(controlPlane, pins.corpusVersionId, "corpus version");
  const classificationVersion = requiredVersion(controlPlane, pins.classificationVersionId, "classification version");
  const snapshotRefs = normalizeSnapshotRefs(stateOf(corpusVersion));
  const selected = readSelectedSnapshotsInReferenceOrder(controlPlane.db, snapshotRefs);
  const projection = projectCumulativeCorpus(selected);
  const observationIds = projection.survivors.map((observation) => String(observation.observationId));
  const labels = [];
  for (let offset = 0; offset < observationIds.length; offset += 500) {
    const batch = observationIds.slice(offset, offset + 500);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = controlPlane.db.prepare(
      `SELECT observation_id, label
         FROM classification_state_labels
        WHERE version_id = ? AND observation_id IN (${placeholders})`,
    ).all(pins.classificationVersionId, ...batch);
    labels.push(...rows.map((row) => ({
      observationId: String(row.observation_id),
      label: row.label,
    })));
  }
  const dataset = buildCumulativeSourceDataset({
    corpusVersionId: pins.corpusVersionId,
    classificationVersionId: pins.classificationVersionId,
    snapshotRefs,
    survivors: projection.survivors,
    labelRows: labels,
  });
  const bytes = serializeCumulativeSourceDataset(dataset);
  return { dataset, bytes, artifactSha256: prefixedSha256(bytes) };
}

function loadBaseRegistry(publicationRoot) {
  const registryPath = path.join(path.resolve(publicationRoot), "current", "candidate_registry.json");
  if (!fs.existsSync(registryPath)) throw stateError("UI_RELEASE_BUILD_FAILED", `base candidate registry was not found: ${registryPath}`);
  return readJson(registryPath, "base candidate registry");
}

function accountPolicyFromPinnedVersion(controlPlane, versionId, accountPolicy) {
  const version = requiredVersion(controlPlane, versionId, "account policy version");
  const pinned = stateOf(version);
  for (const field of ["schema_version", "policy_version", "candidate_label", "minimum_behavior_events", "evidence_sample_size"]) {
    if (pinned[field] !== accountPolicy[field]) {
      throw stateError("UI_RELEASE_BUILD_FAILED", `account policy field ${field} does not match the pinned DB policy`);
    }
  }
  return accountPolicy;
}

function keywordActions(controlPlane, pins, releaseId) {
  const version = requiredVersion(controlPlane, pins.keywordSelectionVersionId, "keyword-selection version");
  const payload = version.payload ?? {};
  const state = stateOf(version);
  if (!Array.isArray(state.entries)) throw stateError("UI_RELEASE_BUILD_FAILED", "keyword-selection version has no entries");
  const inputFingerprint = payload.candidateInputFingerprint;
  if (typeof inputFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(inputFingerprint)) {
    throw stateError("UI_RELEASE_BUILD_FAILED", "keyword-selection version has no candidate input fingerprint");
  }
  return state.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || typeof entry.action !== "string") {
      throw stateError("UI_RELEASE_BUILD_FAILED", `keyword-selection entry ${index} is invalid`);
    }
    const action = {
      action_id: `act_${String(index + 1).padStart(4, "0")}`,
      action: entry.action,
    };
    if (entry.action === "add") {
      action.candidate_id = `kw_${deterministicUuid(`${inputFingerprint}:${index}:${entry.keyword}`)}`;
    } else if (typeof entry.candidate_id === "string") {
      action.candidate_id = entry.candidate_id;
    }
    for (const field of ["keyword", "variants", "category_id"]) {
      if (entry[field] !== undefined) action[field] = entry[field];
    }
    return action;
  });
}

export function buildDbBackedUiRelease({ controlPlane, releaseId, pins, publicationRoot = DEFAULT_UI_PUBLICATION_ROOT } = {}) {
  if (!controlPlane) throw stateError("UI_RELEASE_BUILD_FAILED", "controlPlane is required");
  if (typeof releaseId !== "string" || releaseId.length === 0) throw stateError("UI_RELEASE_BUILD_FAILED", "releaseId is required");
  const release = controlPlane.db.prepare("SELECT * FROM v3_release_bundles WHERE release_id = ?").get(releaseId);
  if (!release) throw stateError("UI_RELEASE_BUILD_FAILED", `release ${releaseId} was not found`);
  const releasePins = pins ?? JSON.parse(release.pins_json);
  const source = sourceDatasetFromRelease(controlPlane, releasePins);
  const keywordPolicy = readJson(KEYWORD_POLICY_PATH, "keyword policy");
  const taxonomy = readJson(KEYWORD_TAXONOMY_PATH, "keyword taxonomy");
  const accountPolicyBytes = fs.readFileSync(ACCOUNT_POLICY_PATH);
  const accountPolicy = accountPolicyFromPinnedVersion(
    controlPlane,
    releasePins.accountPolicyVersionId,
    readJson(ACCOUNT_POLICY_PATH, "account policy"),
  );
  const registry = loadBaseRegistry(publicationRoot);
  const publishedAt = utcSecond(release.created_at);
  const knownConflictKeys = [...conflictSet(registry)];
  const registryAfter = applyChangeSet(registry, { actions: keywordActions(controlPlane, releasePins, releaseId) }, {
    publishedAt,
    taxonomy,
    knownConflictKeys,
  });
  const evaluation = evaluateCandidates({
    registry: registryAfter,
    dataset: source.dataset,
    policy: keywordPolicy,
    taxonomy,
    artifactSha256: source.artifactSha256,
    knownConflictKeys,
  });
  const finalRegistry = advanceFirstPublicationHistory(registryAfter, evaluation, publishedAt);
  const keywords = buildPublishedCandidates({ registry: finalRegistry, evaluation, taxonomy });
  const keywordBytes = Buffer.from(JSON.stringify(keywords, null, 2) + "\n", "utf8");
  const projectionRunId = `run_${deterministicUuid(`comment-db-v3-ui-projection:${releaseId}`)}`;
  const currentMeta = {
    schema_version: 1,
    run_id: projectionRunId,
    candidates_content_sha256: contentSha256(keywords),
    evaluation_policy_content_sha256: contentSha256(keywordPolicy),
    evaluation_policy_version: keywordPolicy.policy_version,
  };
  const built = buildOptimicomUiRelease({
    sourceDataset: source.dataset,
    sourceDatasetBytes: source.bytes,
    keywords,
    keywordBytes,
    publication: {
      run_id: projectionRunId,
      published_at: publishedAt,
      applied_at: publishedAt,
      source_dataset_artifact_sha256: source.artifactSha256,
    },
    currentMeta,
    accountPolicy,
    accountPolicyBytes,
    keywordPolicy,
    generatedAt: publishedAt,
  });
  const artifacts = {
    "release.json": Buffer.from(canonicalJson(JSON.parse(release.bundle_json)), "utf8"),
    [UI_RELEASE_ROOT]: Buffer.from(JSON.stringify(built.manifest, null, 2) + "\n", "utf8"),
  };
  for (const key of UI_ARTIFACT_KEYS) artifacts[built.manifest.artifacts[key].path] = built.dataArtifacts[key];
  return {
    artifacts,
    manifest: built.manifest,
    recordCounts: Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => [key, built.manifest.artifacts[key].record_count])),
  };
}

export function createDbBackedUiReleaseArtifactBuilder({ controlPlane, publicationRoot = DEFAULT_UI_PUBLICATION_ROOT } = {}) {
  return ({ releaseId, pins }) => buildDbBackedUiRelease({ controlPlane, releaseId, pins, publicationRoot }).artifacts;
}

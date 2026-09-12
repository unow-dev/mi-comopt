#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  APPLICATION_SCHEMA_VERSION,
  PACKAGE_ROOT,
  openCommentDatabaseReadOnly,
  readCommentDatabaseSchemaVersion,
  resolveDatabasePath,
} from "../src/database/comment-database.js";
import {
  clearCurrentKeywordCandidatePublication,
  insertKeywordCandidatePublication,
  readCurrentKeywordCandidatePublication,
} from "../src/database/keyword-candidate-publication-repository.js";
import { readSelectedSnapshots } from "../src/database/raw-snapshot-repository.js";
import { readSnapshotThreeClassLabels } from "../src/database/three-class-label-repository.js";
import {
  advanceFirstPublicationHistory,
  buildCurrentMeta,
  buildPublishedCandidates,
  conflictSet,
  contentSha256,
  createRequestId,
  createRunId,
  evaluateCandidates,
  makeArtifactRef,
  makeRunManifest,
  prettyJson,
  validateRegistry,
} from "../src/processing/keyword-candidates/candidate-workflow.js";
import { validateGeneratedArtifacts } from "../src/processing/keyword-candidates/artifact-validation.js";
import {
  buildDbKeywordCandidateDataset,
  serializeDbKeywordCandidateDataset,
} from "../src/processing/optimicom-ui-release/source-dataset.js";
import { publishBundleAtomically, resolveCurrentPublicationDir } from "./adapters/keyword-publication.js";

const KEYWORD_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "evaluation-policy-1.0.0.json");
const TAXONOMY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "taxonomy-1.0.0.json");
function codedError(code, message, options = {}) {
  const error = new Error(`${code}: ${message}`, options);
  error.code = code;
  return error;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw codedError("LOCAL_REBUILD_INPUT_INVALID", `${label}: ${error.message}`, { cause: error });
  }
}

function utcSecond(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw codedError("LOCAL_REBUILD_INPUT_INVALID", "published-at is not a valid timestamp");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function byteSha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readFilesystemCandidateState(publicationRoot, taxonomy) {
  const currentDir = resolveCurrentPublicationDir(publicationRoot);
  const read = (name) => readJson(path.join(currentDir, name), `current/${name}`);
  const registry = read("candidate_registry.json");
  const currentMeta = read("filterKeywordCandidates.meta.json");
  const manifest = read("run_manifest.json");

  if (manifest.run_id !== currentMeta.run_id || manifest.published_at !== currentMeta.published_at) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "filesystem current manifest and current metadata disagree");
  }
  if (currentMeta.run_manifest_content_sha256 !== contentSha256(manifest)) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "filesystem current manifest hash does not match current metadata");
  }
  if (manifest.registry_after_content_sha256 !== contentSha256(registry)) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "filesystem current registry hash does not match the manifest");
  }
  if (currentMeta.registry_content_sha256 !== contentSha256(registry)) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "filesystem current registry hash does not match current metadata");
  }
  try {
    validateRegistry(registry, taxonomy, { knownConflictKeys: [...conflictSet(registry)] });
  } catch (error) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", `filesystem current registry is invalid: ${error.message}`, { cause: error });
  }

  return { currentDir, registry, currentMeta, manifest };
}

function readDbSourceState(db) {
  const currentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM keyword_candidate_publications WHERE is_current = 1").get().count);
  if (currentCount !== 1) throw codedError("KEYWORD_PUBLICATION_INVALID", `DB current publication count is ${currentCount}, expected 1`);
  const publication = readCurrentKeywordCandidatePublication(db);
  if (!publication) throw codedError("KEYWORD_PUBLICATION_NOT_FOUND", "DB current keyword publication does not exist");

  const snapshotRows = db.prepare(
    `SELECT payload_sha256, snapshot_index
     FROM raw_snapshots WHERE snapshot_id = ?`,
  ).all(Number(publication.snapshot_id));
  if (snapshotRows.length !== 1) throw codedError("SNAPSHOT_NOT_FOUND", `publication snapshot_id ${publication.snapshot_id} is not present exactly once`);
  const snapshotRef = {
    payloadSha256: snapshotRows[0].payload_sha256,
    snapshotIndex: Number(snapshotRows[0].snapshot_index),
  };
  const selectedSnapshots = readSelectedSnapshots(db, [snapshotRef]);
  const snapshotId = selectedSnapshots[0].snapshot.snapshotId;
  if (snapshotId !== Number(publication.snapshot_id)) {
    throw codedError("SNAPSHOT_NOT_FOUND", "resolved snapshot does not match DB current publication");
  }
  const labels = readSnapshotThreeClassLabels(db, snapshotId);
  const dataset = buildDbKeywordCandidateDataset(selectedSnapshots, labels);
  const bytes = serializeDbKeywordCandidateDataset(dataset);
  const artifactSha256 = byteSha256(bytes);
  return {
    publication,
    snapshotId,
    snapshotRef,
    dataset,
    bytes,
    artifactSha256,
  };
}

function withReadTransaction(db, action) {
  db.exec("BEGIN");
  let committed = false;
  try {
    const result = action();
    db.exec("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    }
  }
}

function buildLocalRebuild({ filesystem, source, policy, taxonomy, publishedAt }) {
  const evaluationPolicy = {
    version: policy.policy_version,
    content_sha256: contentSha256(policy),
  };
  const taxonomyMetadata = {
    version: taxonomy.taxonomy_version,
    content_sha256: contentSha256(taxonomy),
  };
  const knownConflictKeys = [...conflictSet(filesystem.registry)];
  const evaluation = evaluateCandidates({
    registry: filesystem.registry,
    dataset: source.dataset,
    policy,
    policyContentSha256: evaluationPolicy.content_sha256,
    taxonomy,
    artifactSha256: source.artifactSha256,
    knownConflictKeys,
  });
  const registryAfter = advanceFirstPublicationHistory(filesystem.registry, evaluation, publishedAt);
  const publishedCandidates = buildPublishedCandidates({ registry: registryAfter, evaluation, taxonomy });
  const runId = createRunId();
  const manifest = makeRunManifest({
    runId,
    runType: "local_rebuild",
    baseRunId: filesystem.manifest.run_id,
    parentManifestContentSha256: contentSha256(filesystem.manifest),
    startedAt: publishedAt,
    completedAt: publishedAt,
    publishedAt,
    sourceDataset: {
      artifact_ref: `${source.snapshotRef.payloadSha256}:${source.snapshotRef.snapshotIndex}`,
      artifact_sha256: source.artifactSha256,
    },
    evaluationPolicy,
    taxonomy: taxonomyMetadata,
    registryBefore: filesystem.registry,
    registryAfter,
    artifacts: {
      candidate_registry: makeArtifactRef("candidate_registry.json", registryAfter),
      candidate_evaluation: makeArtifactRef("candidate_evaluation.json", evaluation),
      filter_keyword_candidates: makeArtifactRef("filterKeywordCandidates.json", publishedCandidates),
    },
    evaluator: { version: "1.0.0", source_revision: "local-rebuild-db-current" },
    publishedCandidates,
  });
  const currentMeta = buildCurrentMeta({
    runId,
    runManifest: manifest,
    publishedAt,
    publishedCandidates,
    registry: registryAfter,
    datasetArtifactSha256: source.artifactSha256,
    evaluationPolicy,
    taxonomy: taxonomyMetadata,
  });
  validateGeneratedArtifacts({
    registry: registryAfter,
    evaluation,
    publishedCandidates,
    currentMeta,
    manifest,
    taxonomy,
  });

  const requestId = createRequestId();
  const sourceDescriptor = {
    artifact_ref: manifest.source_dataset.artifact_ref,
    artifact_sha256: source.artifactSha256,
  };
  const inputFingerprint = contentSha256({
    run_type: "local_rebuild",
    base_run_id: filesystem.manifest.run_id,
    source_dataset: sourceDescriptor,
    registry_content_sha256: contentSha256(filesystem.registry),
    evaluation_policy: evaluationPolicy,
    taxonomy: taxonomyMetadata,
  });
  return {
    runId,
    requestId,
    inputFingerprint,
    snapshotId: source.snapshotId,
    source,
    registryBefore: filesystem.registry,
    registryAfter,
    evaluation,
    publishedCandidates,
    manifest,
    currentMeta,
    files: Object.fromEntries([
      ["candidate_registry.json", registryAfter],
      ["candidate_evaluation.json", evaluation],
      ["filterKeywordCandidates.json", publishedCandidates],
      ["filterKeywordCandidates.meta.json", currentMeta],
      ["run_manifest.json", manifest],
    ]),
  };
}

function persistDbPublication({ dbPath, rebuild, parentPublication }) {
  const db = new DatabaseSync(resolveDatabasePath(dbPath));
  try {
    if (readCommentDatabaseSchemaVersion(db) !== APPLICATION_SCHEMA_VERSION) {
      throw codedError("SCHEMA_VERSION_REQUIRED", `database schema v${APPLICATION_SCHEMA_VERSION} is required`);
    }
    db.exec("PRAGMA foreign_keys = ON");
    const foreignKeys = db.prepare("PRAGMA foreign_keys").get();
    if (Number(foreignKeys.foreign_keys) !== 1) throw codedError("SQLITE_FOREIGN_KEYS_DISABLED", "foreign-key enforcement could not be enabled");
    db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const current = readCurrentKeywordCandidatePublication(db);
      if (!current || current.run_id !== parentPublication.run_id || Number(current.snapshot_id) !== rebuild.snapshotId) {
        throw codedError("STALE_PARENT", "DB current publication changed during local rebuild");
      }
      const sourceDataset = {
        artifact_ref: rebuild.manifest.source_dataset.artifact_ref,
        artifact_sha256: rebuild.source.artifactSha256,
      };
      const localRequest = {
        schema_version: 1,
        run_type: "local_rebuild",
        request_id: rebuild.requestId,
        base_publication: {
          run_id: parentPublication.run_id,
          registry_content_sha256: contentSha256(rebuild.registryBefore),
        },
        source_dataset: sourceDataset,
        input_fingerprint: rebuild.inputFingerprint,
      };
      const localProposal = { schema_version: 1, run_type: "local_rebuild", request_id: rebuild.requestId, actions: [] };
      const localHandoff = { schema_version: 1, run_type: "local_rebuild", request_id: rebuild.requestId, source_dataset: sourceDataset };
      const appliedAt = new Date().toISOString();
      clearCurrentKeywordCandidatePublication(db);
      insertKeywordCandidatePublication(db, {
        run_id: rebuild.runId,
        snapshot_id: rebuild.snapshotId,
        request_id: rebuild.requestId,
        input_fingerprint: rebuild.inputFingerprint,
        source_dataset_artifact_sha256: rebuild.source.artifactSha256,
        base_run_id: parentPublication.run_id,
        published_at: rebuild.manifest.published_at,
        applied_at: appliedAt,
        is_current: 1,
        handoff_manifest_json: prettyJson(localHandoff),
        candidate_generation_request_json: prettyJson(localRequest),
        candidate_proposal_json: prettyJson(localProposal),
        run_manifest_json: prettyJson(rebuild.manifest),
        current_meta_json: prettyJson(rebuild.currentMeta),
        filter_keyword_candidates_json: prettyJson(rebuild.publishedCandidates),
      });
      db.exec("COMMIT");
      committed = true;
      return { appliedAt };
    } finally {
      if (!committed) {
        try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      }
    }
  } finally {
    db.close();
  }
}

function restoreCurrentLink(publicationRoot, previousTarget) {
  const root = path.resolve(publicationRoot);
  const currentLink = path.join(root, "current");
  const replacement = path.join(root, `.current-restore-${crypto.randomUUID()}`);
  fs.symlinkSync(previousTarget, replacement, "dir");
  fs.renameSync(replacement, currentLink);
}

export async function rebuildKeywordCandidatePublication({ dbPath, publicationRoot, publishedAt = undefined }) {
  if (!publicationRoot) throw codedError("VALIDATION_ERROR", "publicationRoot is required");
  const resolvedPublicationRoot = path.resolve(publicationRoot);
  const policy = readJson(KEYWORD_POLICY_PATH, "keyword evaluation policy");
  const taxonomy = readJson(TAXONOMY_PATH, "keyword taxonomy");
  const filesystem = readFilesystemCandidateState(resolvedPublicationRoot, taxonomy);
  const previousTarget = fs.readlinkSync(path.join(resolvedPublicationRoot, "current"));
  const db = await openCommentDatabaseReadOnly(dbPath);
  let source;
  try {
    source = withReadTransaction(db, () => readDbSourceState(db));
  } finally {
    db.close();
  }
  if (source.publication.run_id !== filesystem.manifest.run_id) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "DB and filesystem current publication run_id disagree");
  }
  const rebuild = buildLocalRebuild({ filesystem, source, policy, taxonomy, publishedAt: utcSecond(publishedAt) });
  let published = false;
  try {
    publishBundleAtomically({
      rootDir: resolvedPublicationRoot,
      runId: rebuild.runId,
      baseRunId: filesystem.manifest.run_id,
      baseRegistryContentSha256: contentSha256(filesystem.registry),
      files: rebuild.files,
    });
    published = true;
    const persistence = persistDbPublication({ dbPath, rebuild, parentPublication: source.publication });
    return {
      status: "rebuilt",
      runId: rebuild.runId,
      baseRunId: filesystem.manifest.run_id,
      snapshotId: rebuild.snapshotId,
      sourceDatasetSha256: rebuild.source.artifactSha256,
      publicationRoot: resolvedPublicationRoot,
      appliedAt: persistence.appliedAt,
      recordCounts: {
        source: rebuild.source.dataset.records.length,
        evaluated: rebuild.evaluation.candidates.length,
        published: rebuild.publishedCandidates.length,
      },
    };
  } catch (error) {
    if (published) {
      try {
        restoreCurrentLink(resolvedPublicationRoot, previousTarget);
      } catch (restoreError) {
        error.message += `; filesystem current restore failed: ${restoreError.message}`;
      }
    }
    throw error;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args["publication-root"]) throw new Error("Usage: node scripts/rebuild-keyword-candidate-publication.mjs --publication-root <dir> [--db <sqlite>] [--published-at <UTC timestamp>]");
    console.log(JSON.stringify(await rebuildKeywordCandidatePublication({
      dbPath: args.db,
      publicationRoot: args["publication-root"],
      publishedAt: args["published-at"],
    })));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

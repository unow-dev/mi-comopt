#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CommentDatabaseError,
  PACKAGE_ROOT,
  APPLICATION_SCHEMA_VERSION,
  openCommentDatabaseReadOnly,
  readCommentDatabaseSchemaVersion,
} from "../src/database/comment-database.js";
import { readCurrentKeywordCandidatePublication } from "../src/database/keyword-candidate-publication-repository.js";
import { readSelectedSnapshots } from "../src/database/raw-snapshot-repository.js";
import { readSnapshotThreeClassLabels } from "../src/database/three-class-label-repository.js";
import { contentSha256 } from "../src/processing/keyword-candidates/candidate-workflow.js";
import { buildDbKeywordCandidateDataset, serializeDbKeywordCandidateDataset } from "../src/processing/optimicom-ui-release/source-dataset.js";
import {
  UI_ARTIFACT_KEYS,
  UI_RELEASE_ROOT,
  buildOptimicomUiRelease,
  validateOptimicomUiArtifactBytes,
} from "../src/processing/optimicom-ui-release/release.js";

const KEYWORD_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "evaluation-policy-1.0.0.json");
const ACCOUNT_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "account-block-candidates", "accountBlockCandidatePolicy-1.0.0.json");

function codedError(code, message, options = {}) {
  const error = new Error(`${code}: ${message}`, options);
  error.code = code;
  return error;
}

function readJsonFile(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw codedError("UI_POLICY_READ_FAILED", `${label}: ${error.message}`, { cause: error });
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw codedError("UI_POLICY_INVALID", `${label}: ${error.message}`, { cause: error });
  }
}

function parsePublicationJson(value, field) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", `${field} is not valid JSON: ${error.message}`, { cause: error });
  }
}

function readPublicationSnapshotRef(db, snapshotId) {
  const rows = db.prepare(
    `SELECT payload_sha256, snapshot_index
     FROM raw_snapshots WHERE snapshot_id = ?`,
  ).all(snapshotId);
  if (rows.length !== 1) throw codedError("SNAPSHOT_NOT_FOUND", `publication snapshot_id ${snapshotId} is not present exactly once`);
  return {
    payloadSha256: rows[0].payload_sha256,
    snapshotIndex: Number(rows[0].snapshot_index),
  };
}

function readCurrentPublicationForUi(db) {
  const currentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM keyword_candidate_publications WHERE is_current = 1").get().count);
  if (currentCount === 0) throw codedError("KEYWORD_PUBLICATION_NOT_FOUND", "no current keyword publication exists");
  if (currentCount !== 1) throw codedError("KEYWORD_PUBLICATION_INVALID", "multiple current keyword publications exist");
  const publication = readCurrentKeywordCandidatePublication(db);
  if (!publication) throw codedError("KEYWORD_PUBLICATION_NOT_FOUND", "no current keyword publication exists");
  const currentMeta = parsePublicationJson(publication.current_meta_json, "current_meta_json");
  const keywords = parsePublicationJson(publication.filter_keyword_candidates_json, "filter_keyword_candidates_json");
  const runManifest = parsePublicationJson(publication.run_manifest_json, "run_manifest_json");
  const snapshotRef = readPublicationSnapshotRef(db, Number(publication.snapshot_id));
  if (
    currentMeta.run_id !== publication.run_id ||
    currentMeta.published_at !== publication.published_at ||
    currentMeta.dataset_artifact_sha256 !== publication.source_dataset_artifact_sha256 ||
    currentMeta.run_manifest_content_sha256 !== contentSha256(runManifest) ||
    runManifest.run_id !== publication.run_id ||
    runManifest.published_candidates_content_sha256 !== currentMeta.candidates_content_sha256 ||
    runManifest.source_dataset?.artifact_sha256 !== publication.source_dataset_artifact_sha256 ||
    runManifest.source_dataset?.artifact_ref !== `${snapshotRef.payloadSha256}:${snapshotRef.snapshotIndex}`
  ) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "current keyword publication metadata is inconsistent");
  }
  if (!Array.isArray(keywords) || currentMeta.candidates_content_sha256 !== contentSha256(keywords)) {
    throw codedError("KEYWORD_PUBLICATION_INVALID", "current keyword candidates do not match semantic hash");
  }
  return {
    publication,
    currentMeta,
    keywords,
    keywordBytes: Buffer.from(publication.filter_keyword_candidates_json, "utf8"),
    snapshotRef,
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
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
    }
  }
}

function atomicManifestReplace(outputRoot, manifestBytes) {
  const manifestPath = path.join(outputRoot, UI_RELEASE_ROOT);
  const temporaryPath = path.join(outputRoot, `.${UI_RELEASE_ROOT}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, manifestBytes, { flag: "wx" });
    fs.renameSync(temporaryPath, manifestPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* preserve original error */ }
    throw codedError("UI_RELEASE_PUBLISH_FAILED", `release root could not be replaced: ${error.message}`, { cause: error });
  }
}

export function publishOptimicomUiReleaseArtifacts(outputRoot, release, options = {}) {
  const staging = fs.mkdtempSync(path.join(outputRoot, ".optimicom-ui-release-"));
  try {
    for (const key of UI_ARTIFACT_KEYS) {
      const artifactPath = path.join(staging, release.manifest.artifacts[key].path);
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(artifactPath, release.dataArtifacts[key], { flag: "wx" });
    }
    const manifestBytes = Buffer.from(JSON.stringify(release.manifest, null, 2) + "\n", "utf8");
    validateOptimicomUiArtifactBytes(release.manifest, release.dataArtifacts);
    if (typeof options.beforeArtifactPublish === "function") options.beforeArtifactPublish({ release, outputRoot });

    for (const key of UI_ARTIFACT_KEYS) {
      const relativePath = release.manifest.artifacts[key].path;
      const target = path.resolve(outputRoot, relativePath);
      const staged = path.join(staging, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw codedError("UI_ARTIFACT_COLLISION", `existing artifact is not a regular file: ${relativePath}`);
        const existing = fs.readFileSync(target);
        if (!existing.equals(release.dataArtifacts[key])) throw codedError("UI_ARTIFACT_COLLISION", `existing artifact bytes differ: ${relativePath}`);
      } else {
        fs.renameSync(staged, target);
      }
    }
    if (typeof options.beforeManifestReplace === "function") options.beforeManifestReplace({ release, outputRoot });
    atomicManifestReplace(outputRoot, manifestBytes);
    return { manifestBytes };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function exportOptimicomUiRelease({ dbPath, outputRoot, generatedAt = undefined, hooks = undefined }) {
  if (typeof outputRoot !== "string" || outputRoot.length === 0) throw new CommentDatabaseError("VALIDATION_ERROR", "outputRoot is required");
  const resolvedOutputRoot = path.resolve(outputRoot);
  fs.mkdirSync(resolvedOutputRoot, { recursive: true });
  const keywordPolicy = readJsonFile(KEYWORD_POLICY_PATH, "keyword evaluation policy");
  const accountPolicy = readJsonFile(ACCOUNT_POLICY_PATH, "account candidate policy");
  const db = await openCommentDatabaseReadOnly(dbPath);
  let release;
  try {
    if (readCommentDatabaseSchemaVersion(db) !== APPLICATION_SCHEMA_VERSION) throw codedError("SCHEMA_VERSION_REQUIRED", "database schema v8 is required");
    release = withReadTransaction(db, () => {
      const current = readCurrentPublicationForUi(db);
      const selectedSnapshots = readSelectedSnapshots(db, [current.snapshotRef]);
      const labels = readSnapshotThreeClassLabels(db, selectedSnapshots[0].snapshot.snapshotId);
      const sourceDataset = buildDbKeywordCandidateDataset(selectedSnapshots, labels);
      const sourceDatasetBytes = serializeDbKeywordCandidateDataset(sourceDataset);
      return buildOptimicomUiRelease({
        sourceDataset,
        sourceDatasetBytes,
        keywords: current.keywords,
        keywordBytes: current.keywordBytes,
        publication: current.publication,
        currentMeta: current.currentMeta,
        accountPolicy: accountPolicy.value,
        accountPolicyBytes: accountPolicy.bytes,
        keywordPolicy: keywordPolicy.value,
        generatedAt,
      });
    });
  } finally {
    db.close();
  }
  const publicationResult = publishOptimicomUiReleaseArtifacts(resolvedOutputRoot, release, hooks);
  return {
    status: "published",
    releasePath: path.join(resolvedOutputRoot, UI_RELEASE_ROOT),
    artifactPaths: Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => [key, path.join(resolvedOutputRoot, release.manifest.artifacts[key].path)])),
    recordCounts: Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => [key, release.manifest.artifacts[key].record_count])),
    manifestBytes: publicationResult.manifestBytes,
    manifest: release.manifest,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const valueFor = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  try {
    const outputRoot = valueFor("--output-root");
    const dbPath = valueFor("--db");
    if (!outputRoot || (argv.includes("--db") && !dbPath)) throw new Error("Usage: node scripts/export-optimicom-ui-release.mjs --output-root <dir> [--db <path>]");
    const result = await exportOptimicomUiRelease({ dbPath, outputRoot });
    console.log(JSON.stringify({ status: result.status, releasePath: result.releasePath, recordCounts: result.recordCounts }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

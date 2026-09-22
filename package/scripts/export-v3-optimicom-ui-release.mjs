#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openCommentDatabaseReadOnly } from "../src/database/comment-database.js";
import { readSelectedSnapshotsInReferenceOrder } from "../src/database/raw-snapshot-repository.js";
import { projectCumulativeCorpus } from "../src/processing/analysis-input/raw-snapshot-projection.js";
import {
  canonicalizeCandidate,
  conflictSet,
  contentSha256,
} from "../src/processing/keyword-candidates/candidate-workflow.js";
import { prepareFullUpdate } from "../src/processing/keyword-candidates/update-flow.js";
import {
  buildOptimicomUiRelease,
  UI_ARTIFACT_KEYS,
  UI_RELEASE_ROOT,
  validateOptimicomUiReleaseAtRoot,
} from "../src/processing/optimicom-ui-release/release.js";
import {
  buildCumulativeSourceDataset,
  serializeCumulativeSourceDataset,
} from "../src/processing/optimicom-ui-release/source-dataset.js";
import {
  prefixedSha256,
  serializeJson,
} from "../src/processing/account-block-candidates/account-block-candidate-workflow.js";

const REPOSITORY_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DEFAULT_DB = path.join(REPOSITORY_ROOT, "var", "comment-history.sqlite3");
const DEFAULT_PUBLICATION_ROOT = path.join(REPOSITORY_ROOT, "work", "20260826", "candidate-publication-final");
const KEYWORD_POLICY_PATH = path.join(REPOSITORY_ROOT, "package", "contracts", "keyword-candidates", "evaluation-policy-1.0.0.json");
const KEYWORD_TAXONOMY_PATH = path.join(REPOSITORY_ROOT, "package", "contracts", "keyword-candidates", "taxonomy-1.0.0.json");
const ACCOUNT_POLICY_PATH = path.join(REPOSITORY_ROOT, "package", "contracts", "account-block-candidates", "accountBlockCandidatePolicy-1.0.0.json");

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function readZipJson(zipPath, entry) {
  try {
    const bytes = execFileSync("unzip", ["-p", zipPath, entry], { maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`handoff ${entry} could not be read: ${error.message}`);
  }
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

function utcSecond(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid timestamp: ${value}`);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function readStateVersion(db, versionId) {
  const row = db.prepare(
    `SELECT v.version_id, s.domain, s.stream_key, v.payload_json
       FROM state_versions AS v
       JOIN state_streams AS s ON s.stream_id = v.stream_id
      WHERE v.version_id = ?`,
  ).get(versionId);
  if (!row) throw new Error(`state version not found: ${versionId}`);
  return { ...row, payload: JSON.parse(row.payload_json) };
}

function readRelease(db, releaseId) {
  const row = db.prepare("SELECT * FROM v3_release_bundles WHERE release_id = ?").get(releaseId);
  if (!row) throw new Error(`v3 release not found: ${releaseId}`);
  return row;
}

function readSourceDataset(db, corpusVersionId, classificationVersionId) {
  const corpus = readStateVersion(db, corpusVersionId);
  const refs = corpus.payload?.state?.snapshot_refs ?? [];
  if (!Array.isArray(refs) || refs.length === 0) throw new Error("corpus version must contain snapshot references");
  const normalizedRefs = refs.map((reference) => {
    const raw = typeof reference === "string"
      ? reference
      : `${reference?.payloadSha256 ?? ""}:${reference?.snapshotIndex ?? ""}`;
    const match = /^([0-9a-f]{64}):(\d+)$/.exec(raw);
    if (!match) throw new Error(`invalid corpus snapshot reference: ${raw}`);
    return { payloadSha256: match[1], snapshotIndex: Number(match[2]) };
  });
  const selected = readSelectedSnapshotsInReferenceOrder(db, normalizedRefs);
  const projection = projectCumulativeCorpus(selected);
  const labels = projection.survivors.length === 0 ? [] : db.prepare(
    `SELECT observation_id, label
       FROM classification_state_labels
      WHERE version_id = ? AND observation_id IN (${projection.survivors.map(() => "?").join(", ")})`,
  ).all(classificationVersionId, ...projection.survivors.map((row) => row.observationId)).map((row) => ({ observationId: String(row.observation_id), label: row.label }));
  const dataset = buildCumulativeSourceDataset({ corpusVersionId, classificationVersionId, snapshotRefs: normalizedRefs, survivors: projection.survivors, labelRows: labels });
  const bytes = serializeCumulativeSourceDataset(dataset);
  return { dataset, bytes, snapshotRefs: normalizedRefs };
}

function normalizeAcceptedProposal(proposal, taxonomy) {
  return {
    ...proposal,
    actions: proposal.actions.map((action) => ["add", "update", "reactivate"].includes(action.action)
      ? { ...action, ...canonicalizeCandidate(action, taxonomy) }
      : action),
  };
}

function writeFile(outputRoot, relativePath, bytes) {
  const target = path.resolve(outputRoot, relativePath);
  const root = `${path.resolve(outputRoot)}${path.sep}`;
  if (!target.startsWith(root)) throw new Error(`output path escapes root: ${relativePath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

export async function exportV3OptimicomUiRelease({
  dbPath = DEFAULT_DB,
  releaseId,
  handoffZip,
  proposalPath,
  publicationRoot = DEFAULT_PUBLICATION_ROOT,
  outputRoot,
  publishedAt = undefined,
} = {}) {
  required(releaseId, "--release-id");
  required(handoffZip, "--handoff-zip");
  required(proposalPath, "--proposal");
  required(outputRoot, "--output-root");

  const request = readZipJson(handoffZip, "candidate_generation_request.json");
  const candidateView = readZipJson(handoffZip, "candidate_view.json");
  const preEvaluation = readZipJson(handoffZip, "pre_evaluation.json");
  const handoffPolicy = readZipJson(handoffZip, "evaluation_policy.json");
  const handoffTaxonomy = readZipJson(handoffZip, "taxonomy.json");
  const proposal = normalizeAcceptedProposal(readJson(proposalPath, "candidate proposal"), handoffTaxonomy);
  const keywordPolicy = readJson(KEYWORD_POLICY_PATH, "keyword policy");
  const taxonomy = readJson(KEYWORD_TAXONOMY_PATH, "keyword taxonomy");
  const accountPolicyBytes = fs.readFileSync(ACCOUNT_POLICY_PATH);
  const accountPolicy = JSON.parse(accountPolicyBytes.toString("utf8"));
  if (contentSha256(keywordPolicy) !== request.evaluation_policy.content_sha256 || contentSha256(taxonomy) !== request.taxonomy.content_sha256) {
    throw new Error("handoff policy or taxonomy does not match the repository contract");
  }

  const db = await openCommentDatabaseReadOnly(dbPath);
  try {
    const release = readRelease(db, releaseId);
    const pins = JSON.parse(release.pins_json);
    const source = readSourceDataset(db, pins.corpusVersionId, pins.classificationVersionId);
    if (prefixedSha256(source.bytes) !== request.source_dataset.artifact_sha256) throw new Error("v3 source dataset does not match the accepted keyword handoff");

    const basePublicationDir = path.join(path.resolve(publicationRoot), "publications", request.base_publication.run_id);
    const baseRegistry = readJson(path.join(basePublicationDir, "candidate_registry.json"), "base candidate registry");
    if (contentSha256(baseRegistry) !== request.base_publication.registry_content_sha256) throw new Error("base candidate registry does not match the accepted keyword handoff");

    const timestamp = utcSecond(publishedAt ?? release.created_at);
    const projectionRunId = `run_${deterministicUuid(`comment-db-v3-ui-projection:${releaseId}`)}`;
    const keywordUpdate = prepareFullUpdate({
      request,
      proposal,
      registry: baseRegistry,
      dataset: source.dataset,
      policy: keywordPolicy,
      taxonomy,
      candidateView,
      preEvaluation,
      publishedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      runId: projectionRunId,
      evaluator: { version: "1.0.0", source_revision: "comment-db-v3-release-projection" },
      candidateIdFactory: (action, index) => `kw_${deterministicUuid(`${request.input_fingerprint}:${index}:${action.keyword}`)}`,
      knownConflictKeys: [...conflictSet(baseRegistry)],
    });
    const sourceBytes = source.bytes;
    const keywordBytes = Buffer.from(serializeJson(keywordUpdate.publishedCandidates), "utf8");
    const sourceSha = prefixedSha256(sourceBytes);
    const currentMeta = {
      schema_version: 1,
      run_id: projectionRunId,
      candidates_content_sha256: contentSha256(keywordUpdate.publishedCandidates),
      evaluation_policy_content_sha256: contentSha256(keywordPolicy),
      evaluation_policy_version: keywordPolicy.policy_version,
    };
    const publication = {
      run_id: projectionRunId,
      published_at: timestamp,
      applied_at: timestamp,
      source_dataset_artifact_sha256: sourceSha,
    };
    const built = buildOptimicomUiRelease({
      sourceDataset: source.dataset,
      sourceDatasetBytes: sourceBytes,
      keywords: keywordUpdate.publishedCandidates,
      keywordBytes,
      publication,
      currentMeta,
      accountPolicy,
      accountPolicyBytes,
      keywordPolicy,
      generatedAt: timestamp,
    });
    for (const key of UI_ARTIFACT_KEYS) writeFile(outputRoot, built.manifest.artifacts[key].path, built.dataArtifacts[key]);
    writeFile(outputRoot, UI_RELEASE_ROOT, Buffer.from(serializeJson(built.manifest), "utf8"));
    validateOptimicomUiReleaseAtRoot(path.join(outputRoot, UI_RELEASE_ROOT));
    return {
      status: "exported",
      releaseId,
      releaseBundleSha256: release.bundle_sha256,
      projectionRunId,
      outputRoot: path.resolve(outputRoot),
      sourceSnapshotRefs: source.snapshotRefs,
      recordCounts: {
        comments: built.manifest.artifacts.comments.record_count,
        overview: built.manifest.artifacts.overview.record_count,
        keywords: built.manifest.artifacts.keywords.record_count,
        accounts: built.manifest.artifacts.accounts.record_count,
      },
      artifactPaths: Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => [key, built.manifest.artifacts[key].path])),
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const argv = process.argv.slice(2);
    console.log(JSON.stringify(await exportV3OptimicomUiRelease({
      dbPath: valueFor(argv, "--db") ?? DEFAULT_DB,
      releaseId: valueFor(argv, "--release-id"),
      handoffZip: valueFor(argv, "--handoff-zip"),
      proposalPath: valueFor(argv, "--proposal"),
      publicationRoot: valueFor(argv, "--publication-root") ?? DEFAULT_PUBLICATION_ROOT,
      outputRoot: valueFor(argv, "--output-root"),
      publishedAt: valueFor(argv, "--published-at"),
    })));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

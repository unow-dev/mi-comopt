#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAccountCandidates,
  prefixedSha256,
  serializeJson,
  validateArtifactBindings,
  validateDataset,
  validateKeywordMeta,
  validatePolicy,
  validateSummary,
} from "../src/lib/account-block-candidate-workflow.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const GENERATOR_VERSION = "1.0.0";
const DEFAULT_DATASET_REF = "upstream://integrated-labeling/three-class";
const DEFAULT_SUMMARY_REF = "upstream://integrated-labeling/three-class/summary";
const ARTIFACT_NAMES = [
  "accountBlockCandidates.json",
  "accountBlockCandidates.meta.json",
  "accountBlockCandidateRunManifest.json",
];

function usage() {
  console.error(`Usage:
  account-block-candidate-workflow --dataset FILE --summary FILE --policy FILE --keyword-meta FILE --publish-dir DIR

Optional:
  --dataset-ref REF --summary-ref REF --run-id ID --published-at TIMESTAMP
`);
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

function assertRequiredArgs(args) {
  for (const name of ["dataset", "summary", "policy", "keyword-meta", "publish-dir"]) {
    if (!args[name]) throw new Error(`missing required option --${name}`);
  }
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function readJsonWithBytes(file, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(path.resolve(file));
  } catch (caught) {
    throw codedError("INPUT_READ_FAILED", `${label}: ${caught.message}`);
  }
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch (caught) {
    throw codedError("INVALID_JSON", `${label}: ${caught.message}`);
  }
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function createRunId() {
  return `run_${crypto.randomUUID()}`;
}

function buildManifest({
  runId,
  startedAt,
  completedAt,
  publishedAt,
  datasetRef,
  summaryRef,
  summary,
  summaryBytes,
  policy,
  policyBytes,
  generatorBytes,
  candidatesBytes,
  statistics,
}) {
  return {
    schema_version: 1,
    run_id: runId,
    run_type: "full_snapshot",
    started_at: startedAt,
    completed_at: completedAt,
    published_at: publishedAt,
    outcome: "published",
    source_dataset: {
      artifact_ref: datasetRef,
      artifact_sha256: `sha256:${summary.final_output_sha256}`,
    },
    source_summary: {
      artifact_ref: summaryRef,
      content_sha256: prefixedSha256(summaryBytes),
      final_published: summary.final_published,
      three_class_policy_version: summary.three_class_policy_version,
      unresolved_optional_p2_reviews: summary.unresolved_optional_p2_reviews,
    },
    candidate_policy: {
      version: policy.policy_version,
      content_sha256: prefixedSha256(policyBytes),
    },
    generator: {
      version: GENERATOR_VERSION,
      content_sha256: prefixedSha256(generatorBytes),
    },
    statistics,
    artifacts: {
      candidate_view: {
        artifact_ref: "accountBlockCandidates.json",
        content_sha256: prefixedSha256(candidatesBytes),
      },
    },
  };
}

function buildMeta({ runId, publishedAt, candidatesBytes, manifestBytes, summary, policy, policyBytes }) {
  return {
    schema_version: 1,
    run_id: runId,
    run_manifest_content_sha256: prefixedSha256(manifestBytes),
    published_at: publishedAt,
    candidates_content_sha256: prefixedSha256(candidatesBytes),
    dataset_artifact_sha256: `sha256:${summary.final_output_sha256}`,
    three_class_policy_version: summary.three_class_policy_version,
    unresolved_optional_p2_reviews: summary.unresolved_optional_p2_reviews,
    candidate_policy_version: policy.policy_version,
    candidate_policy_content_sha256: prefixedSha256(policyBytes),
  };
}

function writeStage(stageDir, files) {
  for (const [name, bytes] of Object.entries(files)) {
    fs.writeFileSync(path.join(stageDir, name), bytes);
  }
}

function publishAtomically(publishDir, files) {
  const absoluteDir = path.resolve(publishDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(absoluteDir, ".account-candidate-stage-"));
  const backupDir = fs.mkdtempSync(path.join(absoluteDir, ".account-candidate-backup-"));
  const backedUp = [];
  const published = [];
  try {
    writeStage(stageDir, files);
    for (const name of ARTIFACT_NAMES) {
      const destination = path.join(absoluteDir, name);
      if (fs.existsSync(destination)) {
        fs.renameSync(destination, path.join(backupDir, name));
        backedUp.push(name);
      }
    }
    for (const name of ARTIFACT_NAMES) {
      fs.renameSync(path.join(stageDir, name), path.join(absoluteDir, name));
      published.push(name);
    }
  } catch (caught) {
    for (const name of published) {
      const destination = path.join(absoluteDir, name);
      if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    }
    for (const name of backedUp.reverse()) {
      const backup = path.join(backupDir, name);
      if (fs.existsSync(backup)) fs.renameSync(backup, path.join(absoluteDir, name));
    }
    throw codedError("PUBLICATION_FAILED", caught.message);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
  return absoluteDir;
}

function run(args) {
  assertRequiredArgs(args);
  const datasetInput = readJsonWithBytes(args.dataset, "dataset");
  const summaryInput = readJsonWithBytes(args.summary, "summary");
  const policyInput = readJsonWithBytes(args.policy, "policy");
  const keywordMetaInput = readJsonWithBytes(args["keyword-meta"], "keyword meta");

  validateSummary(summaryInput.value, datasetInput.bytes);
  validateDataset(datasetInput.value);
  validatePolicy(policyInput.value);
  validateKeywordMeta(keywordMetaInput.value);

  const datasetSha = `sha256:${summaryInput.value.final_output_sha256}`;
  if (keywordMetaInput.value.dataset_artifact_sha256 !== datasetSha) {
    throw codedError("DATASET_SNAPSHOT_MISMATCH", "keyword/accountのdataset SHAが一致しません");
  }

  const result = buildAccountCandidates(datasetInput.value, policyInput.value);
  const candidatesBytes = Buffer.from(serializeJson(result.candidates), "utf8");
  const startedAt = args["published-at"] ?? utcNow();
  const completedAt = args["published-at"] ?? utcNow();
  const publishedAt = args["published-at"] ?? completedAt;
  const runId = args["run-id"] ?? createRunId();
  const generatorBytes = fs.readFileSync(SCRIPT_PATH);
  const manifest = buildManifest({
    runId,
    startedAt,
    completedAt,
    publishedAt,
    datasetRef: args["dataset-ref"] ?? DEFAULT_DATASET_REF,
    summaryRef: args["summary-ref"] ?? DEFAULT_SUMMARY_REF,
    summary: summaryInput.value,
    summaryBytes: summaryInput.bytes,
    policy: policyInput.value,
    policyBytes: policyInput.bytes,
    generatorBytes,
    candidatesBytes,
    statistics: result.statistics,
  });
  const manifestBytes = Buffer.from(serializeJson(manifest), "utf8");
  const meta = buildMeta({
    runId,
    publishedAt,
    candidatesBytes,
    manifestBytes,
    summary: summaryInput.value,
    policy: policyInput.value,
    policyBytes: policyInput.bytes,
  });
  const metaBytes = Buffer.from(serializeJson(meta), "utf8");
  validateArtifactBindings({
    candidates: result.candidates,
    candidatesBytes,
    meta,
    metaBytes,
    manifest,
    manifestBytes,
    policy: policyInput.value,
    policyBytes: policyInput.bytes,
    generatorBytes,
    keywordMeta: keywordMetaInput.value,
  });

  publishAtomically(path.resolve(args["publish-dir"]), {
    "accountBlockCandidates.json": candidatesBytes,
    "accountBlockCandidates.meta.json": metaBytes,
    "accountBlockCandidateRunManifest.json": manifestBytes,
  });
  console.log(JSON.stringify({
    run_id: runId,
    published: result.candidates.length,
    dataset_artifact_sha256: datasetSha,
    collapsed_source_rows: result.statistics.collapsed_source_rows,
  }));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (Object.keys(args).length === 0) {
    usage();
    process.exitCode = 2;
  } else {
    run(args);
  }
} catch (caught) {
  console.error(caught.errors ? JSON.stringify({ errors: caught.errors }, null, 2) : caught.stack ?? caught.message ?? caught);
  process.exitCode = 1;
}

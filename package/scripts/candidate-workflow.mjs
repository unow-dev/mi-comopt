#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCandidateView,
  buildCurrentMeta,
  buildPreEvaluation,
  buildPublishedCandidates,
  contentSha256,
  conflictSet,
  createRequestId,
  createRunId,
  evaluateCandidates,
  makeArtifactRef,
  makeBootstrapRegistry,
  makeGenerationRequest,
  makeRunManifest,
  prettyJson,
  validateRegistry,
  canonicalizeProposal,
} from "../src/processing/keyword-candidates/candidate-workflow.js";
import { prepareFullUpdate, validateParentManifest } from "../src/processing/keyword-candidates/update-flow.js";
import { validateGeneratedArtifacts } from "../src/processing/keyword-candidates/artifact-validation.js";
import { HANDOFF_FILES, prepareHandoffBundle, verifyHandoffBundle } from "../src/processing/keyword-candidates/handoff-workflow.js";
import { publishBundleAtomically, resolveCurrentPublicationDir } from "./adapters/keyword-publication.js";

const LEGACY_BOOTSTRAP_SOURCE_SHA256 = "sha256:ce1baa51f927782496f617907880dd0c1442ddf5a2b8700746baa9b0f3879095";
const RUNTIME_CONTRACT_FILES = [
  "prompt.txt",
  "PROMPT_CONTRACT_v1.md",
  "candidate-proposal.schema.json",
  "common.schema.json",
];
const CONTRACT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../contracts/candidate-handoff/v1");

function usage() {
  console.error(`Usage:
  candidate-workflow bootstrap --legacy FILE --id-map FILE --taxonomy FILE --policy FILE --outdir DIR [--dataset FILE --artifact-sha SHA] [--expected-evaluation FILE --expected-published FILE] [--export-dir DIR]
  candidate-workflow evaluate --registry FILE --dataset FILE --policy FILE --taxonomy FILE --artifact-sha SHA --out FILE
  candidate-workflow generate-request --registry FILE --evaluation FILE --policy FILE --taxonomy FILE --base-run-id ID --base-registry-sha SHA --source-sha SHA --out FILE [--source-ref REF]
  candidate-workflow canonicalize-proposal --request FILE --proposal FILE --registry FILE --taxonomy FILE --out FILE
  candidate-workflow validate-current --dir DIR --taxonomy FILE
  candidate-workflow prepare-handoff --publication-root DIR --dataset FILE --policy FILE --taxonomy FILE --outdir DIR [--labeling-summary FILE --labeling-validation FILE] [--request-id ID] [--source-ref REF] [--source-sha SHA]
  candidate-workflow full-update --registry FILE --request FILE --proposal FILE --dataset FILE --policy FILE --taxonomy FILE --parent-manifest FILE --outdir DIR [--candidate-view FILE] [--pre-evaluation FILE] [--handoff-manifest FILE] [--run-id ID] [--published-at TIMESTAMP] [--export-dir DIR]
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument: ${item}`);
    const key = item.slice(2);
    if (key === "force") args[key] = true;
    else {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function readJsonWithBytes(file) {
  const bytes = fs.readFileSync(path.resolve(file));
  return { value: JSON.parse(bytes.toString("utf8")), bytes };
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function assertRequiredArgs(args, names) {
  for (const name of names) {
    if (!args[name]) throw new Error(`missing required option --${name}`);
  }
}

function readLabelingEvidence(file, name) {
  try {
    return readJson(file);
  } catch (caught) {
    throw codedError("LABELING_EVIDENCE_INVALID", `${name} cannot be read: ${caught.message}`);
  }
}

function readPublicationJson(publicationDir, name) {
  return readJson(path.join(publicationDir, name));
}

function readRuntimeContractBytes() {
  return Object.fromEntries(RUNTIME_CONTRACT_FILES.map((name) => [name, fs.readFileSync(path.join(CONTRACT_ROOT, name))]));
}

function writeExclusiveHandoff(outdir, files) {
  const absolute = path.resolve(outdir);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  let ownsOutputDir = false;
  try {
    fs.mkdirSync(absolute);
    ownsOutputDir = true;
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(absolute, name), bytes);
  } catch (caught) {
    if (caught.code === "EEXIST" && !ownsOutputDir) throw codedError("HANDOFF_OUTPUT_EXISTS", "--outdir already exists");
    if (ownsOutputDir && fs.existsSync(absolute)) fs.rmSync(absolute, { recursive: true, force: true });
    throw caught;
  }
  return absolute;
}

function readHandoffBundle(manifestFile) {
  let manifest;
  try {
    manifest = readJson(manifestFile);
  } catch (caught) {
    throw codedError("HANDOFF_MANIFEST_MISMATCH", `cannot read handoff manifest: ${caught.message}`);
  }
  const handoffDir = path.dirname(path.resolve(manifestFile));
  const handoffFiles = {};
  for (const name of HANDOFF_FILES) {
    try {
      handoffFiles[name] = fs.readFileSync(path.join(handoffDir, name));
    } catch {
      throw codedError("HANDOFF_MANIFEST_MISMATCH", `handoff file is missing: ${name}`);
    }
  }
  return { manifest, handoffFiles };
}

function readHandoffInputBytes(file, name) {
  try {
    return fs.readFileSync(path.resolve(file));
  } catch {
    throw codedError("HANDOFF_MANIFEST_MISMATCH", `CLI input cannot be read for ${name}`);
  }
}

function ensureDir(directory) {
  fs.mkdirSync(path.resolve(directory), { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, prettyJson(value), "utf8");
}

function exportFiles(exportDir, files) {
  if (!exportDir) return;
  const absolute = path.resolve(exportDir);
  ensureDir(absolute);
  for (const [name, value] of Object.entries(files)) writeJson(path.join(absolute, name), value);
}

function metadata(value, versionKey) {
  return { version: value[versionKey], content_sha256: contentSha256(value) };
}

function bootstrap(args) {
  const legacy = readJson(args.legacy);
  const idMap = readJson(args["id-map"]);
  const taxonomy = readJson(args.taxonomy);
  const policy = readJson(args.policy);
  const publishedAt = args["published-at"] ?? "2026-08-24T15:54:00Z";
  const registry = makeBootstrapRegistry({
    legacyCandidates: legacy,
    idMap,
    taxonomy,
    publishedAt,
    expectedLegacySourceSha256: LEGACY_BOOTSTRAP_SOURCE_SHA256,
  });
  const knownConflictKeys = [...conflictSet(registry)];
  let evaluation;
  let publishedCandidates;
  if (args["expected-evaluation"]) {
    evaluation = readJson(args["expected-evaluation"]);
    publishedCandidates = args["expected-published"] ? readJson(args["expected-published"]) : buildPublishedCandidates({ registry, evaluation, taxonomy });
  } else {
    if (!args.dataset || !args["artifact-sha"]) throw new Error("bootstrapには --dataset と --artifact-sha、またはexpected fixtureが必要です");
    evaluation = evaluateCandidates({
      registry,
      dataset: readJson(args.dataset),
      policy,
      taxonomy,
      artifactSha256: args["artifact-sha"],
      knownConflictKeys,
    });
    publishedCandidates = buildPublishedCandidates({ registry, evaluation, taxonomy });
  }
  const runId = args["run-id"] ?? "run_00000000-0000-4000-8000-000000000001";
  const sourceDataset = {
    artifact_ref: args["dataset-ref"] ?? "upstream://integrated-labeling/three-class",
    artifact_sha256: evaluation.dataset.artifact_sha256,
  };
  const evaluationPolicy = { version: policy.policy_version, content_sha256: contentSha256(policy) };
  const taxonomyMeta = { version: taxonomy.taxonomy_version, content_sha256: contentSha256(taxonomy) };
  const artifacts = {
    bootstrap_candidate_id_map: makeArtifactRef("bootstrap_candidate_id_map.json", idMap),
    candidate_evaluation: makeArtifactRef("candidate_evaluation.json", evaluation),
  };
  const manifest = makeRunManifest({
    runId,
    runType: "bootstrap_migration",
    startedAt: publishedAt,
    completedAt: publishedAt,
    publishedAt,
    sourceDataset,
    evaluationPolicy,
    taxonomy: taxonomyMeta,
    registryAfter: registry,
    artifacts,
    publishedCandidates,
  });
  const currentMeta = buildCurrentMeta({
    runId,
    runManifest: manifest,
    publishedAt,
    publishedCandidates,
    registry,
    datasetArtifactSha256: sourceDataset.artifact_sha256,
    evaluationPolicy,
    taxonomy: taxonomyMeta,
  });
  const files = {
    "candidate_registry.json": registry,
    "candidate_evaluation.json": evaluation,
    "filterKeywordCandidates.json": publishedCandidates,
    "filterKeywordCandidates.meta.json": currentMeta,
    "run_manifest.json": manifest,
    "bootstrap_candidate_id_map.json": idMap,
  };
  validateGeneratedArtifacts({ registry, evaluation, publishedCandidates, currentMeta, manifest, taxonomy });
  const outdir = path.resolve(args.outdir);
  const result = publishBundleAtomically({ rootDir: outdir, runId, baseRunId: null, baseRegistryContentSha256: undefined, files });
  exportFiles(args["export-dir"], files);
  console.log(JSON.stringify({ ...result, run_id: runId, published: publishedCandidates.length }));
}

function evaluate(args) {
  const registry = readJson(args.registry);
  const dataset = readJson(args.dataset);
  const policy = readJson(args.policy);
  const taxonomy = readJson(args.taxonomy);
  const result = evaluateCandidates({ registry, dataset, policy, taxonomy, artifactSha256: args["artifact-sha"], knownConflictKeys: [...conflictSet(registry)] });
  writeJson(path.resolve(args.out), result);
  console.log(JSON.stringify({ candidates: result.candidates.length, dataset: result.dataset }));
}

function generateRequest(args) {
  const registry = readJson(args.registry);
  const evaluation = readJson(args.evaluation);
  const policy = readJson(args.policy);
  const taxonomy = readJson(args.taxonomy);
  const view = buildCandidateView(registry);
  const preEvaluation = buildPreEvaluation(evaluation);
  const request = makeGenerationRequest({
    requestId: args["request-id"] ?? createRequestId(),
    baseRunId: args["base-run-id"],
    baseRegistryContentSha256: args["base-registry-sha"],
    sourceDatasetArtifactSha256: args["source-sha"],
    sourceDatasetArtifactRef: args["source-ref"] ?? "upstream://integrated-labeling/three-class",
    candidateView: view,
    preEvaluation,
    evaluationPolicy: { version: policy.policy_version, content_sha256: contentSha256(policy) },
    taxonomy: { version: taxonomy.taxonomy_version, content_sha256: contentSha256(taxonomy) },
  });
  writeJson(path.resolve(args.out), request);
  console.log(JSON.stringify({ request_id: request.request_id, input_fingerprint: request.input_fingerprint }));
}

function prepareHandoff(args) {
  assertRequiredArgs(args, ["publication-root", "dataset", "policy", "taxonomy", "outdir"]);

  const publicationDir = resolveCurrentPublicationDir(args["publication-root"]);
  const registry = readPublicationJson(publicationDir, "candidate_registry.json");
  const evaluation = readPublicationJson(publicationDir, "candidate_evaluation.json");
  const publishedCandidates = readPublicationJson(publicationDir, "filterKeywordCandidates.json");
  const currentMeta = readPublicationJson(publicationDir, "filterKeywordCandidates.meta.json");
  const manifest = readPublicationJson(publicationDir, "run_manifest.json");
  const datasetInput = readJsonWithBytes(args.dataset);
  const policyInput = readJsonWithBytes(args.policy);
  const taxonomyInput = readJsonWithBytes(args.taxonomy);
  const labelingSummaryFile = args["labeling-summary"];
  const labelingValidationFile = args["labeling-validation"];
  if ((labelingSummaryFile === undefined) !== (labelingValidationFile === undefined)) {
    throw codedError("LABELING_EVIDENCE_INVALID", "--labeling-summary and --labeling-validation must be provided together");
  }
  const runtimeBytes = readRuntimeContractBytes();
  const prepared = prepareHandoffBundle({
    registry,
    evaluation,
    publishedCandidates,
    currentMeta,
    baseManifest: manifest,
    datasetInput,
    policyInput,
    taxonomyInput,
    labelingEvidence: labelingSummaryFile
      ? {
          summary: readLabelingEvidence(labelingSummaryFile, "labeling summary"),
          validation: readLabelingEvidence(labelingValidationFile, "labeling validation"),
        }
      : undefined,
    explicitSourceSha: args["source-sha"],
    explicitSourceRef: args["source-ref"],
    requestId: args["request-id"] ?? createRequestId(),
    runtimeBytes,
  });
  const outdir = writeExclusiveHandoff(args.outdir, prepared.files);
  console.log(JSON.stringify({
    request_id: prepared.request.request_id,
    input_fingerprint: prepared.request.input_fingerprint,
    source_dataset: {
      artifact_ref: prepared.sourceRef,
      artifact_sha256: prepared.sourceSha,
    },
    outdir,
  }));
}

function canonicalizeProposalCommand(args) {
  const request = readJson(args.request);
  const proposal = readJson(args.proposal);
  const registry = readJson(args.registry);
  const taxonomy = readJson(args.taxonomy);
  const changeSet = canonicalizeProposal(proposal, { request, registry, taxonomy });
  writeJson(path.resolve(args.out), changeSet);
  console.log(JSON.stringify({ actions: changeSet.actions.length }));
}

function validateCurrent(args) {
  const root = path.resolve(args.dir);
  const currentRoot = fs.existsSync(path.join(root, "current")) ? path.join(root, "current") : root;
  const registry = readJson(path.join(currentRoot, "candidate_registry.json"));
  const evaluation = readJson(path.join(currentRoot, "candidate_evaluation.json"));
  const publishedCandidates = readJson(path.join(currentRoot, "filterKeywordCandidates.json"));
  const currentMeta = readJson(path.join(currentRoot, "filterKeywordCandidates.meta.json"));
  const manifest = readJson(path.join(currentRoot, "run_manifest.json"));
  const taxonomy = readJson(args.taxonomy);
  validateGeneratedArtifacts({ registry, evaluation, publishedCandidates, currentMeta, manifest, taxonomy });
  console.log(JSON.stringify({ valid: true, run_id: currentMeta.run_id, published: publishedCandidates.length }));
}

function fullUpdate(args) {
  assertRequiredArgs(args, ["registry", "request", "proposal", "dataset", "policy", "taxonomy", "parent-manifest", "outdir"]);
  const registry = readJson(args.registry);
  const request = readJson(args.request);
  const proposal = readJson(args.proposal);
  const dataset = readJson(args.dataset);
  const policy = readJson(args.policy);
  const taxonomy = readJson(args.taxonomy);
  const parentManifest = readJson(args["parent-manifest"]);
  validateParentManifest({ parentManifest, request });
  const candidateView = args["candidate-view"] ? readJson(args["candidate-view"]) : undefined;
  const preEvaluation = args["pre-evaluation"] ? readJson(args["pre-evaluation"]) : undefined;
  if (args["handoff-manifest"]) {
    if (!args["candidate-view"] || !args["pre-evaluation"]) {
      throw codedError("HANDOFF_MANIFEST_MISMATCH", "--candidate-view and --pre-evaluation are required with --handoff-manifest");
    }
    const handoff = readHandoffBundle(args["handoff-manifest"]);
    verifyHandoffBundle({
      manifest: handoff.manifest,
      request,
      handoffFiles: handoff.handoffFiles,
      cliFiles: {
        "candidate_generation_request.json": readHandoffInputBytes(args.request, "candidate_generation_request.json"),
        "source_dataset.json": readHandoffInputBytes(args.dataset, "source_dataset.json"),
        "evaluation_policy.json": readHandoffInputBytes(args.policy, "evaluation_policy.json"),
        "taxonomy.json": readHandoffInputBytes(args.taxonomy, "taxonomy.json"),
        "candidate_view.json": readHandoffInputBytes(args["candidate-view"], "candidate_view.json"),
        "pre_evaluation.json": readHandoffInputBytes(args["pre-evaluation"], "pre_evaluation.json"),
      },
    });
  }
  const publishedAt = args["published-at"] ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const runId = args["run-id"] ?? createRunId();
  const knownConflictKeys = [...conflictSet(registry)];
  const prepared = prepareFullUpdate({
    request,
    proposal,
    registry,
    dataset,
    policy,
    taxonomy,
    candidateView,
    preEvaluation,
    publishedAt,
    runId,
    parentManifest,
    knownConflictKeys,
    evaluator: { version: "1.0.0", source_revision: "git:local" },
  });
  validateGeneratedArtifacts({
    registry: prepared.registryAfter,
    evaluation: prepared.evaluation,
    publishedCandidates: prepared.publishedCandidates,
    currentMeta: prepared.currentMeta,
    manifest: prepared.manifest,
    taxonomy,
  });
  publishBundleAtomically({
    rootDir: path.resolve(args.outdir),
    runId,
    baseRunId: request.base_publication.run_id,
    baseRegistryContentSha256: request.base_publication.registry_content_sha256,
    files: prepared.files,
  });
  exportFiles(args["export-dir"], prepared.files);
  console.log(JSON.stringify({ run_id: runId, published: prepared.publishedCandidates.length }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "bootstrap") return bootstrap(args);
  if (args.command === "evaluate") return evaluate(args);
  if (args.command === "generate-request") return generateRequest(args);
  if (args.command === "canonicalize-proposal") return canonicalizeProposalCommand(args);
  if (args.command === "validate-current") return validateCurrent(args);
  if (args.command === "prepare-handoff") return prepareHandoff(args);
  if (args.command === "full-update") return fullUpdate(args);
  usage();
  process.exitCode = 2;
}

try {
  main();
} catch (caught) {
  console.error(caught.errors ? JSON.stringify({ errors: caught.errors }, null, 2) : caught.stack ?? caught.message ?? caught);
  process.exitCode = 1;
}

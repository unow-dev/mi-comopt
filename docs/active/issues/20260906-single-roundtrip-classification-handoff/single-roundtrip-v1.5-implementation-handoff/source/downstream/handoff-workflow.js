import crypto from "node:crypto";
import {
  buildCandidateView,
  buildPreEvaluation,
  contentSha256,
  conflictSet,
  createRequestId,
  evaluateCandidates,
  makeGenerationRequest,
  prettyJson,
} from "./candidate-workflow.js";
import { validateGeneratedArtifacts } from "./artifact-validation.js";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PLAIN_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LABELING_PIPELINE_VERSION = "1.4.0";

export const HANDOFF_FILES = [
  "prompt.txt",
  "PROMPT_CONTRACT_v1.md",
  "candidate_generation_request.json",
  "candidate_view.json",
  "pre_evaluation.json",
  "evaluation_policy.json",
  "taxonomy.json",
  "source_dataset.json",
  "candidate-proposal.schema.json",
  "common.schema.json",
];

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function byteSha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function assertSha256(value, description) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw codedError("INVALID_SHA256", `${description} must be sha256:<64 lowercase hex>`);
  }
}

function assertHandoffBaseBindings({ currentMeta, manifest, evaluation, policy, taxonomy }) {
  const bindings = [
    ["run_id", [currentMeta?.run_id, manifest?.run_id]],
    ["source dataset artifact SHA", [currentMeta?.dataset_artifact_sha256, manifest?.source_dataset?.artifact_sha256, evaluation?.dataset?.artifact_sha256]],
    ["evaluation policy version", [currentMeta?.evaluation_policy_version, manifest?.evaluation_policy?.version, evaluation?.evaluation_policy?.version, policy?.policy_version]],
    ["evaluation policy content SHA", [currentMeta?.evaluation_policy_content_sha256, manifest?.evaluation_policy?.content_sha256, evaluation?.evaluation_policy?.content_sha256, contentSha256(policy)]],
    ["taxonomy version", [currentMeta?.taxonomy_version, manifest?.taxonomy?.version, taxonomy?.taxonomy_version]],
    ["taxonomy content SHA", [currentMeta?.taxonomy_content_sha256, manifest?.taxonomy?.content_sha256, contentSha256(taxonomy)]],
  ];
  for (const [name, values] of bindings) {
    if (values.some((value) => value === undefined || value === null) || values.some((value) => value !== values[0])) {
      throw codedError("HANDOFF_INPUT_MISMATCH", `${name} does not match across base publication and inputs`);
    }
  }
}

function resolveDatasetSourceSha(dataset, explicitSha) {
  const embedded = [];
  if (dataset && !Array.isArray(dataset)) {
    if (dataset.artifact_sha256 !== undefined) embedded.push({ name: "dataset.artifact_sha256", value: dataset.artifact_sha256 });
    if (dataset.manifest?.artifact_sha256 !== undefined) embedded.push({ name: "dataset.manifest.artifact_sha256", value: dataset.manifest.artifact_sha256 });
  }
  const candidate = explicitSha ?? embedded[0]?.value;
  if (candidate === undefined) throw codedError("SOURCE_SHA_REQUIRED", "dataset upstream artifact SHA is not discoverable");
  assertSha256(candidate, "source dataset artifact SHA");
  for (const item of embedded) {
    assertSha256(item.value, item.name);
    if (item.value !== candidate) throw codedError("DATASET_ARTIFACT_HASH_MISMATCH", `${item.name} does not match source dataset artifact SHA`);
  }
  return candidate;
}

function resolveDatasetSourceRef({ explicitRef, resolvedSha, baseManifest }) {
  if (explicitRef !== undefined) return explicitRef;
  if (resolvedSha === baseManifest.source_dataset.artifact_sha256) return baseManifest.source_dataset.artifact_ref;
  throw codedError("SOURCE_REF_REQUIRED", "--source-ref is required for a new source dataset artifact SHA");
}

function assertPlainSha(value, description) {
  if (typeof value !== "string" || !PLAIN_SHA256_PATTERN.test(value)) {
    throw codedError("LABELING_EVIDENCE_INVALID", `${description} must be 64 lowercase hexadecimal characters`);
  }
}

export function verifyLabelingEvidence({ labelingEvidence, datasetInput, explicitSourceSha }) {
  const summary = labelingEvidence?.summary;
  const validation = labelingEvidence?.validation;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw codedError("LABELING_EVIDENCE_INVALID", "labeling summary must be a JSON object");
  }
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    throw codedError("LABELING_EVIDENCE_INVALID", "labeling validation must be a JSON object");
  }
  if (summary.pipeline_version !== LABELING_PIPELINE_VERSION || validation.pipeline_version !== LABELING_PIPELINE_VERSION) {
    throw codedError("LABELING_EVIDENCE_INVALID", `pipeline_version must be ${LABELING_PIPELINE_VERSION}`);
  }
  if (summary.final_published !== true) {
    throw codedError("LABELING_EVIDENCE_INVALID", "labeling summary is not final_published");
  }
  if (summary.unresolved_mandatory_reviews !== 0) {
    throw codedError("LABELING_EVIDENCE_INVALID", "mandatory labeling reviews remain unresolved");
  }
  if (validation.all_checks_passed !== true) {
    throw codedError("LABELING_EVIDENCE_INVALID", "labeling validation checks did not pass");
  }
  if (validation.checks?.three_class_mandatory_reviews_resolved !== true) {
    throw codedError("LABELING_EVIDENCE_INVALID", "mandatory three-class reviews are not marked resolved");
  }
  if (validation.three_class_audit?.unresolved_mandatory !== 0) {
    throw codedError("LABELING_EVIDENCE_INVALID", "validation reports unresolved mandatory three-class reviews");
  }

  assertPlainSha(summary.input_sha256, "summary.input_sha256");
  assertPlainSha(validation.sha256?.stage13, "validation.sha256.stage13");
  if (summary.input_sha256 !== validation.sha256.stage13) {
    throw codedError("LABELING_EVIDENCE_INVALID", "summary.input_sha256 does not match validation.sha256.stage13");
  }
  assertPlainSha(summary.final_output_sha256, "summary.final_output_sha256");
  assertPlainSha(validation.sha256?.three_class, "validation.sha256.three_class");
  if (summary.final_output_sha256 !== validation.sha256.three_class) {
    throw codedError("LABELING_EVIDENCE_INVALID", "summary.final_output_sha256 does not match validation.sha256.three_class");
  }

  const evidenceSha = `sha256:${summary.final_output_sha256}`;
  if (byteSha256(datasetInput.bytes) !== evidenceSha) {
    throw codedError("LABELING_EVIDENCE_INVALID", "final dataset bytes do not match the labeling evidence SHA");
  }
  if (explicitSourceSha !== undefined) {
    if (!SHA256_PATTERN.test(explicitSourceSha) || explicitSourceSha !== evidenceSha) {
      throw codedError("LABELING_EVIDENCE_INVALID", "--source-sha does not match the verified labeling SHA");
    }
  }
  if (datasetInput.value && !Array.isArray(datasetInput.value)) {
    const embedded = [datasetInput.value.artifact_sha256, datasetInput.value.manifest?.artifact_sha256].filter((value) => value !== undefined);
    if (embedded.some((value) => value !== evidenceSha)) {
      throw codedError("LABELING_EVIDENCE_INVALID", "dataset embedded artifact SHA does not match the verified labeling SHA");
    }
  }
  return { sourceSha: evidenceSha };
}

export function prepareHandoffBundle({
  registry,
  evaluation,
  publishedCandidates,
  currentMeta,
  baseManifest,
  datasetInput,
  policyInput,
  taxonomyInput,
  labelingEvidence,
  explicitSourceSha,
  explicitSourceRef,
  requestId,
  runtimeBytes,
}) {
  validateGeneratedArtifacts({
    registry,
    evaluation,
    publishedCandidates,
    currentMeta,
    manifest: baseManifest,
    taxonomy: taxonomyInput.value,
  });
  assertHandoffBaseBindings({
    currentMeta,
    manifest: baseManifest,
    evaluation,
    policy: policyInput.value,
    taxonomy: taxonomyInput.value,
  });

  const sourceSha = labelingEvidence
    ? verifyLabelingEvidence({ labelingEvidence, datasetInput, explicitSourceSha }).sourceSha
    : resolveDatasetSourceSha(datasetInput.value, explicitSourceSha);
  const sourceRef = resolveDatasetSourceRef({
    explicitRef: explicitSourceRef,
    resolvedSha: sourceSha,
    baseManifest,
  });
  const knownConflictKeys = [...conflictSet(registry)];
  const evaluationPolicy = {
    version: policyInput.value.policy_version,
    content_sha256: contentSha256(policyInput.value),
  };
  const taxonomy = {
    version: taxonomyInput.value.taxonomy_version,
    content_sha256: contentSha256(taxonomyInput.value),
  };
  const preEvaluationResult = evaluateCandidates({
    registry,
    dataset: datasetInput.value,
    policy: policyInput.value,
    policyContentSha256: evaluationPolicy.content_sha256,
    taxonomy: taxonomyInput.value,
    artifactSha256: sourceSha,
    knownConflictKeys,
  });
  const candidateView = buildCandidateView(registry);
  const preEvaluation = buildPreEvaluation(preEvaluationResult);
  const request = makeGenerationRequest({
    requestId: requestId ?? createRequestId(),
    baseRunId: baseManifest.run_id,
    baseRegistryContentSha256: contentSha256(registry),
    sourceDatasetArtifactSha256: sourceSha,
    sourceDatasetArtifactRef: sourceRef,
    candidateView,
    preEvaluation,
    evaluationPolicy,
    taxonomy,
  });

  const files = {
    "prompt.txt": runtimeBytes["prompt.txt"],
    "PROMPT_CONTRACT_v1.md": runtimeBytes["PROMPT_CONTRACT_v1.md"],
    "candidate_generation_request.json": Buffer.from(prettyJson(request), "utf8"),
    "candidate_view.json": Buffer.from(prettyJson(candidateView), "utf8"),
    "pre_evaluation.json": Buffer.from(prettyJson(preEvaluation), "utf8"),
    "evaluation_policy.json": policyInput.bytes,
    "taxonomy.json": taxonomyInput.bytes,
    "source_dataset.json": datasetInput.bytes,
    "candidate-proposal.schema.json": runtimeBytes["candidate-proposal.schema.json"],
    "common.schema.json": runtimeBytes["common.schema.json"],
  };
  const handoffManifest = {
    schema_version: 1,
    request_id: request.request_id,
    input_fingerprint: request.input_fingerprint,
    files: Object.fromEntries(HANDOFF_FILES.map((name) => [name, byteSha256(files[name])])),
  };
  files["handoff_manifest.json"] = Buffer.from(prettyJson(handoffManifest), "utf8");
  return {
    request,
    sourceSha,
    sourceRef,
    handoffManifest,
    files,
  };
}

export function verifyHandoffBundle({ manifest, request, handoffFiles, cliFiles }) {
  if (!manifest || manifest.schema_version !== 1 || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    throw codedError("HANDOFF_MANIFEST_MISMATCH", "manifest structure is invalid");
  }
  if (manifest.request_id !== request.request_id || manifest.input_fingerprint !== request.input_fingerprint) {
    throw codedError("HANDOFF_MANIFEST_MISMATCH", "manifest request identity does not match request");
  }
  const manifestNames = Object.keys(manifest.files).sort();
  if (manifestNames.join("\u001f") !== [...HANDOFF_FILES].sort().join("\u001f")) {
    throw codedError("HANDOFF_MANIFEST_MISMATCH", "manifest file set is invalid");
  }
  for (const name of HANDOFF_FILES) {
    const expected = manifest.files[name];
    if (typeof expected !== "string" || !SHA256_PATTERN.test(expected)) {
      throw codedError("HANDOFF_MANIFEST_MISMATCH", `manifest hash is invalid for ${name}`);
    }
    const bytes = handoffFiles?.[name];
    if (!bytes) throw codedError("HANDOFF_MANIFEST_MISMATCH", `handoff file is missing: ${name}`);
    if (byteSha256(bytes) !== expected) throw codedError("HANDOFF_MANIFEST_MISMATCH", `handoff file bytes differ: ${name}`);
  }
  for (const [name, bytes] of Object.entries(cliFiles ?? {})) {
    if (!bytes) throw codedError("HANDOFF_MANIFEST_MISMATCH", `CLI input cannot be read for ${name}`);
    if (byteSha256(bytes) !== manifest.files[name]) throw codedError("HANDOFF_MANIFEST_MISMATCH", `CLI input bytes differ: ${name}`);
  }
  return true;
}

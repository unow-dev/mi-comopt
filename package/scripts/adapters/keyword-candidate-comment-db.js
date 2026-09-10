import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  CommentDatabaseError,
  PACKAGE_ROOT,
  openCommentDatabase,
} from "../../src/database/comment-database.js";
import {
  readSelectedSnapshots,
} from "../../src/database/raw-snapshot-repository.js";
import {
  readSnapshotThreeClassLabels,
} from "../../src/database/three-class-label-repository.js";
import {
  clearCurrentKeywordCandidatePublication,
  insertKeywordCandidatePublication,
  readCurrentKeywordCandidatePublication,
  readKeywordCandidatePublication,
} from "../../src/database/keyword-candidate-publication-repository.js";
import {
  ALLOWED_LABELS,
  conflictSet,
  contentSha256,
  makeGenerationRequest,
  prettyJson,
  validateProposal,
} from "../../src/processing/keyword-candidates/candidate-workflow.js";
import {
  HANDOFF_FILES,
  prepareHandoffBundle,
  verifyHandoffBundle,
} from "../../src/processing/keyword-candidates/handoff-workflow.js";
import { prepareFullUpdate, validateParentManifest } from "../../src/processing/keyword-candidates/update-flow.js";
import { validateGeneratedArtifacts } from "../../src/processing/keyword-candidates/artifact-validation.js";
import { resolveCurrentPublicationDir } from "./keyword-publication.js";

const CONTRACT_ROOT = path.join(PACKAGE_ROOT, "contracts", "candidate-handoff", "v1");
const HANDOFF_PACKAGER_PATH = path.join(PACKAGE_ROOT, "scripts", "pack-keyword-candidate-handoff.py");
const KEYWORD_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "evaluation-policy-1.0.0.json");
const KEYWORD_TAXONOMY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "taxonomy-1.0.0.json");
const RUNTIME_CONTRACT_FILES = [
  "prompt.txt",
  "PROMPT_CONTRACT_v1.md",
  "candidate-proposal.schema.json",
  "common.schema.json",
];
const HANDOFF_ARCHIVE_FILES = [...HANDOFF_FILES, "handoff_manifest.json"];
const PUBLICATION_FILES = [
  "candidate_registry.json",
  "filterKeywordCandidates.json",
  "filterKeywordCandidates.meta.json",
  "run_manifest.json",
  "candidate_evaluation.json",
  "candidate_view.json",
  "pre_evaluation.json",
  "candidate_generation_request.json",
  "candidate_proposal.json",
  "candidate_change_set.json",
];
const GENERATION_PUBLICATION_FILES = [
  "candidate_registry.json",
  "filterKeywordCandidates.json",
  "filterKeywordCandidates.meta.json",
  "run_manifest.json",
  "candidate_evaluation.json",
];
const PUBLICATION_ARTIFACTS = [
  ["candidate_view", "candidate_view.json"],
  ["pre_evaluation", "pre_evaluation.json"],
  ["candidate_generation_request", "candidate_generation_request.json"],
  ["candidate_proposal", "candidate_proposal.json"],
  ["candidate_change_set", "candidate_change_set.json"],
  ["candidate_evaluation", "candidate_evaluation.json"],
];
const IMMUTABLE_PUBLICATION_COLUMNS = [
  "run_id",
  "snapshot_id",
  "request_id",
  "input_fingerprint",
  "source_dataset_artifact_sha256",
  "base_run_id",
  "published_at",
  "handoff_manifest_json",
  "candidate_generation_request_json",
  "candidate_proposal_json",
  "run_manifest_json",
  "current_meta_json",
  "filter_keyword_candidates_json",
];
const PLAIN_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function codedError(code, message, options = {}) {
  const error = new Error(`${code}: ${message}`, options);
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteSha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJsonBytes(filePath, failureCode, description) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw codedError(failureCode, `${description} could not be read: ${error.message}`, { cause: error });
  }
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch (error) {
    throw codedError(failureCode, `${description} is not valid JSON: ${error.message}`, { cause: error });
  }
}

function readHandoffBundle(manifestPath) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestInput = readJsonBytes(
    resolvedManifestPath,
    "HANDOFF_MANIFEST_MISMATCH",
    "handoff manifest",
  );
  const handoffDir = path.dirname(resolvedManifestPath);
  const handoffFiles = {};
  for (const name of HANDOFF_FILES) {
    try {
      handoffFiles[name] = fs.readFileSync(path.join(handoffDir, name));
    } catch (error) {
      throw codedError("HANDOFF_MANIFEST_MISMATCH", `handoff file is missing: ${name}`, { cause: error });
    }
  }
  return {
    handoffDir,
    manifest: manifestInput.value,
    manifestBytes: manifestInput.bytes,
    handoffFiles,
  };
}

function readCurrentPublicationFiles(publicationRoot, fileNames = PUBLICATION_FILES) {
  let currentDir;
  try {
    currentDir = resolveCurrentPublicationDir(path.resolve(publicationRoot));
  } catch (error) {
    throw codedError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", `current publication cannot be resolved: ${error.message}`, { cause: error });
  }

  const files = {};
  for (const name of fileNames) {
    const input = readJsonBytes(
      path.join(currentDir, name),
      "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
      `current publication ${name}`,
    );
    files[name] = input;
  }
  return { currentDir, files };
}

function readParentPublicationFiles(publicationRoot, baseRunId) {
  if (typeof baseRunId !== "string" || baseRunId.length === 0 || path.basename(baseRunId) !== baseRunId) {
    throw codedError("PARENT_MANIFEST_MISMATCH", "request base publication run_id is invalid");
  }
  const parentDir = path.join(path.resolve(publicationRoot), "publications", baseRunId);
  let manifest;
  let registry;
  try {
    manifest = readJsonBytes(
      path.join(parentDir, "run_manifest.json"),
      "PARENT_MANIFEST_MISMATCH",
      "parent run manifest",
    );
    registry = readJsonBytes(
      path.join(parentDir, "candidate_registry.json"),
      "PARENT_MANIFEST_MISMATCH",
      "parent candidate registry",
    );
  } catch (error) {
    if (error instanceof Error && error.code === "PARENT_MANIFEST_MISMATCH") throw error;
    throw codedError("PARENT_MANIFEST_MISMATCH", `parent publication is unavailable: ${error.message}`, { cause: error });
  }
  return { parentDir, manifest, registry };
}

function assertOutputPathAbsent(outputPath) {
  try {
    fs.lstatSync(path.resolve(outputPath));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw codedError("HANDOFF_OUTPUT_EXISTS", `cannot inspect --output: ${error.message}`, { cause: error });
  }
  throw codedError("HANDOFF_OUTPUT_EXISTS", "--output already exists");
}

function pythonExecutable() {
  return process.env.TIKTOK_FILTER_KEYWORDS_PYTHON ?? process.env.PYTHON ?? "python3";
}

function packageHandoffZip({ outputPath, inputDir }) {
  const result = spawnSync(pythonExecutable(), [
    HANDOFF_PACKAGER_PATH,
    "package",
    "--input-dir", inputDir,
    "--output", outputPath,
  ], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw codedError("HANDOFF_PACKAGING_FAILED", `handoff ZIP packaging could not be started: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw codedError("HANDOFF_PACKAGING_FAILED", `handoff ZIP packaging failed with exit code ${result.status}${details ? `: ${details}` : ""}`);
  }
  try {
    const packed = JSON.parse(result.stdout);
    if (packed?.member_count !== HANDOFF_ARCHIVE_FILES.length) {
      throw new Error("unexpected archive member count");
    }
  } catch (error) {
    throw codedError("HANDOFF_PACKAGING_FAILED", `handoff ZIP packager returned invalid output: ${error.message}`, { cause: error });
  }
}

function writeExclusiveHandoffZip(outputPath, files) {
  const absolute = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(path.dirname(absolute), ".keyword-candidate-handoff-"));
  let ownsOutputFile = false;
  try {
    for (const name of HANDOFF_ARCHIVE_FILES) {
      fs.writeFileSync(path.join(stagingDir, name), files[name], { flag: "wx" });
    }
    packageHandoffZip({ outputPath: absolute, inputDir: stagingDir });
    ownsOutputFile = true;
    const stats = fs.lstatSync(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw codedError("HANDOFF_PACKAGING_FAILED", "generated handoff ZIP must be a regular file");
    }
  } catch (error) {
    if (error.code === "EEXIST" && !ownsOutputFile) {
      throw codedError("HANDOFF_OUTPUT_EXISTS", "--output already exists");
    }
    if (ownsOutputFile && fs.existsSync(absolute)) fs.unlinkSync(absolute);
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  return absolute;
}

function validateSnapshotRef(snapshotRef) {
  if (
    !isRecord(snapshotRef)
    || typeof snapshotRef.payloadSha256 !== "string"
    || !PLAIN_SHA256_PATTERN.test(snapshotRef.payloadSha256)
    || !Number.isSafeInteger(snapshotRef.snapshotIndex)
    || snapshotRef.snapshotIndex < 0
  ) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "snapshotRef must be { payloadSha256, snapshotIndex }");
  }
}

function validateLabelCompleteness(selectedSnapshots, labelRows) {
  if (!Array.isArray(selectedSnapshots) || selectedSnapshots.length !== 1) {
    throw codedError("THREE_CLASS_LABELS_INCOMPLETE", "exactly one snapshot is required");
  }
  const bundle = selectedSnapshots[0];
  const observations = bundle.observations;
  const loadedCount = Number(bundle.snapshot.loadedCount);
  if (!Array.isArray(observations) || observations.length !== loadedCount || labelRows.length !== loadedCount) {
    throw codedError("THREE_CLASS_LABELS_INCOMPLETE", "snapshot observations and three-class labels are incomplete");
  }
  for (let index = 0; index < loadedCount; index += 1) {
    const observation = observations[index];
    const labelRow = labelRows[index];
    if (
      observation?.sourceIndex !== index
      || labelRow?.sourceIndex !== index
      || !ALLOWED_LABELS.includes(labelRow?.label)
    ) {
      throw codedError("THREE_CLASS_LABELS_INCOMPLETE", `source_index ${index} is missing, misaligned, or invalid`);
    }
  }
}

export function buildDbKeywordCandidateDataset(selectedSnapshots, labelRows) {
  validateLabelCompleteness(selectedSnapshots, labelRows);
  const bundle = selectedSnapshots[0];
  return {
    schema_version: 1,
    labeling_status: "published",
    snapshot_ref: {
      payload_sha256: bundle.snapshot.payloadSha256,
      snapshot_index: bundle.snapshot.snapshotIndex,
    },
    records: bundle.observations.map((observation, index) => ({
      source_index: index,
      username: observation.username,
      handle: observation.handle,
      comment: observation.commentText,
      postedAt: observation.postedAt,
      postedDate: observation.postedDate,
      label: labelRows[index].label,
    })),
  };
}

export function serializeDbKeywordCandidateDataset(dataset) {
  return Buffer.from(prettyJson(dataset), "utf8");
}

function readRuntimeContractBytes() {
  return Object.fromEntries(RUNTIME_CONTRACT_FILES.map((name) => [
    name,
    fs.readFileSync(path.join(CONTRACT_ROOT, name)),
  ]));
}

function readKeywordPolicyInput() {
  return readJsonBytes(KEYWORD_POLICY_PATH, "HANDOFF_INPUT_MISMATCH", "evaluation policy");
}

function readKeywordTaxonomyInput() {
  return readJsonBytes(KEYWORD_TAXONOMY_PATH, "HANDOFF_INPUT_MISMATCH", "taxonomy");
}

function loadDbSourceDataset(db, snapshotRef) {
  validateSnapshotRef(snapshotRef);
  const selectedSnapshots = readSelectedSnapshots(db, [snapshotRef]);
  const labels = readSnapshotThreeClassLabels(db, selectedSnapshots[0].snapshot.snapshotId);
  const dataset = buildDbKeywordCandidateDataset(selectedSnapshots, labels);
  const bytes = serializeDbKeywordCandidateDataset(dataset);
  return {
    snapshotId: selectedSnapshots[0].snapshot.snapshotId,
    dataset,
    bytes,
    artifactSha256: byteSha256(bytes),
    artifactRef: `${dataset.snapshot_ref.payload_sha256}:${dataset.snapshot_ref.snapshot_index}`,
  };
}

function assertSemanticEqual(left, right, code, message) {
  try {
    if (contentSha256(left) !== contentSha256(right)) throw codedError(code, message);
  } catch (error) {
    if (error.code === code) throw error;
    throw codedError(code, message, { cause: error });
  }
}

function assertEqualValues(values, code, message) {
  if (
    values.some((value) => value === undefined || value === null)
    || values.some((value) => value !== values[0])
  ) {
    throw codedError(code, message);
  }
}

function validateDbSourceDatasetShape(dataset) {
  if (!isRecord(dataset) || dataset.schema_version !== 1 || dataset.labeling_status !== "published" || !Array.isArray(dataset.records)) {
    throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "source_dataset shape is invalid");
  }
  const reference = dataset.snapshot_ref;
  if (
    !isRecord(reference)
    || !PLAIN_SHA256_PATTERN.test(reference.payload_sha256 ?? "")
    || !Number.isSafeInteger(reference.snapshot_index)
    || reference.snapshot_index < 0
  ) {
    throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "source_dataset snapshot_ref is invalid");
  }
  dataset.records.forEach((record, index) => {
    if (
      !isRecord(record)
      || record.source_index !== index
      || typeof record.username !== "string"
      || typeof record.handle !== "string"
      || typeof record.comment !== "string"
      || typeof record.postedAt !== "string"
      || typeof record.postedDate !== "string"
      || !ALLOWED_LABELS.includes(record.label)
    ) {
      throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", `source_dataset.records[${index}] is invalid`);
    }
  });
}

function validateRequestSourceBinding(request, source) {
  if (!isRecord(request) || !isRecord(request.source_dataset)) {
    throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "request source_dataset is missing");
  }
  if (request.source_dataset.artifact_sha256 !== source.artifactSha256) {
    throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "request source dataset SHA does not match exact source bytes");
  }
  if (request.source_dataset.artifact_ref !== source.artifactRef) {
    throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "request source dataset ref does not match snapshot identity");
  }
}

function rebuildAndVerifyRequest(request, source, policy, taxonomy, candidateView, preEvaluation) {
  let rebuilt;
  try {
    rebuilt = makeGenerationRequest({
      requestId: request.request_id,
      baseRunId: request.base_publication?.run_id,
      baseRegistryContentSha256: request.base_publication?.registry_content_sha256,
      sourceDatasetArtifactSha256: source.artifactSha256,
      sourceDatasetArtifactRef: source.artifactRef,
      candidateView,
      preEvaluation,
      evaluationPolicy: {
        version: policy.policy_version,
        content_sha256: contentSha256(policy),
      },
      taxonomy: {
        version: taxonomy.taxonomy_version,
        content_sha256: contentSha256(taxonomy),
      },
      outputSchemaVersion: request.output_schema_version,
    });
  } catch (error) {
    throw codedError("HANDOFF_INPUT_MISMATCH", `candidate generation request cannot be reproduced: ${error.message}`, { cause: error });
  }
  assertSemanticEqual(rebuilt, request, "HANDOFF_INPUT_MISMATCH", "candidate generation request cannot be reproduced from verified inputs");
  return rebuilt;
}

function validatePublicationArtifactBindings(publication) {
  const { files } = publication;
  const manifest = files["run_manifest.json"].value;
  if (!isRecord(manifest.artifacts)) {
    throw codedError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", "run manifest artifacts are missing");
  }
  for (const [artifactName, fileName] of PUBLICATION_ARTIFACTS) {
    const reference = manifest.artifacts[artifactName];
    if (
      !isRecord(reference)
      || reference.artifact_ref !== fileName
      || reference.content_sha256 !== contentSha256(files[fileName].value)
    ) {
      throw codedError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", `run manifest artifact binding is invalid: ${fileName}`);
    }
  }
}

function validatePublicationCrossBindings({ request, handoffPolicy, handoffTaxonomy, publication }) {
  const { files } = publication;
  const currentMeta = files["filterKeywordCandidates.meta.json"].value;
  const manifest = files["run_manifest.json"].value;
  const evaluation = files["candidate_evaluation.json"].value;

  assertEqualValues(
    [currentMeta.run_id, manifest.run_id],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current meta and run manifest run_id differ",
  );
  assertEqualValues(
    [currentMeta.run_manifest_content_sha256, contentSha256(manifest)],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current meta run manifest hash differs",
  );
  assertEqualValues(
    [currentMeta.candidates_content_sha256, contentSha256(files["filterKeywordCandidates.json"].value)],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current meta candidate hash differs",
  );
  assertEqualValues(
    [currentMeta.registry_content_sha256, contentSha256(files["candidate_registry.json"].value)],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current meta registry hash differs",
  );
  assertEqualValues(
    [manifest.base_run_id, request.base_publication?.run_id],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "run manifest base publication differs from request",
  );
  assertSemanticEqual(
    request.source_dataset,
    manifest.source_dataset,
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "run manifest source dataset differs from request",
  );
  assertEqualValues(
    [evaluation.dataset?.artifact_sha256, request.source_dataset?.artifact_sha256, currentMeta.dataset_artifact_sha256],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "publication source dataset SHA bindings differ",
  );

  const policyHash = contentSha256(handoffPolicy);
  const taxonomyHash = contentSha256(handoffTaxonomy);
  assertEqualValues(
    [
      handoffPolicy.policy_version,
      request.evaluation_policy?.version,
      manifest.evaluation_policy?.version,
      evaluation.evaluation_policy?.version,
      currentMeta.evaluation_policy_version,
    ],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "evaluation policy versions differ across publication bindings",
  );
  assertEqualValues(
    [
      policyHash,
      request.evaluation_policy?.content_sha256,
      manifest.evaluation_policy?.content_sha256,
      evaluation.evaluation_policy?.content_sha256,
      currentMeta.evaluation_policy_content_sha256,
    ],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "evaluation policy hashes differ across publication bindings",
  );
  assertEqualValues(
    [
      handoffTaxonomy.taxonomy_version,
      request.taxonomy?.version,
      manifest.taxonomy?.version,
      currentMeta.taxonomy_version,
    ],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "taxonomy versions differ across publication bindings",
  );
  assertEqualValues(
    [
      taxonomyHash,
      request.taxonomy?.content_sha256,
      manifest.taxonomy?.content_sha256,
      currentMeta.taxonomy_content_sha256,
    ],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "taxonomy hashes differ across publication bindings",
  );
  assertEqualValues(
    [currentMeta.published_at, manifest.published_at],
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "published timestamps differ across publication bindings",
  );
}

function validateCurrentPublication({ publicationRoot, request, handoffSource, policy, taxonomy, candidateView, preEvaluation }) {
  const publication = readCurrentPublicationFiles(publicationRoot);
  const { files } = publication;
  assertSemanticEqual(
    files["candidate_generation_request.json"].value,
    request,
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current publication request differs from handoff request",
  );
  assertSemanticEqual(
    files["candidate_view.json"].value,
    candidateView,
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current publication candidate view differs from handoff",
  );
  assertSemanticEqual(
    files["pre_evaluation.json"].value,
    preEvaluation,
    "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
    "current publication pre-evaluation differs from handoff",
  );
  if (files["run_manifest.json"].value.run_type !== "full_update") {
    throw codedError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", "current publication is not a full_update");
  }

  const parent = readParentPublicationFiles(publicationRoot, request.base_publication?.run_id);
  validateParentManifest({ parentManifest: parent.manifest.value, request });
  if (contentSha256(parent.registry.value) !== request.base_publication?.registry_content_sha256) {
    const error = codedError("STALE_PARENT", "parent candidate registry does not match request base publication");
    throw error;
  }
  if (files["run_manifest.json"].value.parent_manifest_content_sha256 !== contentSha256(parent.manifest.value)) {
    throw codedError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", "current run parent manifest hash differs from filesystem parent");
  }

  validateProposal(files["candidate_proposal.json"].value, {
    request,
    registry: parent.registry.value,
    taxonomy,
  });
  const manifest = files["run_manifest.json"].value;
  const replayed = prepareFullUpdate({
    request,
    proposal: files["candidate_proposal.json"].value,
    registry: parent.registry.value,
    dataset: handoffSource.dataset,
    policy,
    taxonomy,
    candidateView,
    preEvaluation,
    publishedAt: manifest.published_at,
    startedAt: manifest.started_at,
    completedAt: manifest.completed_at,
    runId: manifest.run_id,
    parentManifest: parent.manifest.value,
    evaluator: manifest.evaluator,
    candidateIdFactory: (_action, index) => files["candidate_change_set.json"].value?.actions?.[index]?.candidate_id,
    knownConflictKeys: [...conflictSet(parent.registry.value)],
  });
  for (const name of PUBLICATION_FILES) {
    assertSemanticEqual(
      files[name].value,
      replayed.files[name],
      "KEYWORD_CANDIDATE_PUBLICATION_MISMATCH",
      `current publication ${name} cannot be reproduced by full_update`,
    );
  }

  validateGeneratedArtifacts({
    registry: files["candidate_registry.json"].value,
    evaluation: files["candidate_evaluation.json"].value,
    publishedCandidates: files["filterKeywordCandidates.json"].value,
    currentMeta: files["filterKeywordCandidates.meta.json"].value,
    manifest: files["run_manifest.json"].value,
    taxonomy,
  });
  validatePublicationArtifactBindings(publication);
  validatePublicationCrossBindings({
    request,
    handoffPolicy: policy,
    handoffTaxonomy: taxonomy,
    publication,
  });

  return {
    publication,
    parent,
    sourceDataset: handoffSource,
  };
}

function withImmediateTransaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
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
        // Preserve the original transaction error.
      }
    }
  }
}

function assertKeywordPublicationTableIntegrity(db) {
  const rowCount = Number(db.prepare("SELECT COUNT(*) AS count FROM keyword_candidate_publications").get().count);
  const currentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM keyword_candidate_publications WHERE is_current = 1").get().count);
  if (currentCount > 1) throw new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", "multiple current keyword-candidate publications exist");
  if (rowCount > 0 && currentCount === 0) {
    throw new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", "keyword-candidate publications have no current row");
  }
}

function immutablePublicationEquals(left, right) {
  return IMMUTABLE_PUBLICATION_COLUMNS.every((column) => left[column] === right[column]);
}

function buildPublicationRecord({ handoff, request, publication, snapshotId, appliedAt }) {
  const files = publication.files;
  const currentMeta = files["filterKeywordCandidates.meta.json"].value;
  return {
    run_id: currentMeta.run_id,
    snapshot_id: snapshotId,
    request_id: request.request_id,
    input_fingerprint: request.input_fingerprint,
    source_dataset_artifact_sha256: request.source_dataset.artifact_sha256,
    base_run_id: request.base_publication.run_id,
    published_at: currentMeta.published_at,
    applied_at: appliedAt,
    is_current: 1,
    handoff_manifest_json: handoff.manifestBytes.toString("utf8"),
    candidate_generation_request_json: handoff.handoffFiles["candidate_generation_request.json"].toString("utf8"),
    candidate_proposal_json: files["candidate_proposal.json"].bytes.toString("utf8"),
    run_manifest_json: files["run_manifest.json"].bytes.toString("utf8"),
    current_meta_json: files["filterKeywordCandidates.meta.json"].bytes.toString("utf8"),
    filter_keyword_candidates_json: files["filterKeywordCandidates.json"].bytes.toString("utf8"),
  };
}

export async function generateKeywordCandidateHandoff({ dbPath, snapshotRef, publicationRoot, outputPath }) {
  if (!publicationRoot || !outputPath) throw new CommentDatabaseError("VALIDATION_ERROR", "publicationRoot and outputPath are required");
  validateSnapshotRef(snapshotRef);
  assertOutputPathAbsent(outputPath);
  const db = await openCommentDatabase(dbPath);
  try {
    const source = loadDbSourceDataset(db, snapshotRef);
    const publication = readCurrentPublicationFiles(publicationRoot, GENERATION_PUBLICATION_FILES);
    const policyInput = readKeywordPolicyInput();
    const taxonomyInput = readKeywordTaxonomyInput();
    const prepared = prepareHandoffBundle({
      registry: publication.files["candidate_registry.json"].value,
      evaluation: publication.files["candidate_evaluation.json"].value,
      publishedCandidates: publication.files["filterKeywordCandidates.json"].value,
      currentMeta: publication.files["filterKeywordCandidates.meta.json"].value,
      baseManifest: publication.files["run_manifest.json"].value,
      datasetInput: { value: source.dataset, bytes: source.bytes },
      policyInput,
      taxonomyInput,
      explicitSourceSha: source.artifactSha256,
      explicitSourceRef: source.artifactRef,
      runtimeBytes: readRuntimeContractBytes(),
    });
    const output = writeExclusiveHandoffZip(outputPath, prepared.files);
    return {
      status: "generated",
      requestId: prepared.request.request_id,
      inputFingerprint: prepared.request.input_fingerprint,
      sourceDataset: {
        artifactRef: prepared.sourceRef,
        artifactSha256: prepared.sourceSha,
      },
      output,
    };
  } finally {
    db.close();
  }
}

export async function applyKeywordCandidatePublication({ dbPath, handoffManifestPath, publicationRoot }) {
  if (!handoffManifestPath || !publicationRoot) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "handoffManifestPath and publicationRoot are required");
  }
  const handoff = readHandoffBundle(handoffManifestPath);
  const requestInput = (() => {
    try {
      const bytes = handoff.handoffFiles["candidate_generation_request.json"];
      return { value: JSON.parse(bytes.toString("utf8")), bytes };
    } catch (error) {
      throw codedError("HANDOFF_MANIFEST_MISMATCH", `candidate generation request is not valid JSON: ${error.message}`, { cause: error });
    }
  })();
  if (!isRecord(requestInput.value)) {
    throw codedError("HANDOFF_MANIFEST_MISMATCH", "candidate generation request must be a JSON object");
  }
  verifyHandoffBundle({
    manifest: handoff.manifest,
    request: requestInput.value,
    handoffFiles: handoff.handoffFiles,
  });

  const sourceDatasetInput = (() => {
    try {
      const bytes = handoff.handoffFiles["source_dataset.json"];
      return { value: JSON.parse(bytes.toString("utf8")), bytes };
    } catch (error) {
      throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", `source_dataset is not valid JSON: ${error.message}`, { cause: error });
    }
  })();
  validateDbSourceDatasetShape(sourceDatasetInput.value);

  const db = await openCommentDatabase(dbPath);
  try {
    const snapshotRef = {
      payloadSha256: sourceDatasetInput.value.snapshot_ref.payload_sha256,
      snapshotIndex: sourceDatasetInput.value.snapshot_ref.snapshot_index,
    };
    let source;
    try {
      source = loadDbSourceDataset(db, snapshotRef);
    } catch (error) {
      if (error.code === "THREE_CLASS_LABELS_INCOMPLETE") {
        throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "DB labels do not reproduce the handoff source dataset", { cause: error });
      }
      throw error;
    }
    if (!source.bytes.equals(sourceDatasetInput.bytes)) {
      throw codedError("KEYWORD_CANDIDATE_SOURCE_MISMATCH", "regenerated source_dataset bytes differ from handoff");
    }
    validateRequestSourceBinding(requestInput.value, source);

    let policy;
    let taxonomy;
    let candidateView;
    let preEvaluation;
    try {
      policy = JSON.parse(handoff.handoffFiles["evaluation_policy.json"].toString("utf8"));
      taxonomy = JSON.parse(handoff.handoffFiles["taxonomy.json"].toString("utf8"));
      candidateView = JSON.parse(handoff.handoffFiles["candidate_view.json"].toString("utf8"));
      preEvaluation = JSON.parse(handoff.handoffFiles["pre_evaluation.json"].toString("utf8"));
    } catch (error) {
      throw codedError("HANDOFF_INPUT_MISMATCH", `handoff input is not valid JSON: ${error.message}`, { cause: error });
    }
    rebuildAndVerifyRequest(requestInput.value, source, policy, taxonomy, candidateView, preEvaluation);

    const current = validateCurrentPublication({
      publicationRoot,
      request: requestInput.value,
      handoffSource: source,
      policy,
      taxonomy,
      candidateView,
      preEvaluation,
    });
    const incomingRecord = buildPublicationRecord({
      handoff,
      request: requestInput.value,
      publication: current.publication,
      snapshotId: source.snapshotId,
      appliedAt: new Date().toISOString(),
    });

    return withImmediateTransaction(db, () => {
      assertKeywordPublicationTableIntegrity(db);
      const existing = readKeywordCandidatePublication(db, incomingRecord.run_id);
      if (existing !== null) {
        if (Number(existing.is_current) !== 1) {
          throw new CommentDatabaseError("KEYWORD_CANDIDATE_RUN_CONFLICT", `run_id is already stored as non-current: ${incomingRecord.run_id}`);
        }
        if (!immutablePublicationEquals(existing, incomingRecord)) {
          throw new CommentDatabaseError("KEYWORD_CANDIDATE_RUN_CONFLICT", `run_id content differs from stored publication: ${incomingRecord.run_id}`);
        }
        return {
          status: "already-applied",
          runId: incomingRecord.run_id,
          snapshotId: incomingRecord.snapshot_id,
        };
      }

      clearCurrentKeywordCandidatePublication(db);
      insertKeywordCandidatePublication(db, incomingRecord);
      return {
        status: "applied",
        runId: incomingRecord.run_id,
        snapshotId: incomingRecord.snapshot_id,
      };
    });
  } finally {
    db.close();
  }
}

function atomicReplaceTextFile(outputPath, text) {
  const target = path.resolve(outputPath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  let temporaryOwned = false;
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    temporaryOwned = true;
    fs.renameSync(temporary, target);
    temporaryOwned = false;
  } catch (error) {
    throw new CommentDatabaseError("EXPORT_WRITE_FAILED", `${target}: ${error.message}`, { cause: error });
  } finally {
    if (temporaryOwned || fs.existsSync(temporary)) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Preserve the original export error.
      }
    }
  }
}

export async function exportKeywordCandidatesUi({ dbPath, outputPath }) {
  if (!outputPath) throw new CommentDatabaseError("VALIDATION_ERROR", "outputPath is required");
  const db = await openCommentDatabase(dbPath);
  try {
    const current = readCurrentKeywordCandidatePublication(db);
    if (current === null) {
      throw new CommentDatabaseError("KEYWORD_CANDIDATE_PUBLICATION_NOT_FOUND", "no DB-current keyword-candidate publication exists");
    }
    let candidates;
    let currentMeta;
    try {
      candidates = JSON.parse(current.filter_keyword_candidates_json);
      currentMeta = JSON.parse(current.current_meta_json);
    } catch (error) {
      throw new CommentDatabaseError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", `stored current publication JSON is invalid: ${error.message}`, { cause: error });
    }
    if (!Array.isArray(candidates) || !isRecord(currentMeta)) {
      throw new CommentDatabaseError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", "stored current publication shape is invalid");
    }
    if (contentSha256(candidates) !== currentMeta.candidates_content_sha256) {
      throw new CommentDatabaseError("KEYWORD_CANDIDATE_PUBLICATION_MISMATCH", "stored candidate JSON hash does not match current meta");
    }
    atomicReplaceTextFile(outputPath, current.filter_keyword_candidates_json);
    return {
      status: "exported",
      runId: current.run_id,
      outputPath: path.resolve(outputPath),
    };
  } finally {
    db.close();
  }
}

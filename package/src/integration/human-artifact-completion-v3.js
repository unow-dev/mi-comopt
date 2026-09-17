import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { snapshotOutputDirectory } from "work-orchestrator";
import { parseAndValidateCommentBatchBytes } from "../collector/comment-batch/comment-batch-contract.js";
import { LABEL_SET } from "../three-class-workset/protocol.js";
import { validateHumanArtifactSubmissionResultSchema } from "../workflow/v3/contracts.js";
import { stateError } from "../state/errors.js";

const EXPECTED_FILES = Object.freeze({
  "00-receive-update-artifact": "comment-batch.json",
  "03b-receive-classification-response": "response.json",
  "07b-receive-keyword-proposal": "candidate_proposal.json",
});

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function validateClassificationResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\u001f") !== ["decisions", "workset_id"].join("\u001f")) throw stateError("ARTIFACT_INVALID", "response.json must contain exactly workset_id and decisions");
  if (typeof value.workset_id !== "string" || !value.workset_id) throw stateError("ARTIFACT_INVALID", "response.workset_id is required");
  if (!value.decisions || typeof value.decisions !== "object" || Array.isArray(value.decisions)) throw stateError("ARTIFACT_INVALID", "response.decisions must be an object");
  for (const [itemId, label] of Object.entries(value.decisions)) if (!/^I[1-9][0-9]*$/.test(itemId) || !LABEL_SET.has(label)) throw stateError("ARTIFACT_INVALID", "response decisions are invalid");
  return value;
}

function validateKeywordProposal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.actions)) throw stateError("ARTIFACT_INVALID", "candidate_proposal.json must contain an actions array");
  for (const action of value.actions) if (!action || typeof action !== "object" || typeof action.action !== "string") throw stateError("ARTIFACT_INVALID", "candidate proposal action is invalid");
  return value;
}

function validateBytes(stepId, bytes, customValidator) {
  if (typeof customValidator === "function") return customValidator(bytes);
  let value;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (error) { throw stateError("ARTIFACT_INVALID", `human artifact is not valid JSON: ${error.message}`); }
  if (stepId === "00-receive-update-artifact") return parseAndValidateCommentBatchBytes(bytes).payload;
  if (stepId === "03b-receive-classification-response") return validateClassificationResponse(value);
  if (stepId === "07b-receive-keyword-proposal") return validateKeywordProposal(value);
  throw stateError("ARTIFACT_INVALID", `unsupported human artifact step ${stepId}`);
}

/**
 * Validate before dispatching the Work Orchestrator completion command. This
 * keeps invalid output and stale execution output from creating a completion
 * receipt or any consumer business-state mutation.
 */
export async function completeValidatedHumanArtifact({ runtime, registry, artifactStore, sessionId, taskId, actor, executionId, outputDirectory, stepId, customValidator, commandId = `complete-human-artifact:${executionId}` } = {}) {
  if (!runtime || typeof runtime.completeHumanTaskWithInput !== "function") throw stateError("CONFIGURATION_ERROR", "Work Orchestrator runtime is required");
  const prior = registry?.getReceipt?.(sessionId, commandId);
  if (prior) return prior.response;
  const state = runtime.state?.(sessionId);
  const task = state?.tasks?.[taskId];
  const activeExecutionId = task?.currentExecutionId;
  if (!task || task.stepId !== stepId || !activeExecutionId || activeExecutionId !== executionId) throw stateError("STALE_EXECUTION", "artifact does not belong to the active Human Execution");
  const expectedLogicalPath = EXPECTED_FILES[stepId];
  if (!expectedLogicalPath) throw stateError("ARTIFACT_INVALID", `unsupported human artifact step ${stepId}`);
  const entries = readdirSync(outputDirectory, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== expectedLogicalPath || !entries[0].isFile()) throw stateError("ARTIFACT_CARDINALITY_INVALID", `output must contain exactly ${expectedLogicalPath}`);
  const outputPath = path.join(outputDirectory, expectedLogicalPath);
  const bytes = readFileSync(outputPath);
  validateBytes(stepId, bytes, customValidator);
  if (!artifactStore) throw stateError("CONFIGURATION_ERROR", "ArtifactStore is required");
  const artifacts = snapshotOutputDirectory(artifactStore, outputDirectory, executionId);
  if (artifacts.length !== 1) throw stateError("ARTIFACT_CARDINALITY_INVALID", "exactly one ArtifactVersion is required");
  const artifact = artifacts[0];
  const expectedHash = sha256(bytes);
  if (artifact.logicalPath !== expectedLogicalPath || artifact.origin?.kind !== "execution" || artifact.origin.executionId !== executionId || artifact.blobHash !== expectedHash || artifact.size !== bytes.length) throw stateError("ARTIFACT_IDENTITY_MISMATCH", "snapshotted ArtifactVersion does not match submitted bytes");
  const result = validateHumanArtifactSubmissionResultSchema({ executionId, artifact: { artifactVersionId: artifact.artifactVersionId, blobHash: artifact.blobHash, logicalPath: artifact.logicalPath, size: artifact.size } });
  return runtime.completeHumanTaskWithInput(sessionId, taskId, actor, { outcome: "submitted", result, artifactVersions: artifacts }, commandId);
}

export { EXPECTED_FILES, validateClassificationResponse, validateKeywordProposal };


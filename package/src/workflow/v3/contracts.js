import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { cloneJson } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

export const WORK_STEP_RESULT_V3_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "work-step-result-v3.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["stateResult", "refs"],
  properties: {
    stateResult: { type: "string", enum: ["succeeded", "committed", "unchanged", "created", "reused", "materialized", "already_materialized", "review_required", "rejected", "conflict", "blocked", "triggered", "already_deployed", "verified", "not_verified", "deployment_failed"] },
    refs: { type: "object", additionalProperties: false, properties: {
      evidenceIds: { type: "array", items: { type: "string", minLength: 1 } },
      snapshotRef: { type: "object", additionalProperties: false, required: ["payloadSha256", "snapshotIndex"], properties: { payloadSha256: { type: "string", pattern: "^[0-9a-f]{64}$" }, snapshotIndex: { type: ["integer", "string"] } } },
      assessmentId: { type: "string", minLength: 1 }, proposalId: { type: "string", minLength: 1 }, decisionId: { type: "string", minLength: 1 },
      corpusVersionId: { type: "string", minLength: 1 }, classificationVersionId: { type: "string", minLength: 1 }, keywordSelectionVersionId: { type: "string", minLength: 1 },
      worksetId: { type: "string", minLength: 1 }, candidateRequestId: { type: "string", minLength: 1 }, candidateInputFingerprint: { type: "string", minLength: 1 },
      releaseId: { type: "string", minLength: 1 }, promotionVersionId: { type: "string", minLength: 1 }, deploymentVersionId: { type: "string", minLength: 1 }, deploymentRequestId: { type: "string", minLength: 1 }, verificationRef: { type: "string", minLength: 1 },
    } },
    details: { type: "object" },
  },
});

export const SESSION_INPUT_V3_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object", additionalProperties: false, required: ["updateRequestId", "inputContract", "pinned", "target"],
  properties: {
    updateRequestId: { type: "string", minLength: 1 }, inputContract: { type: "object", additionalProperties: false, required: ["id", "version"], properties: { id: { const: "tiktokCommentBatch" }, version: { const: "1.0.0" } } },
    pinned: { type: "object", additionalProperties: false, required: ["initialCorpusVersionId", "classificationVersionId", "keywordSelectionVersionId", "corpusPolicyVersionId", "classificationPolicyVersionId", "keywordPolicyVersionId", "accountPolicyVersionId", "projectionDefinitionVersionId"], properties: {
      initialCorpusVersionId: { type: ["string", "null"], minLength: 1 }, classificationVersionId: { type: ["string", "null"], minLength: 1 }, keywordSelectionVersionId: { type: ["string", "null"], minLength: 1 },
      corpusPolicyVersionId: { type: "string", minLength: 1 }, classificationPolicyVersionId: { type: "string", minLength: 1 }, keywordPolicyVersionId: { type: "string", minLength: 1 }, accountPolicyVersionId: { type: "string", minLength: 1 }, projectionDefinitionVersionId: { type: "string", minLength: 1 },
    } },
    target: { type: "object", additionalProperties: false, required: ["promotionStream", "deploymentTarget"], properties: { promotionStream: { const: "production" }, deploymentTarget: { const: "production" } } },
  },
});

export const OUTCOME_V3_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema", oneOf: [
    { type: "object", additionalProperties: false, required: ["terminalStatus"], properties: { terminalStatus: { const: "deployed" } } },
    { type: "object", additionalProperties: false, required: ["terminalStatus", "stage"], properties: { terminalStatus: { const: "change_rejected" }, stage: { enum: ["classification", "keyword-selection"] } } },
    { type: "object", additionalProperties: false, required: ["terminalStatus"], properties: { terminalStatus: { const: "not_promoted" } } },
    { type: "object", additionalProperties: false, required: ["terminalStatus", "conflictAt"], properties: { terminalStatus: { const: "superseded" }, conflictAt: { enum: ["corpus", "classification", "keyword-selection", "promotion", "deployment"] } } },
    { type: "object", additionalProperties: false, required: ["terminalStatus"], properties: { terminalStatus: { const: "deployment_failed" } } },
  ],
});

export const HUMAN_ARTIFACT_SUBMISSION_RESULT_V1_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["executionId", "artifact"], properties: {
    executionId: { type: "string", minLength: 1 }, artifact: { type: "object", additionalProperties: false, required: ["artifactVersionId", "blobHash", "logicalPath", "size"], properties: { artifactVersionId: { type: "string", minLength: 1 }, blobHash: { type: "string", pattern: "^[0-9a-f]{64}$" }, logicalPath: { type: "string", minLength: 1 }, size: { type: "integer", minimum: 0 } } },
  },
});

const validateResult = ajv.compile(WORK_STEP_RESULT_V3_SCHEMA);
const validateSession = ajv.compile(SESSION_INPUT_V3_SCHEMA);
const validateOutcome = ajv.compile(OUTCOME_V3_SCHEMA);
const validateHumanArtifactResult = ajv.compile(HUMAN_ARTIFACT_SUBMISSION_RESULT_V1_SCHEMA);

function assertSchema(validate, value, code, label) {
  if (!validate(value)) throw stateError(code, `${label} does not satisfy its v3 schema`, { errors: cloneJson(validate.errors ?? []) });
  return cloneJson(value);
}

export function validateWorkStepResultSchema(result) { return assertSchema(validateResult, result, "WORK_STEP_RESULT_INVALID", "WorkStepResult"); }
export function validateCommentDataUpdateSessionInputSchema(input) { return assertSchema(validateSession, input, "SESSION_INPUT_INVALID", "Comment Data Update v3 Session input"); }
export function validateCommentDataUpdateOutcomeSchema(outcome) { return assertSchema(validateOutcome, outcome, "OUTCOME_INVALID", "Comment Data Update v3 outcome"); }
export function validateHumanArtifactSubmissionResultSchema(result) { return assertSchema(validateHumanArtifactResult, result, "HUMAN_ARTIFACT_RESULT_INVALID", "Human artifact submission result"); }

export { ajv };

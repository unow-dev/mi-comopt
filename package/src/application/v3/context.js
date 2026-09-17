import { canonicalJson, cloneJson, semanticSha256 } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";

function nonEmpty(value, name) {
  if (typeof value !== "string" || value.length === 0) throw stateError("VALIDATION_ERROR", `${name} must be a non-empty string`);
  return value;
}

/** Stable application identity for v3. Runtime attempt/reclaim metadata is
 * deliberately not part of this identity. */
export function operationIdForV3Task({ sessionId, stepId } = {}) {
  return `${nonEmpty(sessionId, "sessionId")}/${nonEmpty(stepId, "stepId")}`;
}

export function createV3OperationContext({ sessionId, workDefinitionId = "comment-data-update", workDefinitionRevision = 3, stepId, actor = { actorType: "system", actorId: "v3" }, permissions = [], input = undefined } = {}) {
  const operationId = operationIdForV3Task({ sessionId, stepId });
  return {
    sessionId: nonEmpty(sessionId, "sessionId"),
    workflowSessionId: nonEmpty(sessionId, "sessionId"),
    workDefinitionId: nonEmpty(workDefinitionId, "workDefinitionId"),
    workDefinitionRevision,
    stepId: nonEmpty(stepId, "stepId"),
    operationId,
    actor: cloneJson(actor),
    permissions: [...permissions],
    ...(input === undefined ? {} : { input: cloneJson(input) }),
  };
}

/** Project only stable business input before the request hash is calculated. */
export function stableServiceRequestDto(input, { omit = [], include = undefined } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw stateError("VALIDATION_ERROR", "service request must be an object");
  const omitted = new Set(["operationId", "executionId", "attempt", "attemptNo", "businessAttempt", "workflowRunId", "temporalRunId", "runtime", "transport", ...omit]);
  const keys = include ?? Object.keys(input);
  return Object.fromEntries(keys.filter((key) => !omitted.has(key) && input[key] !== undefined).sort().map((key) => [key, cloneJson(input[key])]));
}

export function serviceRequestHashV3(input, options = {}) {
  return semanticSha256(stableServiceRequestDto(input, options));
}

export function runV3Idempotent(controlPlane, context, operationKind, request, mutation) {
  if (!controlPlane || typeof controlPlane.runIdempotent !== "function") throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const dto = stableServiceRequestDto(request);
  const operationId = operationIdForV3Task(context);
  const requestSha256 = semanticSha256(dto);
  const prior = controlPlane.readReceipt(operationId);
  if (prior) {
    if (prior.operationKind !== operationKind || prior.requestSha256 !== requestSha256) throw stateError("IDEMPOTENCY_CONFLICT", `operation ${operationId} was already completed with a different request`);
    return cloneJson(prior.result);
  }
  // The service may itself create proposals/decisions, each with a short
  // transaction.  Keep the outer application receipt separate so no nested
  // SQLite transaction is opened around external calls or state mutations.
  const result = mutation(dto);
  controlPlane._transaction((db) => {
    const concurrent = controlPlane.readReceipt(operationId);
    if (concurrent) {
      if (concurrent.operationKind !== operationKind || concurrent.requestSha256 !== requestSha256) throw stateError("IDEMPOTENCY_CONFLICT", `operation ${operationId} was already completed with a different request`);
      return concurrent.result;
    }
    db.prepare("INSERT INTO application_operation_receipts (operation_id, operation_kind, request_sha256, result_json, completed_at) VALUES (?, ?, ?, ?, ?)").run(operationId, operationKind, requestSha256, canonicalJson(result), controlPlane.now());
    return result;
  });
  return cloneJson(result);
}

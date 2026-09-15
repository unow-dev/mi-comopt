import { stateError } from "../state/errors.js";

export const COMMENT_DATA_UPDATE_STATUSES = Object.freeze(["deployed", "change_rejected", "not_promoted", "superseded", "deployment_failed", "cancelled"]);

const ROUTING_BY_STATE_RESULT = Object.freeze({
  review_required: "review_required",
  rejected: "rejected",
  superseded: "superseded",
  triggered: "wait",
  already_deployed: "verify",
  deployment_failed: "deployment_failed",
  not_verified: "rejected",
  conflict: "superseded",
});

export function routingOutcome(result) {
  if (!result || typeof result !== "object") throw stateError("WORK_STEP_RESULT_INVALID", "a work step result is required");
  const outcome = ROUTING_BY_STATE_RESULT[result.stateResult] ?? "continue";
  if (!["continue", "review_required", "rejected", "superseded", "wait", "verify", "deployment_failed", "blocked"].includes(outcome)) throw stateError("OUTCOME_INVALID", `unsupported routing outcome: ${outcome}`);
  return outcome;
}

export function projectCommentDataUpdateOutcome({ terminalStatus, releaseId, stage, conflictAt, deploymentRequestId, changed = false } = {}) {
  if (terminalStatus === "deployed") return commentDataUpdateOutcome({ status: "deployed", releaseId, changed });
  if (terminalStatus === "change_rejected") return commentDataUpdateOutcome({ status: "change_rejected", stage });
  if (terminalStatus === "not_promoted") return commentDataUpdateOutcome({ status: "not_promoted", releaseId });
  if (terminalStatus === "superseded") return commentDataUpdateOutcome({ status: "superseded", conflictAt });
  if (terminalStatus === "deployment_failed") return commentDataUpdateOutcome({ status: "deployment_failed", releaseId, deploymentRequestId });
  if (terminalStatus === "cancelled") return commentDataUpdateOutcome({ status: "cancelled" });
  throw stateError("OUTCOME_INVALID", `unsupported terminal status: ${terminalStatus}`);
}

function firstStepResult(results, prefix) {
  const entry = Object.entries(results ?? {}).find(([stepId, result]) => stepId === prefix || stepId.startsWith(`${prefix}-`));
  return entry?.[1] && typeof entry[1] === "object" && !Array.isArray(entry[1]) ? entry[1] : undefined;
}

export function projectCompletedSessionOutcome(sessionView) {
  if (!sessionView?.session || !["completed", "cancelled"].includes(sessionView.session.state)) throw stateError("OUTCOME_INVALID", "a completed Session view is required");
  const results = sessionView.resultsByStepId;
  const marker = Object.values(results ?? {}).find((result) => result && typeof result === "object" && !Array.isArray(result) && typeof result.terminalStatus === "string");
  if (!marker) return sessionView.session.state === "cancelled" ? { status: "cancelled" } : null;
  const record = firstStepResult(results, "20-record-deployment-state");
  const trigger = firstStepResult(results, "16-trigger-deployment");
  const promotion = firstStepResult(results, "14-finalize-production-promotion") ?? firstStepResult(results, "13-propose-production-promotion");
  const releaseId = marker.releaseId ?? record?.refs?.releaseId ?? trigger?.refs?.releaseId ?? promotion?.refs?.releaseId;
  return projectCommentDataUpdateOutcome({ terminalStatus: marker.terminalStatus, releaseId, stage: marker.stage, conflictAt: marker.conflictAt, deploymentRequestId: marker.deploymentRequestId ?? trigger?.refs?.deploymentRequestId, changed: record?.stateResult === "committed" });
}

export function commentDataUpdateOutcome({ status, stage = undefined, releaseId = undefined, changed = undefined, conflictAt = undefined, deploymentRequestId = undefined } = {}) {
  if (!COMMENT_DATA_UPDATE_STATUSES.includes(status)) throw stateError("OUTCOME_INVALID", `unsupported comment-data-update status: ${status}`);
  if (status === "deployed") {
    if (typeof releaseId !== "string") throw stateError("OUTCOME_INVALID", "deployed outcome requires releaseId");
    return { status, releaseId, changed: Boolean(changed) };
  }
  if (status === "change_rejected") {
    if (!["classification", "keyword-selection"].includes(stage)) throw stateError("OUTCOME_INVALID", "change_rejected outcome requires a classification or keyword-selection stage");
    return { status, stage };
  }
  if (status === "not_promoted") {
    if (typeof releaseId !== "string") throw stateError("OUTCOME_INVALID", "not_promoted outcome requires releaseId");
    return { status, releaseId };
  }
  if (status === "superseded") {
    if (!["corpus", "classification", "keyword-selection", "promotion", "deployment"].includes(conflictAt)) throw stateError("OUTCOME_INVALID", "superseded outcome requires conflictAt");
    return { status, conflictAt };
  }
  if (status === "deployment_failed") {
    if (typeof releaseId !== "string" || releaseId.length === 0) throw stateError("OUTCOME_INVALID", "deployment_failed outcome requires a non-empty releaseId");
    return { status, releaseId, ...(deploymentRequestId ? { deploymentRequestId } : {}) };
  }
  return { status };
}

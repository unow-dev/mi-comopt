import { stateError } from "../state/errors.js";

export const COMMENT_DATA_UPDATE_STATUSES = Object.freeze(["deployed", "change_rejected", "not_promoted", "superseded", "deployment_failed", "cancelled"]);

export function routingOutcome(result) {
  if (!result || typeof result !== "object") throw stateError("WORK_STEP_RESULT_INVALID", "a work step result is required");
  if (result.details?.outcome) return result.details.outcome;
  if (["review_required", "rejected", "blocked", "superseded"].includes(result.stateResult)) return result.stateResult;
  if (result.stateResult === "triggered") return "wait";
  if (result.stateResult === "already_deployed") return "verify";
  return "continue";
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
  if (status === "deployment_failed") return { status, releaseId, ...(deploymentRequestId ? { deploymentRequestId } : {}) };
  return { status };
}

import { stateError } from "../../state/errors.js";
import { validateWorkStepResultSchema } from "./contracts.js";

const cases = {
  "01-ingest-evidence": [["continue", ["succeeded"], ["evidenceIds", "snapshotRef"]]],
  "02-update-corpus": [["continue", ["committed"], ["corpusVersionId", "proposalId", "decisionId"]], ["continue", ["unchanged"], ["corpusVersionId"]], ["superseded", ["conflict"], []]],
  "03a-prepare-classification-handoff": [["reuse", ["reused"], ["classificationVersionId"]], ["ready_without_handoff", ["succeeded"], []], ["handoff_required", ["created"], ["worksetId"]], ["superseded", ["conflict"], []]],
  "03-update-classification": [["continue", ["unchanged"], ["assessmentId", "classificationVersionId"]], ["continue", ["committed"], ["assessmentId", "proposalId", "decisionId", "classificationVersionId"]], ["review_required", ["review_required"], ["assessmentId", "proposalId"]], ["superseded", ["conflict"], []]],
  "06-finalize-classification": [["continue", ["reused"], ["classificationVersionId"]], ["continue", ["committed"], ["classificationVersionId", "proposalId", "decisionId"]], ["rejected", ["rejected"], ["proposalId", "decisionId"]], ["superseded", ["conflict"], []], ["superseded", ["conflict"], ["proposalId", "decisionId"]]],
  "07a-prepare-keyword-handoff": [["reuse", ["reused"], ["keywordSelectionVersionId"]], ["handoff_required", ["created"], ["candidateRequestId", "candidateInputFingerprint"]], ["superseded", ["conflict"], []]],
  "07-update-keyword-selection": [["continue", ["unchanged"], ["assessmentId", "keywordSelectionVersionId"]], ["continue", ["committed"], ["assessmentId", "proposalId", "decisionId", "keywordSelectionVersionId"]], ["review_required", ["review_required"], ["assessmentId", "proposalId"]], ["superseded", ["conflict"], []]],
  "10-finalize-keyword-selection": [["continue", ["reused"], ["keywordSelectionVersionId"]], ["continue", ["committed"], ["keywordSelectionVersionId", "proposalId", "decisionId"]], ["rejected", ["rejected"], ["proposalId", "decisionId"]], ["superseded", ["conflict"], []], ["superseded", ["conflict"], ["proposalId", "decisionId"]]],
  "11-build-release-bundle": [["continue", ["created", "reused"], ["releaseId"]]],
  "12-materialize-release": [["continue", ["materialized", "already_materialized"], ["releaseId"]]],
  "13-propose-production-promotion": [["continue", ["created"], ["proposalId", "releaseId"]]],
  "14-finalize-production-promotion": [["continue", ["committed", "reused"], ["proposalId", "decisionId", "promotionVersionId", "releaseId"]], ["rejected", ["rejected"], ["proposalId", "decisionId", "releaseId"]], ["superseded", ["conflict"], ["proposalId", "decisionId", "releaseId"]]],
  "16-trigger-deployment": [["wait", ["triggered"], ["deploymentRequestId", "releaseId", "promotionVersionId"]], ["verify", ["already_deployed"], ["deploymentRequestId", "releaseId", "promotionVersionId"]], ["superseded", ["conflict"], ["releaseId", "promotionVersionId"]], ["deployment_failed", ["deployment_failed"], ["deploymentRequestId", "releaseId", "promotionVersionId"]]],
  "19-verify-deployment": [["continue", ["verified"], ["verificationRef", "deploymentRequestId", "releaseId", "promotionVersionId"]], ["superseded", ["conflict"], ["deploymentRequestId", "releaseId", "promotionVersionId"]], ["deployment_failed", ["not_verified"], ["verificationRef", "deploymentRequestId", "releaseId", "promotionVersionId"]], ["deployment_failed", ["deployment_failed"], ["deploymentRequestId", "releaseId", "promotionVersionId"]]],
  "20-record-deployment-state": [["continue", ["committed", "reused"], ["deploymentVersionId", "deploymentRequestId", "releaseId"]], ["superseded", ["conflict"], ["deploymentRequestId", "releaseId"]]],
};

function exactKeys(result) { return Object.keys(result.refs ?? {}).sort(); }

export function validateV3WorkStepResult({ stepId, routingOutcome, result } = {}) {
  if (typeof stepId !== "string" || typeof routingOutcome !== "string") throw stateError("WORK_STEP_RESULT_INVALID", "stepId and routingOutcome are required");
  const validated = validateWorkStepResultSchema(result);
  const matched = (cases[stepId] ?? []).find(([route, states, refs]) => route === routingOutcome && states.includes(validated.stateResult) && JSON.stringify(refs.slice().sort()) === JSON.stringify(exactKeys(validated)));
  if (!matched) throw stateError("WORK_STEP_RESULT_INVALID", `step ${stepId} has an invalid routing/state/ref combination`, { stepId, routingOutcome, stateResult: validated.stateResult, refKeys: exactKeys(validated) });
  return validated;
}

export function workStepResultRuleTable() { return cases; }

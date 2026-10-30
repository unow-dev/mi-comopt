import { stateError } from "../../state/errors.js";
import { validateWorkStepResultSchema } from "./contracts.js";

const cases = {
  "01-ingest-evidence": [["continue", ["succeeded"], ["evidenceIds", "snapshotRef"]]],
  "02-update-corpus": [["continue", ["committed"], ["corpusVersionId", "proposalId", "decisionId"]], ["continue", ["unchanged"], ["corpusVersionId"]], ["superseded", ["conflict"], []]],
  "03a-prepare-classification-handoff": [["reuse", ["reused"], ["classificationVersionId"]], ["ready_without_handoff", ["succeeded"], []], ["handoff_required", ["created"], ["worksetId"]], ["superseded", ["conflict"], []]],
  "03-update-classification": [["continue", ["unchanged"], ["assessmentId", "classificationVersionId"]], ["continue", ["committed"], ["assessmentId", "proposalId", "decisionId", "classificationVersionId"]], ["review_required", ["review_required"], ["assessmentId", "proposalId"]], ["superseded", ["conflict"], []]],
  "03-correction-propose": [["review_required", ["review_required"], ["assessmentId", "proposalId"]], ["superseded", ["conflict"], []]],
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

for (const branchId of ["07-accepted-without-review", "07-reviewed"]) {
  cases[`10-finalize-keyword-selection-${branchId}`] = [
    ["continue", ["reused"], ["keywordSelectionVersionId"]],
    ["continue", ["committed"], ["keywordSelectionVersionId", "proposalId", "decisionId"]],
    ["rejected", ["rejected"], ["proposalId", "decisionId"]],
    ["superseded", ["conflict"], []],
    ["superseded", ["conflict"], ["proposalId", "decisionId"]],
  ];
}

for (const suffix of ["reuse", "07-accepted-without-review", "07-reviewed"]) {
  cases[`11-build-release-bundle-${suffix}`] = [["continue", ["created", "reused"], ["releaseId"]]];
  cases[`12-materialize-release-${suffix}`] = [["continue", ["materialized", "already_materialized"], ["releaseId"]]];
  cases[`13-propose-production-promotion-${suffix}`] = [["continue", ["created"], ["proposalId", "releaseId"]]];
  cases[`14-finalize-production-promotion-${suffix}`] = [
    ["continue", ["committed", "reused"], ["proposalId", "decisionId", "promotionVersionId", "releaseId"]],
    ["rejected", ["rejected"], ["proposalId", "decisionId", "releaseId"]],
    ["superseded", ["conflict"], ["proposalId", "decisionId", "releaseId"]],
  ];
  cases[`16-trigger-deployment-${suffix}`] = [
    ["wait", ["triggered"], ["deploymentRequestId", "releaseId", "promotionVersionId"]],
    ["verify", ["already_deployed"], ["deploymentRequestId", "releaseId", "promotionVersionId"]],
    ["superseded", ["conflict"], ["releaseId", "promotionVersionId"]],
    ["deployment_failed", ["deployment_failed"], ["deploymentRequestId", "releaseId", "promotionVersionId"]],
  ];
  for (const deploymentBranch of ["after-wait", "already-serving"]) {
    const verifyId = `19-verify-deployment-${deploymentBranch}-${suffix}`;
    const recordId = `20-record-deployment-state-${deploymentBranch}-${suffix}`;
    cases[verifyId] = [
      ["continue", ["verified"], ["verificationRef", "deploymentRequestId", "releaseId", "promotionVersionId"]],
      ["superseded", ["conflict"], ["deploymentRequestId", "releaseId", "promotionVersionId"]],
      ["deployment_failed", ["not_verified"], ["verificationRef", "deploymentRequestId", "releaseId", "promotionVersionId"]],
      ["deployment_failed", ["deployment_failed"], ["deploymentRequestId", "releaseId", "promotionVersionId"]],
    ];
    cases[recordId] = [
      ["continue", ["committed", "reused"], ["deploymentVersionId", "deploymentRequestId", "releaseId"]],
      ["superseded", ["conflict"], ["deploymentRequestId", "releaseId"]],
    ];
  }
}

for (const stepId of ["01-validate-correction-batch", "02-resolve-correction-batch", "03-propose-correction-batch"]) {
  cases[stepId] = [[stepId.startsWith("03") ? "review_required" : "continue", [stepId.startsWith("03") ? "review_required" : "succeeded"], stepId.startsWith("03") ? ["assessmentId", "proposalId"] : []], ["invalid", ["blocked"], []], ["superseded", ["conflict"], []]];
}
cases["06-finalize-correction-batch"] = [["continue", ["committed", "reused"], ["classificationVersionId", "proposalId", "decisionId"]], ["rejected", ["rejected"], ["proposalId", "decisionId"]], ["superseded", ["conflict"], []]];

function exactKeys(result) { return Object.keys(result.refs ?? {}).sort(); }

function dynamicRules(stepId) {
  if (/^03-update-classification-.+$/.test(stepId)) return cases["03-update-classification"];
  if (/^06-finalize-classification-.+$/.test(stepId)) return cases["06-finalize-classification"];
  if (/^07a-prepare-keyword-handoff-.+$/.test(stepId)) return cases["07a-prepare-keyword-handoff"];
  if (/^07-update-keyword-selection-.+$/.test(stepId)) return cases["07-update-keyword-selection"];
  if (/^10-finalize-keyword-selection-.+$/.test(stepId)) return cases["10-finalize-keyword-selection"];
  if (/^11-build-release-bundle-.+$/.test(stepId)) return cases["11-build-release-bundle"];
  if (/^12-materialize-release-.+$/.test(stepId)) return cases["12-materialize-release"];
  if (/^13-propose-production-promotion-.+$/.test(stepId)) return cases["13-propose-production-promotion"];
  if (/^14-finalize-production-promotion-.+$/.test(stepId)) return cases["14-finalize-production-promotion"];
  if (/^16-trigger-deployment-.+$/.test(stepId)) return cases["16-trigger-deployment"];
  if (/^19-verify-deployment-(?:after-wait|already-serving)-.+$/.test(stepId)) return cases["19-verify-deployment"];
  if (/^20-record-deployment-state-(?:after-wait|already-serving)-.+$/.test(stepId)) return cases["20-record-deployment-state"];
  return undefined;
}

export function validateV3WorkStepResult({ stepId, routingOutcome, result } = {}) {
  if (typeof stepId !== "string" || typeof routingOutcome !== "string") throw stateError("WORK_STEP_RESULT_INVALID", "stepId and routingOutcome are required");
  const validated = validateWorkStepResultSchema(result);
  const matched = (cases[stepId] ?? dynamicRules(stepId) ?? []).find(([route, states, refs]) => route === routingOutcome && states.includes(validated.stateResult) && JSON.stringify(refs.slice().sort()) === JSON.stringify(exactKeys(validated)));
  if (!matched) throw stateError("WORK_STEP_RESULT_INVALID", `step ${stepId} has an invalid routing/state/ref combination`, { stepId, routingOutcome, stateResult: validated.stateResult, refKeys: exactKeys(validated) });
  if (/^(?:01-validate|02-resolve|03-propose|06-finalize)-correction-batch$/.test(stepId)) {
    const details = validated.details ?? {};
    const sha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
    let valid = true;
    if (validated.stateResult === "blocked") valid = details.reason === "invalid_request" && Array.isArray(details.violations) && details.violations.length > 0;
    if (validated.stateResult === "conflict") valid = ["classification", "corpus", "policy"].includes(details.conflictAt);
    if (stepId === "01-validate-correction-batch" && validated.stateResult === "succeeded") valid = sha(details.requestFingerprint);
    if (stepId === "02-resolve-correction-batch" && validated.stateResult === "succeeded") valid = sha(details.requestFingerprint) && sha(details.changeSetHash) && typeof details.changeSetId === "string" && details.changeSetId.length > 0 && Number.isSafeInteger(details.groupCount) && details.groupCount > 0 && Number.isSafeInteger(details.observationCount) && details.observationCount >= details.groupCount;
    if (stepId === "03-propose-correction-batch" && validated.stateResult === "review_required") valid = sha(details.changeSetHash);
    if (!valid) throw stateError("WORK_STEP_RESULT_INVALID", `step ${stepId} has missing or invalid batch details`);
  }
  return validated;
}

export function workStepResultRuleTable() {
  return new Proxy(cases, { get(target, property, receiver) {
    if (typeof property !== "string") return Reflect.get(target, property, receiver);
    return Reflect.get(target, property, receiver) ?? dynamicRules(property);
  } });
}

import { cloneJson } from "../../state/canonical.js";
import { validateV3WorkStepResult } from "../../workflow/v3/result-rules.js";

export function v3StepResult({ stepId, routingOutcome, stateResult, refs = {}, details = undefined } = {}) {
  const result = { stateResult, refs: Object.fromEntries(Object.entries(refs).filter(([, value]) => value !== undefined)) };
  if (details !== undefined) result.details = cloneJson(details);
  return validateV3WorkStepResult({ stepId, routingOutcome, result });
}

export { validateV3WorkStepResult };


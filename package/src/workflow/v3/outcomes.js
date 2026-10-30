import { stateError } from "../../state/errors.js";
import { validateClassificationCorrectionBatchOutcomeSchema, validateCommentDataUpdateOutcomeSchema } from "./contracts.js";

export function commentDataUpdateOutcomeV3({ terminalStatus, stage, conflictAt } = {}) {
  const value = { terminalStatus, ...(stage === undefined ? {} : { stage }), ...(conflictAt === undefined ? {} : { conflictAt }) };
  return validateCommentDataUpdateOutcomeSchema(value);
}

export function terminalOutcomeFromV3Step(result) {
  if (!result || typeof result !== "object" || typeof result.terminalStatus !== "string") return null;
  return result.terminalStatus === "invalid_request" || result.conflictAt === "policy" ? validateClassificationCorrectionBatchOutcomeSchema(result) : commentDataUpdateOutcomeV3(result);
}

export { validateCommentDataUpdateOutcomeSchema };

export { validateClassificationCorrectionBatchOutcomeSchema };

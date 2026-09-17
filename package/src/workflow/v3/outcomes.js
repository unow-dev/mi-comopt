import { stateError } from "../../state/errors.js";
import { validateCommentDataUpdateOutcomeSchema } from "./contracts.js";

export function commentDataUpdateOutcomeV3({ terminalStatus, stage, conflictAt } = {}) {
  const value = { terminalStatus, ...(stage === undefined ? {} : { stage }), ...(conflictAt === undefined ? {} : { conflictAt }) };
  return validateCommentDataUpdateOutcomeSchema(value);
}

export function terminalOutcomeFromV3Step(result) {
  if (!result || typeof result !== "object" || typeof result.terminalStatus !== "string") return null;
  return commentDataUpdateOutcomeV3(result);
}

export { validateCommentDataUpdateOutcomeSchema };

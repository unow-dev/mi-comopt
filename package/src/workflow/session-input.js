import { canonicalJson, cloneJson, semanticSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";
import { STREAM_KEYS } from "../application/services.js";

function exactObject(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw stateError("SESSION_INPUT_INVALID", `${context} has unexpected fields`);
}

export function validateCommentDataUpdateSessionInput(input) {
  exactObject(input, ["updateRequestId", "evidenceSource", "pinned", "target"], "session input");
  if (typeof input.updateRequestId !== "string" || input.updateRequestId.length === 0) throw stateError("SESSION_INPUT_INVALID", "updateRequestId is required");
  exactObject(input.evidenceSource, ["kind", "sourceRef"], "evidenceSource");
  if (typeof input.evidenceSource.kind !== "string" || typeof input.evidenceSource.sourceRef !== "string" || input.evidenceSource.kind.length === 0 || input.evidenceSource.sourceRef.length === 0) throw stateError("SESSION_INPUT_INVALID", "evidenceSource is invalid");
  exactObject(input.pinned, ["initialCorpusVersionId", "classificationVersionId", "keywordSelectionVersionId", "classificationPolicyVersionId", "keywordPolicyVersionId", "accountPolicyVersionId", "projectionDefinitionVersionId"], "pinned");
  for (const key of ["classificationPolicyVersionId", "keywordPolicyVersionId", "accountPolicyVersionId", "projectionDefinitionVersionId"]) if (typeof input.pinned[key] !== "string" || input.pinned[key].length === 0) throw stateError("SESSION_INPUT_INVALID", `${key} is required`);
  for (const key of ["initialCorpusVersionId", "classificationVersionId", "keywordSelectionVersionId"]) if (input.pinned[key] !== null && typeof input.pinned[key] !== "string") throw stateError("SESSION_INPUT_INVALID", `${key} must be a version ID or null`);
  exactObject(input.target, ["promotionStream", "deploymentTarget"], "target");
  if (input.target.promotionStream !== "production" || input.target.deploymentTarget !== "production") throw stateError("SESSION_INPUT_INVALID", "only production target is supported");
  return cloneJson(input);
}

function pinnedHead(controlPlane, stream, supplied, name) {
  if (supplied !== undefined) return supplied;
  return controlPlane.resolveHead(stream)?.versionId ?? null;
}

export function resolvePinnedSessionInput(controlPlane, { updateRequestId, evidenceSource, target = { promotionStream: "production", deploymentTarget: "production" }, pinned = {} } = {}) {
  const values = {
    updateRequestId, evidenceSource,
    pinned: {
      initialCorpusVersionId: pinned.initialCorpusVersionId !== undefined ? pinned.initialCorpusVersionId : pinnedHead(controlPlane, STREAM_KEYS.corpus, undefined, "initialCorpusVersionId"),
      classificationVersionId: pinned.classificationVersionId !== undefined ? pinned.classificationVersionId : pinnedHead(controlPlane, STREAM_KEYS.classification, undefined, "classificationVersionId"),
      keywordSelectionVersionId: pinned.keywordSelectionVersionId !== undefined ? pinned.keywordSelectionVersionId : pinnedHead(controlPlane, STREAM_KEYS.keywordSelection, undefined, "keywordSelectionVersionId"),
      classificationPolicyVersionId: pinned.classificationPolicyVersionId ?? controlPlane.resolveHead(STREAM_KEYS.classificationPolicy)?.versionId,
      keywordPolicyVersionId: pinned.keywordPolicyVersionId ?? controlPlane.resolveHead(STREAM_KEYS.keywordPolicy)?.versionId,
      accountPolicyVersionId: pinned.accountPolicyVersionId ?? controlPlane.resolveHead(STREAM_KEYS.accountPolicy)?.versionId,
      projectionDefinitionVersionId: pinned.projectionDefinitionVersionId ?? controlPlane.resolveHead(STREAM_KEYS.projectionDefinition)?.versionId,
    },
    target,
  };
  return validateCommentDataUpdateSessionInput(values);
}

export function sessionInputFingerprint(input) { return semanticSha256(validateCommentDataUpdateSessionInput(input)); }

export function propagatePinnedInput(sessionInput, stepResult) {
  const validated = validateCommentDataUpdateSessionInput(sessionInput);
  return { ...cloneJson(stepResult), pinned: cloneJson(validated.pinned), inputFingerprint: sessionInputFingerprint(validated) };
}

export { canonicalJson };

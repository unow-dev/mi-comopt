import { canonicalJson, cloneJson, semanticSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";
import { STREAM_KEYS, readExactPolicyVersion } from "../application/services.js";

function exactObject(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw stateError("SESSION_INPUT_INVALID", `${context} has unexpected fields`);
}

export function validateCommentDataUpdateSessionInput(input) {
  exactObject(input, ["updateRequestId", "evidenceSource", "pinned", "target"], "session input");
  if (typeof input.updateRequestId !== "string" || input.updateRequestId.length === 0) throw stateError("SESSION_INPUT_INVALID", "updateRequestId is required");
  exactObject(input.evidenceSource, ["kind", "sourceRef"], "evidenceSource");
  if (typeof input.evidenceSource.kind !== "string" || typeof input.evidenceSource.sourceRef !== "string" || input.evidenceSource.kind.length === 0 || input.evidenceSource.sourceRef.length === 0) throw stateError("SESSION_INPUT_INVALID", "evidenceSource is invalid");
  exactObject(input.pinned, ["initialCorpusVersionId", "classificationVersionId", "keywordSelectionVersionId", "corpusPolicyVersionId", "classificationPolicyVersionId", "keywordPolicyVersionId", "accountPolicyVersionId", "projectionDefinitionVersionId"], "pinned");
  for (const key of ["corpusPolicyVersionId", "classificationPolicyVersionId", "keywordPolicyVersionId", "accountPolicyVersionId", "projectionDefinitionVersionId"]) if (typeof input.pinned[key] !== "string" || input.pinned[key].length === 0) throw stateError("SESSION_INPUT_INVALID", `${key} is required`);
  for (const key of ["initialCorpusVersionId", "classificationVersionId", "keywordSelectionVersionId"]) if (input.pinned[key] !== null && typeof input.pinned[key] !== "string") throw stateError("SESSION_INPUT_INVALID", `${key} must be a version ID or null`);
  exactObject(input.target, ["promotionStream", "deploymentTarget"], "target");
  if (input.target.promotionStream !== "production" || input.target.deploymentTarget !== "production") throw stateError("SESSION_INPUT_INVALID", "only production target is supported");
  return cloneJson(input);
}

function pinnedHead(controlPlane, stream, supplied, name) {
  if (supplied !== undefined) return supplied;
  return controlPlane.resolveHead(stream)?.versionId ?? null;
}

function exactVersion(controlPlane, versionId, stream, name) {
  if (versionId === null) return null;
  if (typeof versionId !== "string" || versionId.length === 0) throw stateError("SESSION_INPUT_INVALID", `${name} must be a version ID or null`);
  const version = controlPlane.readVersion(versionId);
  if (!version || version.domain !== stream.domain || version.streamKey !== stream.streamKey) throw stateError("SESSION_INPUT_INVALID", `${name} references the wrong state stream`);
  return version.versionId;
}

export function resolvePinnedSessionInput(controlPlane, { updateRequestId, evidenceSource, target = { promotionStream: "production", deploymentTarget: "production" }, pinned = {} } = {}) {
  const values = {
    updateRequestId, evidenceSource,
    pinned: {
      initialCorpusVersionId: pinned.initialCorpusVersionId !== undefined ? pinned.initialCorpusVersionId : pinnedHead(controlPlane, STREAM_KEYS.corpus, undefined, "initialCorpusVersionId"),
      classificationVersionId: pinned.classificationVersionId !== undefined ? pinned.classificationVersionId : pinnedHead(controlPlane, STREAM_KEYS.classification, undefined, "classificationVersionId"),
      keywordSelectionVersionId: pinned.keywordSelectionVersionId !== undefined ? pinned.keywordSelectionVersionId : pinnedHead(controlPlane, STREAM_KEYS.keywordSelection, undefined, "keywordSelectionVersionId"),
      corpusPolicyVersionId: pinned.corpusPolicyVersionId ?? pinnedHead(controlPlane, STREAM_KEYS.corpusPolicy, undefined, "corpusPolicyVersionId"),
      classificationPolicyVersionId: pinned.classificationPolicyVersionId ?? controlPlane.resolveHead(STREAM_KEYS.classificationPolicy)?.versionId,
      keywordPolicyVersionId: pinned.keywordPolicyVersionId ?? controlPlane.resolveHead(STREAM_KEYS.keywordPolicy)?.versionId,
      accountPolicyVersionId: pinned.accountPolicyVersionId ?? controlPlane.resolveHead(STREAM_KEYS.accountPolicy)?.versionId,
      projectionDefinitionVersionId: pinned.projectionDefinitionVersionId ?? controlPlane.resolveHead(STREAM_KEYS.projectionDefinition)?.versionId,
    },
    target,
  };
  const validated = validateCommentDataUpdateSessionInput(values);
  const exactPinned = {
    ...validated.pinned,
    initialCorpusVersionId: exactVersion(controlPlane, validated.pinned.initialCorpusVersionId, STREAM_KEYS.corpus, "initialCorpusVersionId"),
    classificationVersionId: exactVersion(controlPlane, validated.pinned.classificationVersionId, STREAM_KEYS.classification, "classificationVersionId"),
    keywordSelectionVersionId: exactVersion(controlPlane, validated.pinned.keywordSelectionVersionId, STREAM_KEYS.keywordSelection, "keywordSelectionVersionId"),
    projectionDefinitionVersionId: exactVersion(controlPlane, validated.pinned.projectionDefinitionVersionId, STREAM_KEYS.projectionDefinition, "projectionDefinitionVersionId"),
    corpusPolicyVersionId: readExactPolicyVersion(controlPlane, validated.pinned.corpusPolicyVersionId, "corpus").versionId,
    classificationPolicyVersionId: readExactPolicyVersion(controlPlane, validated.pinned.classificationPolicyVersionId, "classification").versionId,
    keywordPolicyVersionId: readExactPolicyVersion(controlPlane, validated.pinned.keywordPolicyVersionId, "keyword-selection").versionId,
    accountPolicyVersionId: readExactPolicyVersion(controlPlane, validated.pinned.accountPolicyVersionId, "account-candidate").versionId,
  };
  return validateCommentDataUpdateSessionInput({ ...validated, pinned: exactPinned });
}

export function sessionInputFingerprint(input) { return semanticSha256(validateCommentDataUpdateSessionInput(input)); }

export function propagatePinnedInput(sessionInput, stepResult) {
  const validated = validateCommentDataUpdateSessionInput(sessionInput);
  return { ...cloneJson(stepResult), pinned: cloneJson(validated.pinned), inputFingerprint: sessionInputFingerprint(validated) };
}

export function validateDeployPromotedReleaseSessionInput(input) {
  exactObject(input, ["promotionVersionId", "releaseId", "target"], "deployment recovery session input");
  for (const key of ["promotionVersionId", "releaseId"]) if (typeof input[key] !== "string" || input[key].length === 0) throw stateError("SESSION_INPUT_INVALID", `${key} is required`);
  exactObject(input.target, ["deploymentTarget"], "deployment recovery target");
  if (input.target.deploymentTarget !== "production") throw stateError("SESSION_INPUT_INVALID", "only production deployment is supported");
  return cloneJson(input);
}

export function resolveDeployPromotedReleaseSessionInput(controlPlane, { target = { deploymentTarget: "production" } } = {}) {
  const promotion = controlPlane.resolveHead(STREAM_KEYS.promotion);
  if (!promotion || promotion.payload?.state?.target !== "production" || typeof promotion.payload?.state?.releaseId !== "string") throw stateError("PROMOTION_NOT_FOUND", "a current production Promotion head is required for deployment recovery");
  return validateDeployPromotedReleaseSessionInput({ promotionVersionId: promotion.versionId, releaseId: promotion.payload.state.releaseId, target });
}

export { canonicalJson };

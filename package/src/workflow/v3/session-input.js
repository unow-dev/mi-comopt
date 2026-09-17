import { cloneJson, semanticSha256 } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";
import { STREAM_KEYS, readExactPolicyVersion } from "../../application/services.js";
import { validateCommentDataUpdateSessionInputSchema } from "./contracts.js";

const VERSION_FIELDS = Object.freeze([
  ["initialCorpusVersionId", STREAM_KEYS.corpus], ["classificationVersionId", STREAM_KEYS.classification], ["keywordSelectionVersionId", STREAM_KEYS.keywordSelection],
  ["projectionDefinitionVersionId", STREAM_KEYS.projectionDefinition],
]);
const POLICY_FIELDS = Object.freeze([
  ["corpusPolicyVersionId", "corpus"], ["classificationPolicyVersionId", "classification"], ["keywordPolicyVersionId", "keyword-selection"], ["accountPolicyVersionId", "account-candidate"],
]);

function exactVersion(controlPlane, versionId, stream, name) {
  if (versionId === null) return null;
  if (typeof versionId !== "string" || versionId.length === 0) throw stateError("SESSION_INPUT_INVALID", `${name} must be a non-empty Version ID or null`);
  const version = controlPlane.readVersion(versionId);
  if (!version || version.domain !== stream.domain || version.streamKey !== stream.streamKey) throw stateError("SESSION_INPUT_INVALID", `${name} references the wrong state stream`);
  return version.versionId;
}

function headOrNull(controlPlane, stream) { return controlPlane.resolveHead(stream)?.versionId ?? null; }

export function validateCommentDataUpdateSessionInputV3(input) {
  const value = validateCommentDataUpdateSessionInputSchema(input);
  for (const [name] of VERSION_FIELDS) if (value.pinned[name] !== null && (typeof value.pinned[name] !== "string" || value.pinned[name].length === 0)) throw stateError("SESSION_INPUT_INVALID", `${name} must be null or a non-empty Version ID`);
  return value;
}

export function resolvePinnedSessionInputV3(controlPlane, { updateRequestId, inputContract = { id: "tiktokCommentBatch", version: "1.0.0" }, pinned = {}, target = { promotionStream: "production", deploymentTarget: "production" } } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const values = {
    updateRequestId, inputContract,
    pinned: {
      initialCorpusVersionId: pinned.initialCorpusVersionId === undefined ? headOrNull(controlPlane, STREAM_KEYS.corpus) : pinned.initialCorpusVersionId,
      classificationVersionId: pinned.classificationVersionId === undefined ? headOrNull(controlPlane, STREAM_KEYS.classification) : pinned.classificationVersionId,
      keywordSelectionVersionId: pinned.keywordSelectionVersionId === undefined ? headOrNull(controlPlane, STREAM_KEYS.keywordSelection) : pinned.keywordSelectionVersionId,
      corpusPolicyVersionId: pinned.corpusPolicyVersionId ?? headOrNull(controlPlane, STREAM_KEYS.corpusPolicy),
      classificationPolicyVersionId: pinned.classificationPolicyVersionId ?? headOrNull(controlPlane, STREAM_KEYS.classificationPolicy),
      keywordPolicyVersionId: pinned.keywordPolicyVersionId ?? headOrNull(controlPlane, STREAM_KEYS.keywordPolicy),
      accountPolicyVersionId: pinned.accountPolicyVersionId ?? headOrNull(controlPlane, STREAM_KEYS.accountPolicy),
      projectionDefinitionVersionId: pinned.projectionDefinitionVersionId ?? headOrNull(controlPlane, STREAM_KEYS.projectionDefinition),
    }, target,
  };
  const validated = validateCommentDataUpdateSessionInputV3(values);
  const resolved = { ...validated, pinned: { ...validated.pinned } };
  for (const [name, stream] of VERSION_FIELDS) resolved.pinned[name] = exactVersion(controlPlane, resolved.pinned[name], stream, name);
  for (const [name, policyKind] of POLICY_FIELDS) resolved.pinned[name] = readExactPolicyVersion(controlPlane, resolved.pinned[name], policyKind).versionId;
  for (const [name] of VERSION_FIELDS) if (resolved.pinned[name] === undefined) throw stateError("SESSION_INPUT_INVALID", `${name} must be pinned explicitly as null or a Version ID`);
  for (const [name] of POLICY_FIELDS) if (resolved.pinned[name] === null) throw stateError("SESSION_INPUT_INVALID", `${name} must be a non-empty policy Version ID`);
  return validateCommentDataUpdateSessionInputV3(resolved);
}

export function sessionInputFingerprintV3(input) { return semanticSha256(validateCommentDataUpdateSessionInputV3(input)); }

export function pinnedInputForService(input) {
  const validated = validateCommentDataUpdateSessionInputV3(input);
  return cloneJson(validated.pinned);
}

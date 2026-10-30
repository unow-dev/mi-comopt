import { canonicalBatchRequest } from "../../three-class/classification-correction-batch.js";
import { validateClassificationCorrectionBatchSessionInputSchema } from "./contracts.js";
import { cloneJson, semanticSha256 } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";
import { STREAM_KEYS, readExactPolicyVersion } from "../../application/services.js";
import { validateClassificationCorrectionSessionInputSchema, validateCommentDataUpdateSessionInputSchema } from "./contracts.js";

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

export function validateClassificationCorrectionSessionInputV3(input) {
  return validateClassificationCorrectionSessionInputSchema(input);
}

function correctionHead(controlPlane, stream) {
  return controlPlane.resolveHead(stream)?.versionId ?? null;
}

function humanActor(value) {
  if (!value || typeof value !== "object" || value.actorType !== "human" || typeof value.actorId !== "string" || value.actorId.trim().length === 0) {
    throw stateError("UNAUTHORIZED_ACTOR", "authenticated human actor is required to start a classification correction");
  }
  return { actorType: "human", actorId: value.actorId };
}

function strictCorrectionCommand(command) {
  const expected = ["baseClassificationVersionId", "observationId", "expectedLabel", "newLabel", "reason"];
  if (!command || typeof command !== "object" || Array.isArray(command) || JSON.stringify(Object.keys(command).sort()) !== JSON.stringify(expected.slice().sort())) {
    throw stateError("SESSION_INPUT_INVALID", "classification correction command has an invalid field set");
  }
  if (typeof command.baseClassificationVersionId !== "string" || command.baseClassificationVersionId.length === 0) throw stateError("SESSION_INPUT_INVALID", "baseClassificationVersionId is required");
  return {
    baseClassificationVersionId: command.baseClassificationVersionId,
    correction: {
      observationId: command.observationId,
      expectedLabel: command.expectedLabel,
      newLabel: command.newLabel,
      reason: command.reason,
    },
  };
}

/** Resolve a correction command into its immutable, exact-version Session input. */
export function resolveCorrectionSessionInput(controlPlane, { command, requestedBy, pinned = {}, target = { promotionStream: "production", deploymentTarget: "production" }, inputContract = { id: "classificationCorrection", version: "1.0.0" } } = {}) {
  if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
  const request = strictCorrectionCommand(command);
  const actor = humanActor(requestedBy);
  const base = exactVersion(controlPlane, request.baseClassificationVersionId, STREAM_KEYS.classification, "baseClassificationVersionId");
  if (correctionHead(controlPlane, STREAM_KEYS.classification) !== base) throw stateError("HEAD_CONFLICT", "base Classification Version is no longer the current head");
  const dependencies = controlPlane.readDependencies(base);
  const corpusDependencies = dependencies.filter((item) => item.role === "corpus");
  const policyDependencies = dependencies.filter((item) => item.role === "policy");
  if (corpusDependencies.length !== 1 || policyDependencies.length !== 1 || dependencies.length !== 2) throw stateError("CORRECTION_DEPENDENCY_INVALID", "base Classification Version must pin exactly one Corpus and one policy");
  const corpusVersionId = corpusDependencies[0].versionId;
  exactVersion(controlPlane, corpusVersionId, STREAM_KEYS.corpus, "base Corpus Version");
  if (correctionHead(controlPlane, STREAM_KEYS.corpus) !== corpusVersionId) throw stateError("CORPUS_HEAD_CONFLICT", "base Corpus Version is no longer the current head");
  if (pinned.corpusVersionId !== undefined && pinned.corpusVersionId !== corpusVersionId) throw stateError("CORRECTION_DEPENDENCY_INVALID", "pinned corpusVersionId differs from the base Classification dependency");
  if (pinned.classificationVersionId !== undefined && pinned.classificationVersionId !== base) throw stateError("SESSION_INPUT_INVALID", "pinned classificationVersionId differs from baseClassificationVersionId");

  const policyFields = [
    ["corpusPolicyVersionId", "corpus", STREAM_KEYS.corpusPolicy],
    ["classificationPolicyVersionId", "classification", STREAM_KEYS.classificationPolicy],
    ["keywordPolicyVersionId", "keyword-selection", STREAM_KEYS.keywordPolicy],
    ["accountPolicyVersionId", "account-candidate", STREAM_KEYS.accountPolicy],
  ];
  const resolvedPins = {
    corpusVersionId,
    classificationVersionId: base,
    keywordSelectionVersionId: pinned.keywordSelectionVersionId === undefined ? correctionHead(controlPlane, STREAM_KEYS.keywordSelection) : pinned.keywordSelectionVersionId,
  };
  if (resolvedPins.keywordSelectionVersionId !== null) exactVersion(controlPlane, resolvedPins.keywordSelectionVersionId, STREAM_KEYS.keywordSelection, "keywordSelectionVersionId");
  for (const [field, policyKind, stream] of policyFields) {
    const baseId = field === "classificationPolicyVersionId" ? policyDependencies[0].versionId : undefined;
    const versionId = pinned[field] ?? baseId ?? correctionHead(controlPlane, stream);
    resolvedPins[field] = readExactPolicyVersion(controlPlane, versionId, policyKind).versionId;
  }
  if (resolvedPins.classificationPolicyVersionId !== policyDependencies[0].versionId) throw stateError("CORRECTION_DEPENDENCY_INVALID", "pinned classification policy differs from the base Classification dependency");
  const projectionId = pinned.projectionDefinitionVersionId ?? correctionHead(controlPlane, STREAM_KEYS.projectionDefinition);
  resolvedPins.projectionDefinitionVersionId = exactVersion(controlPlane, projectionId, STREAM_KEYS.projectionDefinition, "projectionDefinitionVersionId");

  return validateClassificationCorrectionSessionInputV3({
    inputContract,
    correction: request.correction,
    requestedBy: actor,
    pinned: resolvedPins,
    target,
  });
}

/** Revision 2 keeps the single-correction resolver and its callers unchanged. */
export function resolveCorrectionBatchSessionInput(controlPlane, { command, authenticatedActor, pinned = {}, savedInput = undefined } = {}) {
  if (!command || typeof command !== "object" || Array.isArray(command)
    || Object.keys(command).some((key) => !["correctionOperationId", "baseClassificationVersionId", "corrections", "provenance"].includes(key))) throw stateError("SESSION_INPUT_INVALID", "invalid batch command fields");
  if (!pinned || typeof pinned !== "object" || Array.isArray(pinned) || Object.keys(pinned).some((key) => !["corpusVersionId", "classificationVersionId", "keywordSelectionVersionId", "corpusPolicyVersionId", "classificationPolicyVersionId", "keywordPolicyVersionId", "accountPolicyVersionId", "projectionDefinitionVersionId"].includes(key))) throw stateError("SESSION_INPUT_INVALID", "invalid pinned fields");
  const requester = humanActor(authenticatedActor);
  if (typeof command.correctionOperationId !== "string" || !command.correctionOperationId.trim() || typeof command.baseClassificationVersionId !== "string" || !command.baseClassificationVersionId.length || !Array.isArray(command.corrections) || !command.corrections.length) throw stateError("SESSION_INPUT_INVALID", "operation ID, base Classification and corrections are required");
  let pins;
  if (savedInput) {
    pins = { ...savedInput.pinned, ...pinned, classificationVersionId: command.baseClassificationVersionId };
  } else {
    const first = command.corrections[0] ?? {};
    pins = resolveCorrectionSessionInput(controlPlane, { command: { baseClassificationVersionId: command.baseClassificationVersionId, observationId: first.targetObservationId, expectedLabel: first.expectedLabel, newLabel: first.replacementLabel, reason: first.reason }, requestedBy: requester, pinned }).pinned;
  }
  return validateClassificationCorrectionBatchSessionInputV3({ inputContract: { id: "classificationCorrectionBatch", version: "2.0.0" }, correctionOperationId: command.correctionOperationId,
    requester, corrections: command.corrections, pinned: pins, target: { promotionStream: "production", deploymentTarget: "production" }, ...(command.provenance ? { provenance: command.provenance } : {}) });
}

export function validateClassificationCorrectionBatchSessionInputV3(input) {
  const value = canonicalBatchRequest(validateClassificationCorrectionBatchSessionInputSchema(input));
  if (!value.correctionOperationId.trim() || !value.requester.actorId.trim()) throw stateError("SESSION_INPUT_INVALID", "operation ID and requester must contain text");
  return value;
}

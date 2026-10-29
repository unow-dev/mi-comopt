import { canonicalJson, cloneJson, deterministicId, semanticSha256 } from "../../state/canonical.js";
import { StateControlPlaneError, stateError } from "../../state/errors.js";
import { readSelectedSnapshotsInReferenceOrder } from "../../database/raw-snapshot-repository.js";
import { readClassificationVersionLabels } from "../../database/three-class-label-repository.js";
import { projectCumulativeCorpus } from "../../processing/analysis-input/raw-snapshot-projection.js";
import { buildCorrectedClassificationState } from "../../three-class/classification-correction.js";
import { STREAM_KEYS, normalizeLabels, readExactPolicyVersion } from "../services.js";
import { runV3Idempotent } from "./context.js";
import { v3StepResult } from "./result.js";

const CORRECTION_KIND = "manual_classification_correction";
const CORRECTION_STEP_ID = "03-correction-propose";

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw stateError("CORRECTION_INPUT_INVALID", `${field} must be a non-empty string`);
  return value;
}

function requireHumanActor(actor, field = "requestedBy") {
  if (!actor || typeof actor !== "object" || actor.actorType !== "human" || typeof actor.actorId !== "string" || actor.actorId.trim().length === 0) {
    throw stateError("UNAUTHORIZED_ACTOR", `${field} must be supplied by an authenticated human actor`);
  }
  return { actorType: "human", actorId: actor.actorId };
}

function correctionDto(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw stateError("CORRECTION_INPUT_INVALID", "correction must be an object");
  const allowed = ["observationId", "expectedLabel", "newLabel", "reason"];
  if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => value[key] === undefined)) {
    throw stateError("CORRECTION_INPUT_INVALID", "correction must contain only observationId, expectedLabel, newLabel and reason");
  }
  if (typeof value.reason !== "string" || value.reason.trim().length === 0) throw stateError("CORRECTION_REASON_REQUIRED", "reason must contain non-whitespace text");
  return cloneJson(value);
}

function oneDependency(controlPlane, versionId, role, expectedStream, label) {
  const dependencies = controlPlane.readDependencies(versionId).filter((item) => item.role === role);
  if (dependencies.length !== 1) throw stateError("CORRECTION_DEPENDENCY_INVALID", `${label} must have exactly one ${role} dependency`);
  const dependency = dependencies[0];
  const version = controlPlane.readVersion(dependency.versionId);
  if (!version || (expectedStream && (version.domain !== expectedStream.domain || version.streamKey !== expectedStream.streamKey))) {
    throw stateError("CORRECTION_DEPENDENCY_INVALID", `${label} ${role} dependency points to the wrong stream`);
  }
  return { dependency, version };
}

function corpusSnapshotRefs(corpusVersion) {
  const state = corpusVersion?.payload?.state ?? corpusVersion?.payload;
  const references = state?.snapshot_refs ?? state?.snapshotRefs;
  if (!Array.isArray(references)) throw stateError("CORPUS_STATE_INVALID", "pinned Corpus must contain snapshot_refs");
  const seen = new Set();
  return references.map((reference) => {
    const normalized = typeof reference === "string"
      ? (() => {
        const match = /^([0-9a-f]{64}):([0-9]+)$/.exec(reference);
        if (!match) throw stateError("CORPUS_STATE_INVALID", "pinned Corpus snapshot reference is invalid");
        return { payloadSha256: match[1], snapshotIndex: Number(match[2]) };
      })()
      : { payloadSha256: reference?.payloadSha256, snapshotIndex: reference?.snapshotIndex };
    if (!/^[0-9a-f]{64}$/.test(normalized.payloadSha256 ?? "") || !Number.isSafeInteger(normalized.snapshotIndex) || normalized.snapshotIndex < 0) {
      throw stateError("CORPUS_STATE_INVALID", "pinned Corpus snapshot reference is invalid");
    }
    const key = `${normalized.payloadSha256}:${normalized.snapshotIndex}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return normalized;
  }).filter(Boolean);
}

function stateSchemaVersion(state) {
  const value = state?.schema_version ?? state?.schemaVersion ?? 1;
  if (!Number.isSafeInteger(value) || value < 1) throw stateError("CLASSIFICATION_STATE_INVALID", "base Classification state schema version is invalid");
  return value;
}

function fingerprintInput({ baseClassificationVersionId, corpusVersionId, classificationPolicyVersionId, correction, requestedBy, state, change }) {
  return semanticSha256({ baseClassificationVersionId, corpusVersionId, classificationPolicyVersionId, correction, requestedBy, state, change });
}

function correctionMetadata({ baseClassificationVersionId, corpusVersionId, classificationPolicyVersionId, correction, requestedBy, state, change }) {
  const normalizedId = typeof correction.observationId === "number" ? String(correction.observationId) : correction.observationId;
  const command = { observationId: normalizedId, expectedLabel: correction.expectedLabel, newLabel: correction.newLabel, reason: correction.reason };
  const metadata = {
    kind: CORRECTION_KIND,
    baseClassificationVersionId,
    corpusVersionId,
    classificationPolicyVersionId,
    observationId: normalizedId,
    commentText: change.commentText,
    expectedLabel: command.expectedLabel,
    newLabel: command.newLabel,
    reason: command.reason,
    requestedBy: cloneJson(requestedBy),
    change: cloneJson(change),
  };
  metadata.inputFingerprint = fingerprintInput({ baseClassificationVersionId, corpusVersionId, classificationPolicyVersionId, correction: command, requestedBy, state, change });
  return metadata;
}

function assertBaseStateMatchesLabelRows(baseState, labelRows) {
  if (!baseState || typeof baseState !== "object" || !Array.isArray(baseState.labels)) throw stateError("CLASSIFICATION_STATE_INVALID", "base Classification state must contain a complete labels array");
  const normalizedState = normalizeLabels(baseState);
  const normalizedRows = normalizeLabels({ schema_version: stateSchemaVersion(baseState), labels: labelRows.map(({ observationId, label }) => ({ observationId, label })) });
  if (canonicalJson(normalizedState.labels) !== canonicalJson(normalizedRows.labels)) {
    throw stateError("CLASSIFICATION_STATE_INVALID", "base Classification payload and label index do not match");
  }
}

function readCorrectionInputs(controlPlane, input) {
  const baseClassificationVersionId = requireNonEmptyString(input.classificationVersionId, "classificationVersionId");
  const corpusVersionId = requireNonEmptyString(input.corpusVersionId, "corpusVersionId");
  const classificationPolicyVersionId = requireNonEmptyString(input.classificationPolicyVersionId, "classificationPolicyVersionId");
  const correction = correctionDto(input.correction);
  const requestedBy = requireHumanActor(input.requestedBy);
  const base = controlPlane.readVersion(baseClassificationVersionId);
  if (!base || base.domain !== STREAM_KEYS.classification.domain || base.streamKey !== STREAM_KEYS.classification.streamKey) throw stateError("VERSION_STREAM_MISMATCH", "classificationVersionId must reference the classification/comments stream");
  const classificationHead = controlPlane.resolveHead(STREAM_KEYS.classification)?.versionId ?? null;
  if (classificationHead !== baseClassificationVersionId) throw stateError("HEAD_CONFLICT", "base Classification Version is no longer the current head");
  const { dependency: corpusDependency } = oneDependency(controlPlane, baseClassificationVersionId, "corpus", STREAM_KEYS.corpus, "base Classification Version");
  const { dependency: policyDependency } = oneDependency(controlPlane, baseClassificationVersionId, "policy", null, "base Classification Version");
  if (corpusDependency.versionId !== corpusVersionId) throw stateError("CORRECTION_DEPENDENCY_INVALID", "corpusVersionId does not match the base Classification dependency");
  if (policyDependency.versionId !== classificationPolicyVersionId) throw stateError("CORRECTION_DEPENDENCY_INVALID", "classification policy does not match the base Classification dependency");
  const corpus = controlPlane.readVersion(corpusVersionId);
  if (!corpus || corpus.domain !== STREAM_KEYS.corpus.domain || corpus.streamKey !== STREAM_KEYS.corpus.streamKey) throw stateError("VERSION_STREAM_MISMATCH", "corpusVersionId must reference the corpus/comments stream");
  const corpusHead = controlPlane.resolveHead(STREAM_KEYS.corpus)?.versionId ?? null;
  if (corpusHead !== corpusVersionId) throw stateError("CORPUS_HEAD_CONFLICT", "base Corpus Version is no longer the current head");
  const classificationPolicy = readExactPolicyVersion(controlPlane, classificationPolicyVersionId, "classification");
  const refs = corpusSnapshotRefs(corpus);
  const bundles = refs.length === 0 ? [] : readSelectedSnapshotsInReferenceOrder(controlPlane.db, refs);
  const projection = projectCumulativeCorpus(bundles);
  const labelRows = readClassificationVersionLabels(controlPlane.db, baseClassificationVersionId);
  const baseState = base.payload?.state ?? base.payload;
  assertBaseStateMatchesLabelRows(baseState, labelRows);
  return { baseClassificationVersionId, corpusVersionId, classificationPolicyVersionId: classificationPolicy.versionId, correction, requestedBy, base, corpus, projection, labelRows, baseState };
}

export class ClassificationCorrectionServiceV3 {
  constructor(controlPlane) {
    if (!controlPlane) throw stateError("CONFIGURATION_ERROR", "controlPlane is required");
    this.controlPlane = controlPlane;
  }

  propose(ctx, request = {}) {
    if (ctx?.workDefinitionId !== "classification-correction") throw stateError("WORK_DEFINITION_MISMATCH", "classification correction may only run in its dedicated WorkDefinition");
    if (!ctx || typeof ctx.operationId !== "string" || !["state:read", "state:propose"].every((permission) => (ctx.permissions ?? []).includes(permission))) {
      throw stateError("PERMISSION_DENIED", "classification correction proposal requires state:read and state:propose");
    }
    const run = () => {
      let input;
      try {
        input = readCorrectionInputs(this.controlPlane, request);
      } catch (error) {
        if (error instanceof StateControlPlaneError && ["HEAD_CONFLICT", "CORPUS_HEAD_CONFLICT"].includes(error.code)) {
          return v3StepResult({ stepId: CORRECTION_STEP_ID, routingOutcome: "superseded", stateResult: "conflict", refs: {}, details: { conflictAt: error.code === "CORPUS_HEAD_CONFLICT" ? "corpus" : "classification" } });
        }
        throw error;
      }
      const result = buildCorrectedClassificationState({
        survivors: input.projection.survivors.map((row) => ({ observationId: row.observationId, commentText: row.commentText })),
        baseLabels: input.labelRows.map(({ observationId, label }) => ({ observationId, label })),
        correction: input.correction,
        schemaVersion: stateSchemaVersion(input.baseState),
      });
      const state = normalizeLabels(result.state);
      const metadata = correctionMetadata({ ...input, state, change: result.change });
      const assessmentId = deterministicId("assessment", `${ctx.operationId}:classification-correction`);
      const proposalId = deterministicId("proposal", `${ctx.operationId}:classification-correction`);
      const stream = this.controlPlane.ensureStream(STREAM_KEYS.classification);
      this.controlPlane.recordAssessment({
        assessmentId,
        streamId: stream.stream_id,
        inputFingerprint: metadata.inputFingerprint,
        payload: { schema_version: 1, state, correction: metadata },
        operationId: `${ctx.operationId}/assessment`,
      });
      try {
        this.controlPlane.createProposal({
          proposalId,
          streamId: stream.stream_id,
          expectedHeadVersionId: input.baseClassificationVersionId,
          proposedSemanticSha256: semanticSha256(state),
          payload: { schema_version: 1, state, correction: metadata },
          dependencies: [
            { role: "corpus", versionId: input.corpusVersionId },
            { role: "policy", versionId: input.classificationPolicyVersionId },
          ],
          assessmentRefs: { assessmentId },
          operationId: `${ctx.operationId}/proposal`,
        });
      } catch (error) {
        if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") {
          return v3StepResult({ stepId: CORRECTION_STEP_ID, routingOutcome: "superseded", stateResult: "conflict", refs: {}, details: { conflictAt: "classification" } });
        }
        throw error;
      }
      return v3StepResult({ stepId: CORRECTION_STEP_ID, routingOutcome: "review_required", stateResult: "review_required", refs: { assessmentId, proposalId } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "classification-correction.v3.propose", request, run);
  }
}

function exactObject(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson(keys.slice().sort()));
}

function validateCorrectionMetadata(metadata) {
  const keys = ["kind", "baseClassificationVersionId", "corpusVersionId", "classificationPolicyVersionId", "observationId", "commentText", "expectedLabel", "newLabel", "reason", "requestedBy", "change", "inputFingerprint"];
  if (!exactObject(metadata, keys) || metadata.kind !== CORRECTION_KIND || typeof metadata.commentText !== "string" || typeof metadata.inputFingerprint !== "string") {
    throw stateError("CORRECTION_PROPOSAL_INVALID", "correction proposal metadata is incomplete or contains unsupported fields");
  }
  requireNonEmptyString(metadata.baseClassificationVersionId, "correction.baseClassificationVersionId");
  requireNonEmptyString(metadata.corpusVersionId, "correction.corpusVersionId");
  requireNonEmptyString(metadata.classificationPolicyVersionId, "correction.classificationPolicyVersionId");
  requireNonEmptyString(metadata.reason, "correction.reason");
  requireHumanActor(metadata.requestedBy, "correction.requestedBy");
  return {
    observationId: metadata.observationId,
    expectedLabel: metadata.expectedLabel,
    newLabel: metadata.newLabel,
    reason: metadata.reason,
  };
}

/** Re-run the complete correction calculation inside commitProposal's transaction. */
export function classificationCorrectionCommitPreflight(controlPlane, { checkCorpusHead = true } = {}) {
  return ({ db, proposal }) => {
    const metadata = proposal?.payload?.correction;
    if (metadata === undefined) throw stateError("CORRECTION_PROPOSAL_INVALID", "correction finalization requires correction metadata");
    const correction = validateCorrectionMetadata(metadata);
    if (proposal.expectedHeadVersionId !== metadata.baseClassificationVersionId) throw stateError("CORRECTION_PROPOSAL_INVALID", "proposal base does not match its expected classification head");
    const corpusDependencies = proposal.dependencies.filter((item) => item.role === "corpus");
    const policyDependencies = proposal.dependencies.filter((item) => item.role === "policy");
    if (proposal.dependencies.length !== 2 || corpusDependencies.length !== 1 || policyDependencies.length !== 1 || corpusDependencies[0].versionId !== metadata.corpusVersionId || policyDependencies[0].versionId !== metadata.classificationPolicyVersionId) {
      throw stateError("CORRECTION_DEPENDENCY_INVALID", "correction Proposal must pin exactly its source Corpus and classification policy");
    }
    const base = controlPlane.readVersion(metadata.baseClassificationVersionId);
    if (!base || base.domain !== STREAM_KEYS.classification.domain || base.streamKey !== STREAM_KEYS.classification.streamKey) throw stateError("CORRECTION_PROPOSAL_INVALID", "correction base Classification Version is invalid");
    const { dependency: corpusDependency } = oneDependency(controlPlane, base.versionId, "corpus", STREAM_KEYS.corpus, "base Classification Version");
    const { dependency: policyDependency } = oneDependency(controlPlane, base.versionId, "policy", null, "base Classification Version");
    if (corpusDependency.versionId !== metadata.corpusVersionId || policyDependency.versionId !== metadata.classificationPolicyVersionId) throw stateError("CORRECTION_DEPENDENCY_INVALID", "correction source pins do not match the base Classification Version");
    readExactPolicyVersion(controlPlane, metadata.classificationPolicyVersionId, "classification");
    const corpusHead = controlPlane.resolveHead(STREAM_KEYS.corpus)?.versionId ?? null;
    if (checkCorpusHead && corpusHead !== metadata.corpusVersionId) throw stateError("CORPUS_HEAD_CONFLICT", "correction source Corpus is no longer the current head");
    const corpus = controlPlane.readVersion(metadata.corpusVersionId);
    if (!corpus || corpus.domain !== STREAM_KEYS.corpus.domain || corpus.streamKey !== STREAM_KEYS.corpus.streamKey) throw stateError("CORRECTION_DEPENDENCY_INVALID", "correction Corpus dependency is invalid");
    const refs = corpusSnapshotRefs(corpus);
    const bundles = refs.length === 0 ? [] : readSelectedSnapshotsInReferenceOrder(db, refs);
    const survivors = projectCumulativeCorpus(bundles).survivors.map((row) => ({ observationId: row.observationId, commentText: row.commentText }));
    const labelRows = readClassificationVersionLabels(db, base.versionId);
    const baseState = base.payload?.state ?? base.payload;
    assertBaseStateMatchesLabelRows(baseState, labelRows);
    const expected = buildCorrectedClassificationState({ survivors, baseLabels: labelRows.map(({ observationId, label }) => ({ observationId, label })), correction, schemaVersion: stateSchemaVersion(baseState) });
    const normalizedExpected = normalizeLabels(expected.state);
    if (metadata.commentText !== expected.change.commentText || canonicalJson(metadata.change) !== canonicalJson(expected.change)) throw stateError("CORRECTION_PROPOSAL_INVALID", "correction metadata does not match the source group");
    if (canonicalJson(proposal.payload.state) !== canonicalJson(normalizedExpected)) throw stateError("CORRECTION_PROPOSAL_INVALID", "correction Proposal state differs from the recomputed group-only correction");
    if (semanticSha256(normalizedExpected) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "correction semantic fingerprint is invalid");
    const recomputedInputFingerprint = fingerprintInput({
      baseClassificationVersionId: metadata.baseClassificationVersionId,
      corpusVersionId: metadata.corpusVersionId,
      classificationPolicyVersionId: metadata.classificationPolicyVersionId,
      correction: { ...correction, observationId: String(correction.observationId) },
      requestedBy: metadata.requestedBy,
      state: normalizedExpected,
      change: expected.change,
    });
    if (metadata.inputFingerprint !== recomputedInputFingerprint) throw stateError("CORRECTION_PROPOSAL_INVALID", "correction input fingerprint is invalid");
    const assessmentId = proposal.assessmentRefs?.assessmentId;
    if (Object.keys(proposal.assessmentRefs ?? {}).length !== 1 || typeof assessmentId !== "string") throw stateError("CORRECTION_REVIEW_INTEGRITY_ERROR", "correction Proposal must reference exactly one Assessment");
    const assessment = controlPlane.readAssessment(assessmentId);
    if (!assessment || assessment.streamId !== proposal.streamId || assessment.inputFingerprint !== metadata.inputFingerprint || canonicalJson(assessment.payload?.state) !== canonicalJson(normalizedExpected) || canonicalJson(assessment.payload?.correction) !== canonicalJson(metadata)) {
      throw stateError("CORRECTION_REVIEW_INTEGRITY_ERROR", "persisted Assessment does not match the correction Proposal");
    }
    if (!db) throw stateError("CORRECTION_COMMIT_INVALID", "commit transaction database is required");
  };
}

export function readCorrectionReviewSummary(controlPlane, { proposalId, assessmentId } = {}) {
  requireNonEmptyString(proposalId, "proposalId");
  requireNonEmptyString(assessmentId, "assessmentId");
  const proposal = controlPlane.readProposal(proposalId);
  const metadata = proposal?.payload?.correction;
  if (!proposal || metadata?.kind !== CORRECTION_KIND || proposal.assessmentRefs?.assessmentId !== assessmentId) throw stateError("CORRECTION_REVIEW_INTEGRITY_ERROR", "Proposal and Assessment do not identify the same correction");
  classificationCorrectionCommitPreflight(controlPlane, { checkCorpusHead: false })({ db: controlPlane.db, proposal });
  return cloneJson({
    proposalId,
    assessmentId,
    baseClassificationVersionId: metadata.baseClassificationVersionId,
    corpusVersionId: metadata.corpusVersionId,
    classificationPolicyVersionId: metadata.classificationPolicyVersionId,
    observationId: metadata.observationId,
    commentText: metadata.commentText,
    expectedLabel: metadata.expectedLabel,
    newLabel: metadata.newLabel,
    reason: metadata.reason,
    requestedBy: metadata.requestedBy,
    change: metadata.change,
  });
}

export { CORRECTION_KIND };

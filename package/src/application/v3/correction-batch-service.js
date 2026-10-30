import { createHash } from "node:crypto";
import { canonicalJson, cloneJson, deterministicId, semanticSha256 } from "../../state/canonical.js";
import { StateControlPlaneError, stateError } from "../../state/errors.js";
import { readSelectedSnapshotsInReferenceOrder } from "../../database/raw-snapshot-repository.js";
import { readClassificationVersionLabels } from "../../database/three-class-label-repository.js";
import { projectCumulativeCorpus } from "../../processing/analysis-input/raw-snapshot-projection.js";
import { classificationSemanticHash, assertSameChangeSet, batchRequestFingerprint, buildBatchCorrectionChangeSet, correctionChangeSetHash } from "../../three-class/classification-correction-batch.js";
import { validateClassificationCorrectionBatchSessionInputV3 } from "../../workflow/v3/session-input.js";
import { STREAM_KEYS, policyPayload, readExactPolicyVersion, typedClassificationHandler } from "../services.js";
import { corpusSnapshotRefs, assertBaseStateMatchesLabelRows, stateSchemaVersion } from "./correction-service.js";
import { v3StepResult } from "./result.js";

export const BATCH_KIND = "manual_classification_correction_batch";
export const batchOperationKey = (id, stage) => `classification-correction-batch/${id}/${stage}`;
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code, message) => { throw stateError(code, message); };

export function readBatchRegistration(controlPlane, id) {
  return controlPlane.readReceipt(batchOperationKey(id, "registration"))?.result ?? null;
}

/** All tasks use the authenticated, durably registered request. A generic
 * workflow start cannot turn a self-asserted requester into an authorized one. */
export function requireBatchRegistration(controlPlane, ctx, id) {
  const registration = readBatchRegistration(controlPlane, id);
  if (ctx.workDefinitionId !== "classification-correction" || ctx.workDefinitionRevision !== 2
    || !registration || registration.sessionId !== ctx.sessionId) fail("UNAUTHORIZED_BATCH_SESSION", "batch must run in its registered authenticated Session");
  const batch = validateClassificationCorrectionBatchSessionInputV3(registration.input);
  if (batchRequestFingerprint(batch) !== registration.requestFingerprint) fail("BATCH_INTEGRITY_ERROR", "registered request fingerprint differs");
  return registration;
}

function requirePermissions(ctx, names) {
  if (!names.every((name) => ctx.permissions?.includes(name))) fail("PERMISSION_DENIED", "missing batch service permission");
}

export function validateBatchPins(controlPlane, batch, { checkHeads = true } = {}) {
  const pins = batch.pinned;
  for (const [field, stream] of [["classificationVersionId", STREAM_KEYS.classification], ["corpusVersionId", STREAM_KEYS.corpus], ["keywordSelectionVersionId", STREAM_KEYS.keywordSelection], ["projectionDefinitionVersionId", STREAM_KEYS.projectionDefinition]]) {
    if (field === "keywordSelectionVersionId" && pins[field] === null) continue;
    const version = controlPlane.readVersion(pins[field]);
    if (!version || version.domain !== stream.domain || version.streamKey !== stream.streamKey) fail("BATCH_DEPENDENCY_INVALID", `${field} belongs to the wrong stream`);
  }
  for (const [field, kind] of [["corpusPolicyVersionId", "corpus"], ["classificationPolicyVersionId", "classification"], ["keywordPolicyVersionId", "keyword-selection"], ["accountPolicyVersionId", "account-candidate"]]) readExactPolicyVersion(controlPlane, pins[field], kind);
  const expected = [{ role: "corpus", versionId: pins.corpusVersionId }, { role: "policy", versionId: pins.classificationPolicyVersionId }];
  if (!equal(controlPlane.readDependencies(pins.classificationVersionId), expected)) fail("BATCH_DEPENDENCY_INVALID", "Classification dependencies differ from the pinned Corpus/policy");
  if (checkHeads && controlPlane.resolveHead(STREAM_KEYS.classification)?.versionId !== pins.classificationVersionId) fail("HEAD_CONFLICT", "Classification head advanced");
  if (checkHeads && controlPlane.resolveHead(STREAM_KEYS.corpus)?.versionId !== pins.corpusVersionId) fail("CORPUS_HEAD_CONFLICT", "Corpus head advanced");
}

function loadSnapshot(controlPlane, batch, options) {
  validateBatchPins(controlPlane, batch, options);
  const base = controlPlane.readVersion(batch.pinned.classificationVersionId);
  const corpus = controlPlane.readVersion(batch.pinned.corpusVersionId);
  if (semanticSha256(corpus.payload?.state ?? corpus.payload) !== corpus.semanticSha256) fail("BATCH_DEPENDENCY_INVALID", "Corpus payload differs from its semantic hash");
  const refs = corpusSnapshotRefs(corpus);
  const survivors = projectCumulativeCorpus(refs.length ? readSelectedSnapshotsInReferenceOrder(controlPlane.db, refs) : []).survivors;
  const baseLabels = readClassificationVersionLabels(controlPlane.db, base.versionId);
  const baseState = base.payload?.state ?? base.payload;
  assertBaseStateMatchesLabelRows(baseState, baseLabels);
  if (classificationSemanticHash(baseState) !== base.semanticSha256) fail("CLASSIFICATION_STATE_INVALID", "base Classification semantic hash differs from its payload/index");
  return { survivors, baseLabels, schemaVersion: stateSchemaVersion(baseState) };
}

function authorizeActor(actor, authorization = {}) {
  if (actor?.actorType !== "human" || typeof actor.actorId !== "string" || !actor.actorId.trim()) fail("UNAUTHORIZED_ACTOR", "authenticated human actor required");
  if (Array.isArray(authorization.allowed_actor_ids) && !authorization.allowed_actor_ids.includes(actor.actorId)) fail("UNAUTHORIZED_ACTOR", "human actor is not allowed by policy");
  if (Array.isArray(authorization.allowed_actor_types) && !authorization.allowed_actor_types.includes(actor.actorType)) fail("UNAUTHORIZED_ACTOR", "actor type is not allowed by policy");
}

/** Supplied provenance is evidence, never an authority claim. Source bytes are
 * read from the content-addressed provider store and receipts from the DB. */
export function verifyBatchProvenance(controlPlane, artifactStore, batch, snapshot) {
  const sources = new Map();
  const survivorText = new Map(snapshot.survivors.map((row) => [String(row.observationId), row.commentText]));
  for (const item of batch.corrections) {
    if (!batch.provenance && !item.provenance) continue;
    for (const key of Object.keys(batch.provenance ?? {})) {
      if (item.provenance?.[key] !== undefined && item.provenance[key] !== batch.provenance[key]) fail("PROVENANCE_INVALID", "item provenance contradicts batch provenance");
    }
    const p = { ...batch.provenance, ...item.provenance };
    if (!p.sourceSha256 || !p.worksetId || !p.receiptRef || !p.handoffItemId) fail("PROVENANCE_INVALID", "source hash, workset, receipt and item are required to verify provenance");
    const key = `${p.sourceSha256}/${p.receiptRef}`;
    if (!sources.has(key)) {
      const receipt = controlPlane.readReceipt(p.receiptRef);
      const result = receipt?.result;
      const plan = result?.details?.classificationPlan;
      if (!Array.isArray(plan?.handoffItems) || result.refs?.worksetId !== p.worksetId) fail("PROVENANCE_INVALID", "handoff receipt or workset differs");
      let bytes;
      try { bytes = artifactStore?.read(p.sourceSha256); } catch { fail("PROVENANCE_INVALID", "source artifact is unavailable"); }
      if (!bytes || createHash("sha256").update(bytes).digest("hex") !== p.sourceSha256) fail("PROVENANCE_INVALID", "source bytes differ from pinned SHA-256");
      let source;
      try { source = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { fail("PROVENANCE_INVALID", "source is not JSON"); }
      if (source?.workset_id !== p.worksetId || !source.decisions || Array.isArray(source.decisions)
        || !equal(Object.keys(source.decisions).sort(), plan.handoffItems.map((row) => row.id).sort())) fail("PROVENANCE_INVALID", "source decisions differ from the saved handoff");
      sources.set(key, { source, items: new Map(plan.handoffItems.map((row) => [row.id, row])), worksetId: p.worksetId });
    }
    const verified = sources.get(key);
    const saved = verified.items.get(p.handoffItemId);
    if (verified.worksetId !== p.worksetId || !saved || String(saved.observationId) !== item.targetObservationId || verified.source.decisions[p.handoffItemId] !== item.replacementLabel
      || survivorText.get(item.targetObservationId) !== saved.commentText) fail("PROVENANCE_INVALID", "handoff item does not identify the requested representative, text and replacement");
  }
}

function reviewProjection(changeSet) {
  const { state, changes, ...summary } = changeSet;
  return summary;
}

function assertProposalIntegrity(controlPlane, proposal, changeSet, assessmentId) {
  const assessment = controlPlane.readAssessment(assessmentId);
  const expectedPayload = { schema_version: 2, state: changeSet.state, correctionBatch: { kind: BATCH_KIND, changeSetId: batchOperationKey(changeSet.request.correctionOperationId, "change-set"), changeSetHash: changeSet.changeSetHash, requestFingerprint: changeSet.requestFingerprint, review: reviewProjection(changeSet) } };
  if (!proposal || proposal.payload?.correctionBatch?.kind !== BATCH_KIND || !equal(proposal.payload, expectedPayload)
    || !equal(proposal.assessmentRefs, { assessmentId }) || !assessment || assessment.streamId !== proposal.streamId || assessment.inputFingerprint !== changeSet.requestFingerprint || !equal(assessment.payload, expectedPayload)
    || proposal.proposedSemanticSha256 !== changeSet.proposedStateSemanticSha256
    || proposal.expectedHeadVersionId !== changeSet.request.pinned.classificationVersionId
    || !equal(proposal.dependencies, [{ role: "corpus", versionId: changeSet.request.pinned.corpusVersionId }, { role: "policy", versionId: changeSet.request.pinned.classificationPolicyVersionId }])
    || proposal.proposalSha256 !== semanticSha256({ streamId: proposal.streamId, expectedHeadVersionId: proposal.expectedHeadVersionId, proposedSemanticSha256: proposal.proposedSemanticSha256, payload: proposal.payload, dependencies: proposal.dependencies, assessmentRefs: proposal.assessmentRefs })) fail("BATCH_INTEGRITY_ERROR", "Proposal, Assessment and ChangeSet differ");
}

export class ClassificationCorrectionBatchServiceV3 {
  constructor(controlPlane, { artifactStore, registry } = {}) { this.controlPlane = controlPlane; this.artifactStore = artifactStore; this.registry = registry; }

  registration(ctx, id) { return requireBatchRegistration(this.controlPlane, ctx, id); }

  result(ctx, stateResult, refs = {}, details = undefined) {
    const routingOutcome = stateResult === "blocked" ? "invalid" : stateResult === "conflict" ? "superseded" : stateResult === "review_required" ? "review_required" : stateResult === "rejected" ? "rejected" : "continue";
    return v3StepResult({ stepId: ctx.stepId, routingOutcome, stateResult, refs, details });
  }

  businessResult(ctx, work) {
    try { return work(); } catch (error) {
      if (!(error instanceof StateControlPlaneError)) throw error;
      if (["HEAD_CONFLICT", "CORPUS_HEAD_CONFLICT"].includes(error.code)) return this.result(ctx, "conflict", {}, { conflictAt: error.code === "CORPUS_HEAD_CONFLICT" ? "corpus" : "classification" });
      if (ctx.stepId !== "06-finalize-correction-batch" && ["BATCH_INPUT_INVALID", "BATCH_DEPENDENCY_INVALID", "SESSION_INPUT_INVALID", "INVALID_LABEL", "UNCHANGED_CORRECTION", "CORRECTION_REASON_REQUIRED", "INVALID_SURVIVOR", "INCOMPLETE_CLASSIFICATION", "TARGET_NOT_FOUND", "DUPLICATE_GROUP", "EXPECTED_LABEL_MISMATCH", "PROVENANCE_INVALID", "CLASSIFICATION_STATE_INVALID"].includes(error.code)) return this.result(ctx, "blocked", {}, { reason: "invalid_request", violations: [{ code: error.code, description: error.message }] });
      throw error;
    }
  }

  validate(ctx, { batch }) {
    requirePermissions(ctx, ["state:read"]);
    return this.businessResult(ctx, () => {
      const registration = this.registration(ctx, batch.correctionOperationId);
      batch = validateClassificationCorrectionBatchSessionInputV3(batch);
      if (!equal(batch, registration.input)) fail("IDEMPOTENCY_CONFLICT", "batch differs from the registered request");
      validateBatchPins(this.controlPlane, batch);
      const policy = policyPayload(this.controlPlane, batch.pinned.classificationPolicyVersionId, "classification");
      authorizeActor(batch.requester, policy.correction_authorization);
      return this.result(ctx, "succeeded", {}, { requestFingerprint: registration.requestFingerprint });
    });
  }

  resolve(ctx, { batch, requestFingerprint }) {
    requirePermissions(ctx, ["state:read", "state:propose"]);
    return this.businessResult(ctx, () => {
      const registration = this.registration(ctx, batch.correctionOperationId);
      if (requestFingerprint !== registration.requestFingerprint || !equal(validateClassificationCorrectionBatchSessionInputV3(batch), registration.input)) fail("IDEMPOTENCY_CONFLICT", "request fingerprint differs");
      const changeSetId = batchOperationKey(batch.correctionOperationId, "change-set");
      const changeSet = this.controlPlane.runIdempotent({ operationId: changeSetId, operationKind: "correction-batch.resolve", request: { requestFingerprint } }, () => {
        const snapshot = loadSnapshot(this.controlPlane, batch);
        verifyBatchProvenance(this.controlPlane, this.artifactStore, batch, snapshot);
        return buildBatchCorrectionChangeSet({ request: batch, ...snapshot });
      });
      return this.result(ctx, "succeeded", {}, { changeSetId, changeSetHash: changeSet.changeSetHash, requestFingerprint, groupCount: changeSet.groupCount, observationCount: changeSet.observationCount });
    });
  }

  readChangeSet(registration, changeSetId, hash) {
    if (changeSetId !== batchOperationKey(registration.input.correctionOperationId, "change-set")) fail("BATCH_INTEGRITY_ERROR", "ChangeSet ID is not bound to this operation");
    const value = this.controlPlane.readReceipt(changeSetId)?.result;
    if (!value || value.changeSetHash !== hash || correctionChangeSetHash(value) !== hash || value.requestFingerprint !== registration.requestFingerprint || !equal(value.request, registration.input)) fail("BATCH_INTEGRITY_ERROR", "saved ChangeSet hash or request differs");
    return value;
  }

  propose(ctx, { correctionOperationId, requestFingerprint, changeSetId, changeSetHash }) {
    requirePermissions(ctx, ["state:read", "state:propose"]);
    return this.businessResult(ctx, () => {
      const registration = this.registration(ctx, correctionOperationId);
      if (registration.requestFingerprint !== requestFingerprint) fail("IDEMPOTENCY_CONFLICT", "request fingerprint differs");
      return this.controlPlane.runIdempotent({ operationId: batchOperationKey(correctionOperationId, "proposal"), operationKind: "correction-batch.propose", request: { requestFingerprint, changeSetId, changeSetHash } }, () => {
        validateBatchPins(this.controlPlane, registration.input);
        const changeSet = this.readChangeSet(registration, changeSetId, changeSetHash);
        const streamId = this.controlPlane.ensureStream(STREAM_KEYS.classification).stream_id;
        const assessmentId = deterministicId("assessment", changeSetId);
        const proposalId = deterministicId("proposal", changeSetId);
        const payload = { schema_version: 2, state: changeSet.state, correctionBatch: { kind: BATCH_KIND, changeSetId, changeSetHash, requestFingerprint, review: reviewProjection(changeSet) } };
        this.controlPlane.recordAssessment({ assessmentId, streamId, inputFingerprint: requestFingerprint, payload, operationId: batchOperationKey(correctionOperationId, "assessment") });
        this.controlPlane.createProposal({ proposalId, streamId, expectedHeadVersionId: registration.input.pinned.classificationVersionId, proposedSemanticSha256: changeSet.proposedStateSemanticSha256, payload,
          dependencies: [{ role: "corpus", versionId: registration.input.pinned.corpusVersionId }, { role: "policy", versionId: registration.input.pinned.classificationPolicyVersionId }], assessmentRefs: { assessmentId } });
        return this.result(ctx, "review_required", { assessmentId, proposalId }, { changeSetHash });
      });
    });
  }

  boundReview(ctx, input) {
    const state = this.registry?.getRuntimeState(ctx.sessionId);
    const tasks = Object.values(state?.tasks ?? {}).filter((task) => task.stepId === "05-review-classification");
    const task = tasks[0];
    const executions = Object.values(state?.executions ?? {}).filter((execution) => execution.taskId === task?.taskId && execution.state === "succeeded");
    const execution = executions[0];
    const completion = input.review;
    if (tasks.length !== 1 || task.state !== "completed" || task.workerKind !== "human" || executions.length !== 1 || !execution || !equal(execution.result, task.result)
      || task.inputs?.proposal !== input.proposalId || task.inputs?.assessment !== input.assessmentId || task.inputs?.changeSetHash !== input.approvedChangeSetHash
      || !equal(completion, { outcome: task.outcome, actor: task.completedBy, result: task.result ?? null })
      || !["accept", "reject"].includes(completion?.outcome) || typeof completion?.result?.rationale !== "string" || !completion.result.rationale.trim()) fail("BATCH_REVIEW_REQUIRED", "completed Human Task must bind the exact Proposal, Assessment, ChangeSet and execution");
    return { ...cloneJson(completion), executionId: execution.executionId, taskId: task.taskId };
  }

  finalize(ctx, input) {
    requirePermissions(ctx, ["state:read", "state:commit"]);
    return this.businessResult(ctx, () => {
      const registration = this.registration(ctx, input.correctionOperationId);
      const review = this.boundReview(ctx, input);
      const policyId = registration.input.pinned.classificationPolicyVersionId;
      const policy = policyPayload(this.controlPlane, policyId, "classification");
      authorizeActor(review.actor, policy.authorization ?? policy.review_authorization);
      return this.controlPlane.runIdempotent({ operationId: batchOperationKey(input.correctionOperationId, "finalization"), operationKind: "correction-batch.finalize", request: { requestFingerprint: registration.requestFingerprint, proposalId: input.proposalId, assessmentId: input.assessmentId, approvedChangeSetHash: input.approvedChangeSetHash, review } }, () => {
        const changeSet = this.readChangeSet(registration, batchOperationKey(input.correctionOperationId, "change-set"), input.approvedChangeSetHash);
        const proposal = this.controlPlane.readProposal(input.proposalId);
        assertProposalIntegrity(this.controlPlane, proposal, changeSet, input.assessmentId);
        const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", batchOperationKey(input.correctionOperationId, "decision")), proposalId: input.proposalId,
          outcome: review.outcome === "accept" ? "accepted" : "rejected", authorityKind: "human", authorityRef: review.actor.actorId, transitionPolicyVersionId: policyId, rationale: review.result.rationale });
        if (decision.outcome === "rejected") return this.result(ctx, "rejected", { proposalId: input.proposalId, decisionId: decision.decisionId });
        const handler = typedClassificationHandler();
        handler.preflight = () => {
          assertProposalIntegrity(this.controlPlane, this.controlPlane.readProposal(input.proposalId), changeSet, input.assessmentId);
          const snapshot = loadSnapshot(this.controlPlane, registration.input);
          verifyBatchProvenance(this.controlPlane, this.artifactStore, registration.input, snapshot);
          assertSameChangeSet(buildBatchCorrectionChangeSet({ request: registration.input, ...snapshot }), changeSet);
        };
        const commit = this.controlPlane.commitProposal({ proposalId: input.proposalId, decisionId: decision.decisionId, operationId: batchOperationKey(input.correctionOperationId, "commit"), noOpPolicy: "semantic-and-dependencies", domainHandler: handler });
        if (commit.stateResult !== "committed") fail("BATCH_INTEGRITY_ERROR", "valid batch must create one changed Classification Version");
        return this.result(ctx, "committed", { classificationVersionId: commit.versionId, proposalId: input.proposalId, decisionId: decision.decisionId });
      });
    });
  }
}

export function readBatchCorrectionReviewSummary(controlPlane, { proposalId, assessmentId }) {
  return controlPlane._transaction(() => {
    const proposal = controlPlane.readProposal(proposalId);
    const metadata = proposal?.payload?.correctionBatch;
    const saved = controlPlane.readReceipt(metadata?.changeSetId)?.result;
    if (!saved || correctionChangeSetHash(saved) !== metadata.changeSetHash) fail("BATCH_INTEGRITY_ERROR", "review ChangeSet differs");
    assertProposalIntegrity(controlPlane, proposal, saved, assessmentId);
    return { proposalId, assessmentId, ...cloneJson(reviewProjection(saved)) };
  });
}

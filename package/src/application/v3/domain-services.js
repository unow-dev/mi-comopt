import { canonicalJson, cloneJson, deterministicId, semanticSha256 } from "../../state/canonical.js";
import { StateControlPlaneError, stateError } from "../../state/errors.js";
import {
  STREAM_KEYS,
  normalizeLabels,
  normalizeKeywordEntries,
  policyPayload,
  readExactPolicyVersion,
  typedClassificationHandler,
  typedKeywordHandler,
  typedCorpusHandler,
} from "../services.js";
import { v3StepResult } from "./result.js";
import { runV3Idempotent } from "./context.js";

function requireContext(context, permissions = []) {
  if (!context || typeof context !== "object" || typeof context.operationId !== "string") throw stateError("VALIDATION_ERROR", "v3 OperationContext is required");
  const supplied = context.permissions ?? [];
  if (context.actor?.actorType !== "system" && permissions.some((permission) => !supplied.includes(permission))) throw stateError("PERMISSION_DENIED", `operation requires permissions: ${permissions.join(", ")}`);
}

function stream(controlPlane, stream) { return controlPlane.ensureStream(stream); }

function versionInStream(controlPlane, versionId, expected, name, { nullable = true } = {}) {
  if (versionId === null || versionId === undefined) {
    if (nullable) return null;
    throw stateError("VERSION_REQUIRED", `${name} is required`);
  }
  if (typeof versionId !== "string" || versionId.length === 0) throw stateError("VERSION_INVALID", `${name} must be a non-empty Version ID`);
  const version = controlPlane.readVersion(versionId);
  if (!version || version.domain !== expected.domain || version.streamKey !== expected.streamKey) throw stateError("VERSION_STREAM_MISMATCH", `${name} references the wrong stream`);
  return version;
}

function currentHead(controlPlane, streamRecord) { return controlPlane.resolveHead(streamRecord.stream_id); }

function assertExpectedHead(controlPlane, streamRecord, expectedHeadVersionId) {
  const actual = currentHead(controlPlane, streamRecord)?.versionId ?? null;
  if (actual !== (expectedHeadVersionId ?? null)) throw stateError("HEAD_CONFLICT", `expected head ${expectedHeadVersionId ?? "null"} but actual head is ${actual ?? "null"}`);
  return actual;
}

function dependenciesEqual(left, right) { return canonicalJson(left ?? []) === canonicalJson(right ?? []); }

function policyAllowsAutoCommit(policy, request) {
  if (request.autoCommit === false || request.requiresReview === true) return false;
  return request.autoCommit === true || policy.auto_commit === true || policy.autoCommit === true || policy.transition?.automated === true;
}

function authorizedReview(review, policy) {
  if (!review || !["accept", "reject"].includes(review.outcome)) throw stateError("INVALID_REVIEW_OUTCOME", "human review outcome must be accept or reject");
  if (!review.actor || review.actor.actorType !== "human" || typeof review.actor.actorId !== "string" || review.actor.actorId.length === 0) throw stateError("UNAUTHORIZED_ACTOR", "a human review actor is required");
  const authorization = policy.authorization ?? policy.review_authorization ?? {};
  if (Array.isArray(authorization.allowed_actor_ids) && !authorization.allowed_actor_ids.includes(review.actor.actorId)) throw stateError("UNAUTHORIZED_ACTOR", "the review actor is not authorized");
  if (Array.isArray(authorization.allowed_actor_types) && !authorization.allowed_actor_types.includes(review.actor.actorType)) throw stateError("UNAUTHORIZED_ACTOR", "the review actor type is not authorized");
}

function artifactWrite(artifactStore, { artifactId, logicalPath, content, metadata = {} }) {
  if (!artifactStore || typeof artifactStore.write !== "function") return { artifactVersionId: artifactId, logicalPath, blobHash: semanticSha256(content), size: Buffer.from(content).length, ...metadata };
  const result = artifactStore.write({ artifactVersionId: artifactId, artifactKey: artifactId, logicalPath, content, metadata });
  return { artifactVersionId: result.artifactVersionId ?? artifactId, logicalPath: result.logicalPath ?? logicalPath, blobHash: result.blobHash ?? result.sha256?.replace(/^sha256:/, ""), size: result.size ?? result.byteLength ?? Buffer.from(content).length, ...metadata };
}

function routeConflict(stepId, conflictAt, refs = {}) { return v3StepResult({ stepId, routingOutcome: "superseded", stateResult: "conflict", refs, details: { conflictAt } }); }

export class EvidenceApplicationServiceV3 {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  ingest(ctx, request = {}) {
    requireContext(ctx, ["evidence:write"]);
    const run = () => {
      const artifact = request.inputArtifact ?? request.artifact;
      const payload = request.commentBatch ?? request.payload;
      if (!artifact || typeof artifact !== "object") throw stateError("ARTIFACT_REQUIRED", "the accepted input ArtifactVersion is required");
      const evidenceId = request.evidenceId ?? deterministicId("evidence", `${artifact.artifactVersionId}:${artifact.blobHash}`);
      const snapshotIndex = request.snapshotIndex ?? 0;
      const snapshotRef = { payloadSha256: artifact.blobHash?.replace(/^sha256:/, ""), snapshotIndex };
      this.controlPlane.recordEvidence({ evidenceId, sourceKind: "tiktokCommentBatch", sourceRef: artifact.artifactVersionId, payload: payload ?? { artifactVersionId: artifact.artifactVersionId, snapshotRef }, evidenceSha256: snapshotRef.payloadSha256, operationId: `${ctx.operationId}/evidence` });
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "succeeded", refs: { evidenceIds: [evidenceId], snapshotRef } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.evidence.ingest", request, run);
  }
}

export class CorpusApplicationServiceV3 {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  update(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:propose", "state:auto-decide", "state:commit"]);
    const run = () => {
      const target = stream(this.controlPlane, STREAM_KEYS.corpus);
      const expected = request.initialCorpusVersionId ?? null;
      versionInStream(this.controlPlane, expected, STREAM_KEYS.corpus, "initialCorpusVersionId");
      const policy = readExactPolicyVersion(this.controlPlane, request.corpusPolicyVersionId, "corpus");
      const state = cloneJson(request.state ?? { snapshot_refs: request.snapshotRefs ?? [], evidence_ids: request.evidenceIds ?? [] });
      if (state.schema_version === undefined && state.schemaVersion === undefined) state.schema_version = 1;
      const semanticHash = semanticSha256(state);
      const prior = expected ? this.controlPlane.readVersion(expected) : null;
      if (prior && prior.semanticSha256 === semanticHash) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "unchanged", refs: { corpusVersionId: prior.versionId } });
      const proposalId = deterministicId("proposal", `${ctx.operationId}:corpus`);
      try {
        this.controlPlane.createProposal({ proposalId, streamId: target.stream_id, expectedHeadVersionId: expected, proposedSemanticSha256: semanticHash, payload: { schema_version: 1, state }, dependencies: [{ role: "policy", versionId: policy.versionId }], assessmentRefs: { evidenceIds: request.evidenceIds ?? [] }, operationId: `${ctx.operationId}/proposal` });
        const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:corpus`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "corpus-policy", transitionPolicyVersionId: policy.versionId, operationId: `${ctx.operationId}/decision` });
        const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: `${ctx.operationId}/commit`, domainHandler: typedCorpusHandler(), noOpPolicy: "semantic-and-dependencies" });
        return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "committed", refs: { corpusVersionId: commit.versionId, proposalId, decisionId: commit.decisionId } });
      } catch (error) {
        if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return routeConflict(ctx.stepId, "corpus");
        throw error;
      }
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.corpus.update", request, run);
  }
}

class HandoffBase {
  constructor(controlPlane, artifactStore) { this.controlPlane = controlPlane; this.artifactStore = artifactStore; }

  writeArtifact({ id, logicalPath, content, metadata }) { return artifactWrite(this.artifactStore, { artifactId: id, logicalPath, content, metadata }); }
}

export class ClassificationHandoffService extends HandoffBase {
  prepare(ctx, request = {}) {
    requireContext(ctx, ["state:read", "artifact:write"]);
    const run = () => {
      versionInStream(this.controlPlane, request.corpusVersionId, STREAM_KEYS.corpus, "corpusVersionId", { nullable: false });
      const policy = readExactPolicyVersion(this.controlPlane, request.classificationPolicyVersionId, "classification");
      const prior = versionInStream(this.controlPlane, request.classificationVersionId, STREAM_KEYS.classification, "classificationVersionId");
      const unresolved = Number(request.unresolvedTargetCount ?? request.unresolvedTargets?.length ?? prior?.payload?.state?.unresolved_target_count ?? 0);
      const contextFingerprint = semanticSha256({ corpusVersionId: request.corpusVersionId, classificationVersionId: request.classificationVersionId ?? null, classificationPolicyVersionId: policy.versionId });
      if (prior && prior.payload?.handoffContextFingerprint === contextFingerprint) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "reuse", stateResult: "reused", refs: { classificationVersionId: prior.versionId } });
      if (unresolved === 0) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "ready_without_handoff", stateResult: "succeeded", refs: {} });
      const worksetId = request.worksetId ?? deterministicId("workset", `${ctx.operationId}:${contextFingerprint}`);
      const bytes = request.worksetBytes ?? Buffer.from(canonicalJson({ protocol: "three-class-workset-v1", worksetId, corpusVersionId: request.corpusVersionId }), "utf8");
      const artifact = this.writeArtifact({ id: worksetId, logicalPath: "three-class-workset.zip", content: bytes, metadata: { worksetId } });
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "handoff_required", stateResult: "created", refs: { worksetId }, details: { artifact, contextFingerprint } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.classification.handoff.prepare", request, run);
  }
}

function stateFromResponse(request, prior, normalize) {
  const value = request.proposedState ?? request.state ?? request.response?.state ?? request.response?.payload ?? prior?.payload?.state ?? (normalize === normalizeLabels ? { schema_version: 1, labels: [] } : { schema_version: 1, entries: [] });
  return normalize(value);
}

class ReviewableV3Service {
  constructor(controlPlane, { domain, streamKey, policyKind, resultRef, stepId, normalizer, handler, dependencyRoles }) {
    this.controlPlane = controlPlane; this.streamKey = streamKey; this.policyKind = policyKind; this.resultRef = resultRef; this.stepId = stepId; this.normalizer = normalizer; this.handler = handler; this.dependencyRoles = dependencyRoles;
  }

  assess(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:propose"]);
    const run = () => {
      const target = stream(this.controlPlane, this.streamKey);
      const priorId = request[`${this.resultRef}VersionId`] ?? request.priorVersionId ?? null;
      const prior = versionInStream(this.controlPlane, priorId, this.streamKey, `${this.resultRef}VersionId`);
      const policyField = this.policyKind === "keyword-selection" ? "keywordPolicyVersionId" : `${this.policyKind}PolicyVersionId`;
      const policyId = request[policyField] ?? request.policyVersionId;
      const policy = readExactPolicyVersion(this.controlPlane, policyId, this.policyKind);
      const state = stateFromResponse(request, prior, this.normalizer);
      const assessmentId = request.assessmentId ?? deterministicId("assessment", `${ctx.operationId}:${this.domain}`);
      const dependencies = [
        { role: "corpus", versionId: request.corpusVersionId },
        ...(this.resultRef === "keywordSelection" ? [{ role: "classification", versionId: request.classificationVersionId }] : []),
        { role: "policy", versionId: policy.versionId },
      ].filter((item) => item.versionId !== undefined && item.versionId !== null);
      const inputFingerprint = semanticSha256({ corpusVersionId: request.corpusVersionId, classificationVersionId: request.classificationVersionId ?? null, policyVersionId: policy.versionId, priorVersionId: priorId, state });
      this.controlPlane.recordAssessment({ assessmentId, streamId: target.stream_id, inputFingerprint, payload: { schema_version: 1, state }, operationId: `${ctx.operationId}/assessment` });
      const semanticHash = semanticSha256(state);
      const samePayload = prior && prior.semanticSha256 === semanticHash;
      const sameDependencies = prior && dependenciesEqual(this.controlPlane.readDependencies(prior.versionId), dependencies);
      if (samePayload && sameDependencies) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "unchanged", refs: { assessmentId, [this.resultRef + "VersionId"]: prior.versionId } });
      const proposalId = deterministicId("proposal", `${ctx.operationId}:${this.domain}`);
      try {
        this.controlPlane.createProposal({ proposalId, streamId: target.stream_id, expectedHeadVersionId: priorId, proposedSemanticSha256: semanticHash, payload: { schema_version: 1, state }, dependencies, assessmentRefs: { assessmentId }, operationId: `${ctx.operationId}/proposal` });
      } catch (error) {
        if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return routeConflict(ctx.stepId, this.domain);
        throw error;
      }
      // A dependency-only refresh may be system-committed when the pinned
      // policy explicitly authorizes it. A semantic payload change always
      // stays reviewable, regardless of request flags.
      if (samePayload && policyAllowsAutoCommit(policy.payload?.state ?? policy.payload ?? {}, request)) {
        requireContext(ctx, ["state:auto-decide", "state:commit"]);
        const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:${this.domain}`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: `${this.domain}-policy`, transitionPolicyVersionId: policy.versionId, operationId: `${ctx.operationId}/decision` });
        const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: `${ctx.operationId}/commit`, noOpPolicy: "semantic-and-dependencies", domainHandler: this.handler() });
        return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "committed", refs: { assessmentId, proposalId, decisionId: commit.decisionId, [this.resultRef + "VersionId"]: commit.versionId } });
      }
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "review_required", stateResult: "review_required", refs: { assessmentId, proposalId } });
    };
    return runV3Idempotent(this.controlPlane, ctx, `comment-data-update.v3.${this.domain}.assess`, request, run);
  }

  finalize(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:commit"]);
    const run = () => {
      if (!request.proposalId && request.assessed?.refs?.[this.resultRef + "VersionId"]) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "reused", refs: { [this.resultRef + "VersionId"]: request.assessed.refs[this.resultRef + "VersionId"] } });
      const proposal = this.controlPlane.readProposal(request.proposalId);
      if (!proposal) throw stateError("PROPOSAL_NOT_FOUND", `${this.domain} proposal is required`);
      const policyId = proposal.dependencies.find((item) => item.role === "policy")?.versionId;
      const policyVersion = readExactPolicyVersion(this.controlPlane, policyId, this.policyKind);
      const policy = policyPayload(this.controlPlane, policyVersion.versionId, this.policyKind);
      const review = request.review;
      authorizedReview(review, policy);
      const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:${proposal.proposalId}`), proposalId: proposal.proposalId, outcome: review.outcome === "accept" ? "accepted" : "rejected", authorityKind: "human", authorityRef: review.actor.actorId, transitionPolicyVersionId: policyVersion.versionId, rationale: review.rationale ?? null, operationId: `${ctx.operationId}/decision` });
      if (decision.outcome === "rejected") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "rejected", stateResult: "rejected", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId } });
      try {
        const commit = this.controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: `${ctx.operationId}/commit`, noOpPolicy: "semantic-and-dependencies", domainHandler: this.handler() });
        return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: commit.stateResult === "unchanged" ? "reused" : "committed", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId, [this.resultRef + "VersionId"]: commit.versionId } });
      } catch (error) {
        if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId }, details: { conflictAt: this.domain } });
        throw error;
      }
    };
    return runV3Idempotent(this.controlPlane, ctx, `comment-data-update.v3.${this.domain}.finalize`, request, run);
  }
}

export class ClassificationApplicationServiceV3 extends ReviewableV3Service {
  constructor(controlPlane) { super(controlPlane, { domain: "classification", streamKey: STREAM_KEYS.classification, policyKind: "classification", resultRef: "classification", stepId: "03-update-classification", normalizer: normalizeLabels, handler: typedClassificationHandler, dependencyRoles: ["corpus", "policy"] }); }
}

export class KeywordSelectionApplicationServiceV3 extends ReviewableV3Service {
  constructor(controlPlane) { super(controlPlane, { domain: "keyword-selection", streamKey: STREAM_KEYS.keywordSelection, policyKind: "keyword-selection", resultRef: "keywordSelection", stepId: "07-update-keyword-selection", normalizer: normalizeKeywordEntries, handler: typedKeywordHandler, dependencyRoles: ["corpus", "classification", "policy"] }); }
}

export class KeywordHandoffService extends HandoffBase {
  prepare(ctx, request = {}) {
    requireContext(ctx, ["state:read", "artifact:write"]);
    const run = () => {
      versionInStream(this.controlPlane, request.corpusVersionId, STREAM_KEYS.corpus, "corpusVersionId", { nullable: false });
      versionInStream(this.controlPlane, request.classificationVersionId, STREAM_KEYS.classification, "classificationVersionId", { nullable: false });
      const policy = readExactPolicyVersion(this.controlPlane, request.keywordPolicyVersionId, "keyword-selection");
      const prior = versionInStream(this.controlPlane, request.keywordSelectionVersionId, STREAM_KEYS.keywordSelection, "keywordSelectionVersionId");
      const candidateInputFingerprint = semanticSha256({ corpusVersionId: request.corpusVersionId, classificationVersionId: request.classificationVersionId, keywordSelectionVersionId: request.keywordSelectionVersionId ?? null, keywordPolicyVersionId: policy.versionId, candidateInput: request.candidateInput ?? null });
      if (prior && prior.payload?.candidateInputFingerprint === candidateInputFingerprint) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "reuse", stateResult: "reused", refs: { keywordSelectionVersionId: prior.versionId } });
      const candidateRequestId = request.candidateRequestId ?? deterministicId("candidate-request", `${ctx.operationId}:${candidateInputFingerprint}`);
      const bytes = request.handoffBytes ?? Buffer.from(canonicalJson({ requestId: candidateRequestId, inputFingerprint: candidateInputFingerprint }), "utf8");
      const artifact = this.writeArtifact({ id: candidateRequestId, logicalPath: "keyword-candidate-handoff.zip", content: bytes, metadata: { candidateRequestId, candidateInputFingerprint } });
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "handoff_required", stateResult: "created", refs: { candidateRequestId, candidateInputFingerprint }, details: { artifact } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.keyword-selection.handoff.prepare", request, run);
  }
}

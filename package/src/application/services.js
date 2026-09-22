import { deterministicId, canonicalJson, cloneJson, prefixedSha256, semanticSha256, newId } from "../state/canonical.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { StateQueryService } from "../state/query.js";

export const STREAM_KEYS = Object.freeze({
  corpus: { domain: "corpus", streamKey: "comments" },
  classification: { domain: "classification", streamKey: "comments" },
  keywordSelection: { domain: "keyword-selection", streamKey: "filter-keywords" },
  promotion: { domain: "promotion", streamKey: "production" },
  deployment: { domain: "deployment", streamKey: "production" },
  corpusPolicy: { domain: "policy", streamKey: "corpus" },
  classificationPolicy: { domain: "policy", streamKey: "classification" },
  keywordPolicy: { domain: "policy", streamKey: "keyword-selection" },
  accountPolicy: { domain: "policy", streamKey: "account-candidate" },
  promotionPolicy: { domain: "policy", streamKey: "promotion-production" },
  deploymentPolicy: { domain: "policy", streamKey: "deployment-production" },
  projectionDefinition: { domain: "projection-definition", streamKey: "release" },
});

const POLICY_STREAMS = Object.freeze({
  corpus: STREAM_KEYS.corpusPolicy,
  classification: STREAM_KEYS.classificationPolicy,
  "keyword-selection": STREAM_KEYS.keywordPolicy,
  "account-candidate": STREAM_KEYS.accountPolicy,
  "promotion-production": STREAM_KEYS.promotionPolicy,
  "deployment-production": STREAM_KEYS.deploymentPolicy,
});

export const PERMISSIONS = Object.freeze([
  "evidence:write", "state:read", "state:propose", "state:auto-decide", "state:commit",
  "release:build", "artifact:write", "deployment:trigger", "deployment:verify",
]);

const LABELS = new Set(["normal", "reactive", "direct_nuisance"]);

function requireContext(context, permissions = []) {
  if (!context || typeof context !== "object") throw stateError("VALIDATION_ERROR", "OperationContext is required");
  for (const key of ["operationId", "workflowSessionId", "workDefinitionId", "stepId"]) {
    if (typeof context[key] !== "string" || context[key].length === 0) throw stateError("VALIDATION_ERROR", `OperationContext.${key} is required`);
  }
  const supplied = context.permissions ?? context.permissionSet ?? context.actor?.permissions;
  if (supplied === undefined && ["system", "service"].includes(context.actor?.actorType)) return;
  if (!Array.isArray(supplied) || permissions.some((permission) => !supplied.includes(permission))) {
    throw stateError("PERMISSION_DENIED", `operation requires permissions: ${permissions.join(", ")}`);
  }
}

function stepResult(stateResult, refs, input, output = undefined, details = undefined) {
  const result = { stateResult, refs: Object.fromEntries(Object.entries(refs).filter(([, value]) => value !== undefined)), inputFingerprint: semanticSha256(input) };
  if (output !== undefined) result.outputFingerprint = typeof output === "string" ? output : semanticSha256(output);
  if (details !== undefined) result.details = details;
  return result;
}

function asState(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw stateError("VALIDATION_ERROR", `${field} must be an object`);
  const state = cloneJson(value);
  if (state.schema_version === undefined && state.schemaVersion === undefined) state.schema_version = 1;
  return state;
}

export function isV2Context(context) {
  return Number(context?.workDefinitionRevision ?? 1) >= 2;
}

function policyKindAlias(policyKind) {
  return ({ keyword: "keyword-selection", keywordSelection: "keyword-selection", classificationPolicy: "classification", keywordPolicy: "keyword-selection", accountPolicy: "account-candidate", corpusPolicy: "corpus", promotion: "promotion-production", deployment: "deployment-production" })[policyKind] ?? policyKind;
}

export function policyStream(policyKind) {
  const kind = policyKindAlias(policyKind);
  const stream = POLICY_STREAMS[kind];
  if (!stream) throw stateError("POLICY_KIND_INVALID", `unsupported policy kind: ${policyKind}`);
  return stream;
}

export function readExactPolicyVersion(controlPlane, versionId, policyKind) {
  if (typeof versionId !== "string" || versionId.length === 0) throw stateError("EXPLICIT_VERSION_REQUIRED", `${policyKind} policy version ID is required`);
  const version = controlPlane.readVersion(versionId);
  if (!version) throw stateError("VERSION_NOT_FOUND", `policy version ${versionId} does not exist`);
  const expected = policyStream(policyKind);
  if (version.domain !== expected.domain || version.streamKey !== expected.streamKey) throw stateError("POLICY_VERSION_STREAM_MISMATCH", `${versionId} is not a ${policyKind} policy version`);
  return version;
}

function policyPayload(controlPlane, versionId, policyKind = undefined) {
  if (typeof versionId !== "string" || versionId.length === 0) throw stateError("EXPLICIT_VERSION_REQUIRED", `${policyKind ?? "policy"} policy version ID is required`);
  const version = policyKind ? readExactPolicyVersion(controlPlane, versionId, policyKind) : controlPlane.readVersion(versionId);
  if (!version) throw stateError("VERSION_NOT_FOUND", `policy version ${versionId} does not exist`);
  return cloneJson(version.payload?.state ?? version.payload ?? {});
}

export function ensurePolicyVersion(controlPlane, context, { policyKind, versionId = undefined } = {}) {
  const kind = policyKindAlias(policyKind);
  if (versionId !== undefined && versionId !== null) return readExactPolicyVersion(controlPlane, versionId, kind).versionId;
  const stream = getStream(controlPlane, policyStream(kind));
  const current = controlPlane.resolveHead(stream.stream_id);
  if (current) return current.versionId;
  if (isV2Context(context)) throw stateError("EXPLICIT_VERSION_REQUIRED", `${kind} policy version ID is required for work-definition revision 2`);
  const payload = { schema_version: 1, policy_kind: kind, legacy_compatibility: true, auto_commit: true };
  const legacyId = deterministicId("policy", `legacy:${kind}`);
  return controlPlane.createGenesis({
    streamId: stream.stream_id, versionId: legacyId, payload, operationId: `${context.operationId}/legacy-policy/${kind}`,
    domainHandler: { persist: ({ db, versionId: id }) => db.prepare("INSERT INTO policy_states (version_id, policy_kind, state_json) VALUES (?, ?, ?)").run(id, kind, canonicalJson(payload)) },
  }).versionId;
}

export function currentPolicyVersion(controlPlane, context, policyKind) {
  const kind = policyKindAlias(policyKind);
  const stream = getStream(controlPlane, policyStream(kind));
  const current = controlPlane.resolveHead(stream.stream_id);
  if (current) return current.versionId;
  return ensurePolicyVersion(controlPlane, context, { policyKind: kind });
}

function policyAllowsAutoCommit(policy, request) {
  if (request.autoCommit === false || request.requiresReview === true) return false;
  return request.autoCommit === true || policy.auto_commit === true || policy.autoCommit === true || policy.transition?.automated === true;
}

function actorIsAllowed(actor, policy) {
  if (!actor || actor.actorType !== "human") return false;
  const authorization = policy.authorization ?? policy.review_authorization ?? {};
  if (Array.isArray(authorization.allowed_actor_types) && !authorization.allowed_actor_types.includes(actor.actorType)) return false;
  if (Array.isArray(authorization.allowed_actor_ids) && !authorization.allowed_actor_ids.includes(actor.actorId)) return false;
  return true;
}

function validateReview(review, policy) {
  if (!review || !["accept", "reject"].includes(review.outcome)) throw stateError("INVALID_REVIEW_OUTCOME", "human review outcome must be accept or reject");
  if (!actorIsAllowed(review.actor, policy)) throw stateError("UNAUTHORIZED_ACTOR", "the review actor is not authorized by the Transition Policy");
}

function getStream(controlPlane, stream) {
  return controlPlane.ensureStream(stream);
}

function versionState(controlPlane, versionId) {
  if (!versionId) return null;
  const version = controlPlane.readVersion(versionId);
  return version?.payload?.state ?? version?.payload ?? null;
}

function normalizeLabels(state) {
  const input = state.labels ?? {};
  const labels = Array.isArray(input)
    ? input.map((item) => ({ observationId: String(item.observationId ?? item.observation_id), label: item.label }))
    : Object.entries(input).map(([observationId, label]) => ({ observationId: String(observationId), label }));
  for (const item of labels) {
    if (!item.observationId || !LABELS.has(item.label)) throw stateError("DOMAIN_VALIDATION_ERROR", "classification labels are invalid");
  }
  labels.sort((left, right) => left.observationId.localeCompare(right.observationId));
  return { ...state, labels };
}

function normalizeKeywordEntries(state) {
  const input = state.entries ?? [];
  if (!Array.isArray(input)) throw stateError("DOMAIN_VALIDATION_ERROR", "keyword selection entries must be an array");
  const entries = input.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.keyword !== "string" || entry.keyword.length === 0) throw stateError("DOMAIN_VALIDATION_ERROR", "keyword selection entry is invalid");
    return { ...cloneJson(entry), selection_state: entry.selection_state ?? entry.selectionState ?? "selected" };
  }).sort((left, right) => left.keyword.localeCompare(right.keyword));
  return { ...state, entries };
}

function assertDependencyRoles(db, proposal, allowedRoles, expectedPolicyKind = undefined) {
  for (const dependency of proposal.dependencies) {
    if (!allowedRoles.includes(dependency.role)) throw stateError("DEPENDENCY_ROLE_INVALID", `${proposal.streamId} does not allow dependency role ${dependency.role}`);
    const row = db.prepare("SELECT s.domain, s.stream_key FROM state_versions AS v JOIN state_streams AS s ON s.stream_id = v.stream_id WHERE v.version_id = ?").get(dependency.versionId);
    if (!row) throw stateError("DEPENDENCY_NOT_FOUND", `dependency ${dependency.versionId} does not exist`);
    if (dependency.role === "corpus" && (row.domain !== STREAM_KEYS.corpus.domain || row.stream_key !== STREAM_KEYS.corpus.streamKey)) throw stateError("DEPENDENCY_ROLE_INVALID", "corpus dependency must reference the corpus/comments stream");
    if (dependency.role === "classification" && (row.domain !== STREAM_KEYS.classification.domain || row.stream_key !== STREAM_KEYS.classification.streamKey)) throw stateError("DEPENDENCY_ROLE_INVALID", "classification dependency must reference the classification/comments stream");
    if (dependency.role === "policy" && row.domain !== "policy") throw stateError("DEPENDENCY_ROLE_INVALID", "policy dependency must reference a Policy version");
    if (dependency.role === "policy" && expectedPolicyKind) {
      const expected = policyStream(expectedPolicyKind);
      if (row.domain !== expected.domain || row.stream_key !== expected.streamKey) throw stateError("DEPENDENCY_ROLE_INVALID", `policy dependency must reference the ${expectedPolicyKind} policy stream`);
    }
  }
}

export function typedClassificationHandler() {
  return {
    validate({ db, proposal }) { const state = normalizeLabels(proposal.payload.state); if (semanticSha256(state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "classification semantic fingerprint is invalid"); assertDependencyRoles(db, proposal, ["corpus", "policy"], "classification"); },
    persist({ db, versionId, proposal }) {
      const state = normalizeLabels(proposal.payload.state);
      db.prepare("INSERT INTO classification_states (version_id, state_json) VALUES (?, ?)").run(versionId, canonicalJson(state));
      const insert = db.prepare("INSERT INTO classification_state_labels (version_id, observation_id, label) VALUES (?, ?, ?)");
      for (const item of state.labels) insert.run(versionId, item.observationId, item.label);
    },
  };
}

export function typedKeywordHandler() {
  return {
    validate({ db, proposal }) { const state = normalizeKeywordEntries(proposal.payload.state); if (semanticSha256(state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "keyword selection semantic fingerprint is invalid"); assertDependencyRoles(db, proposal, ["corpus", "classification", "policy"], "keyword-selection"); },
    persist({ db, versionId, proposal }) {
      const state = normalizeKeywordEntries(proposal.payload.state);
      db.prepare("INSERT INTO keyword_selection_states (version_id, state_json) VALUES (?, ?)").run(versionId, canonicalJson(state));
      const insert = db.prepare("INSERT INTO keyword_selection_entries (version_id, keyword, selection_state, entry_json) VALUES (?, ?, ?, ?)");
      for (const item of state.entries) insert.run(versionId, item.keyword, item.selection_state, canonicalJson(item));
    },
  };
}

export function typedCorpusHandler() {
  return {
    validate({ proposal }) { const state = asState(proposal.payload.state, "corpus state"); if (semanticSha256(state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "corpus semantic fingerprint is invalid"); },
    persist({ db, versionId, proposal }) {
      const state = asState(proposal.payload.state, "corpus state");
      db.prepare("INSERT INTO corpus_states (version_id, state_json) VALUES (?, ?)").run(versionId, canonicalJson(state));
      for (const snapshotRef of state.snapshot_refs ?? state.snapshotRefs ?? []) {
        const serialized = typeof snapshotRef === "string" ? snapshotRef : canonicalJson(snapshotRef);
        db.prepare("INSERT INTO corpus_state_snapshots (version_id, snapshot_ref) VALUES (?, ?)").run(versionId, serialized);
      }
    },
  };
}

function readVersionInStream(controlPlane, versionId, stream, role) {
  if (versionId === null || versionId === undefined) return null;
  const version = controlPlane.readVersion(versionId);
  if (!version || version.domain !== stream.domain || version.streamKey !== stream.streamKey) throw stateError("VERSION_STREAM_MISMATCH", `${role} must reference ${stream.domain}/${stream.streamKey}`);
  return version;
}

function typedPolicyHandler(policyKind) {
  return {
    validate({ proposal }) {
      if (!proposal.payload.state || typeof proposal.payload.state !== "object") throw stateError("DOMAIN_VALIDATION_ERROR", `${policyKind} policy state is invalid`);
      if (semanticSha256(proposal.payload.state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", `${policyKind} policy semantic fingerprint is invalid`);
    },
    persist({ db, versionId, proposal }) {
      db.prepare("INSERT INTO policy_states (version_id, policy_kind, state_json) VALUES (?, ?, ?)").run(versionId, policyKind, canonicalJson(proposal.payload.state));
    },
  };
}

export class PolicyApplicationService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  register(ctx, { policyKind, policy, versionId = undefined }) {
    requireContext(ctx, ["state:commit"]);
    const stream = policyKind === "projection-definition" ? STREAM_KEYS.projectionDefinition : policyStream(policyKind);
    const streamRecord = getStream(this.controlPlane, stream);
    const payload = asState(policy, "policy");
    const semanticHash = semanticSha256(payload);
    const current = this.controlPlane.resolveHead(streamRecord.stream_id);
    const targetVersionId = versionId ?? (current ? newId("policy") : deterministicId("policy", `${policyKind}:${semanticHash}`));
    if (!current) return this.controlPlane.createGenesis({
      streamId: streamRecord.stream_id, versionId: targetVersionId, payload, operationId: ctx.operationId,
      domainHandler: { persist: ({ db, versionId: id }) => db.prepare("INSERT INTO policy_states (version_id, policy_kind, state_json) VALUES (?, ?, ?)").run(id, policyKind, canonicalJson(payload)) },
    });
    if (current.semanticSha256 === semanticHash) return { stateResult: "unchanged", versionId: current.versionId, semanticSha256: current.semanticSha256 };
    const proposalId = deterministicId("proposal", `${ctx.operationId}:policy:${policyKind}`);
    this.controlPlane.createProposal({ proposalId, streamId: streamRecord.stream_id, expectedHeadVersionId: current.versionId, proposedSemanticSha256: semanticHash, payload: { schema_version: 1, state: payload, domain: "policy", policyKind }, operationId: `${ctx.operationId}/proposal` });
    const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:policy:${policyKind}`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "policy-registry", transitionPolicyVersionId: current.versionId, operationId: `${ctx.operationId}/decision` });
    return this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, versionId: targetVersionId, operationId: ctx.operationId, domainHandler: typedPolicyHandler(policyKind) });
  }
}

export class EvidenceApplicationService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  ingest(ctx, request = {}) {
    requireContext(ctx, ["evidence:write"]);
    const evidence = Array.isArray(request.evidence) && request.evidence.length > 0
      ? request.evidence
      : [{ kind: request.evidenceSource?.kind ?? "external", sourceRef: request.evidenceSource?.sourceRef ?? request.sourceRef ?? "unspecified", payload: request.payload ?? {} }];
    const ids = [];
    for (const [index, item] of evidence.entries()) {
      const sourceKind = item.kind ?? item.sourceKind;
      const sourceRef = item.sourceRef;
      if (typeof sourceKind !== "string" || typeof sourceRef !== "string" || sourceRef.length === 0) throw stateError("VALIDATION_ERROR", "evidence source is invalid");
      const evidenceId = item.evidenceId ?? deterministicId("evidence", `${sourceKind}:${sourceRef}:${semanticSha256(item.payload ?? item)}`);
      this.controlPlane.recordEvidence({
        evidenceId, sourceKind, sourceRef, payload: item.payload ?? item,
        operationId: `${ctx.operationId}/${index + 1}`,
      });
      ids.push(evidenceId);
    }
    return stepResult("succeeded", { evidenceIds: ids }, request, { evidenceIds: ids });
  }
}

export class CorpusApplicationService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  update(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:propose", "state:auto-decide", "state:commit"]);
    const stream = getStream(this.controlPlane, STREAM_KEYS.corpus);
    const corpusPolicyVersionId = ensurePolicyVersion(this.controlPlane, ctx, { policyKind: "corpus", versionId: request.corpusPolicyVersionId ?? request.policyVersionId });
    const baseVersionId = request.initialCorpusVersionId ?? request.corpusVersionId ?? null;
    const state = asState(request.state ?? { snapshot_refs: request.snapshotRefs ?? [], evidence_ids: request.evidenceIds ?? [] }, "corpus state");
    const semanticHash = semanticSha256(state);
    const base = readVersionInStream(this.controlPlane, baseVersionId, STREAM_KEYS.corpus, "initialCorpusVersionId");
    if (base && base.semanticSha256 === semanticHash) return stepResult("unchanged", { corpusVersionId: base.versionId }, request, semanticHash, { outcome: "continue" });
    const proposalId = deterministicId("proposal", `${ctx.operationId}:corpus`);
    try {
      this.controlPlane.createProposal({
        proposalId, streamId: stream.stream_id, expectedHeadVersionId: baseVersionId,
        proposedSemanticSha256: semanticHash, payload: { schema_version: 1, state },
        dependencies: [{ role: "policy", versionId: corpusPolicyVersionId }],
        assessmentRefs: { evidenceIds: request.evidenceIds ?? [] }, operationId: `${ctx.operationId}/proposal`,
      });
      const decision = this.controlPlane.createDecision({
        decisionId: deterministicId("decision", `${ctx.operationId}:corpus`), proposalId, outcome: "accepted",
        authorityKind: "system_policy", authorityRef: "corpus-policy", transitionPolicyVersionId: corpusPolicyVersionId,
        operationId: `${ctx.operationId}/decision`,
      });
      const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: ctx.operationId, domainHandler: typedCorpusHandler() });
      return stepResult(commit.stateResult, { corpusVersionId: commit.versionId, proposalId, decisionId: commit.decisionId }, request, commit.semanticSha256, { outcome: commit.stateResult === "unchanged" ? "continue" : "continue" });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return stepResult("conflict", { corpusVersionId: baseVersionId }, request, undefined, { outcome: "superseded", conflictAt: "corpus" });
      throw error;
    }
  }
}

class ReviewableStateService {
  constructor(controlPlane, { domain, stream, policyKey, resultRef, handler, stateNormalizer }) {
    this.controlPlane = controlPlane;
    this.domain = domain;
    this.stream = stream;
    this.policyKey = policyKey;
    this.resultRef = resultRef;
    this.handler = handler;
    this.stateNormalizer = stateNormalizer;
  }

  async assess(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:propose"]);
    const stream = getStream(this.controlPlane, this.stream);
    const priorVersionId = request[`${this.resultRef}VersionId`] ?? request.baseVersionId ?? null;
    readVersionInStream(this.controlPlane, priorVersionId, this.stream, `${this.resultRef}VersionId`);
    const suppliedPolicyVersionId = request.policyVersionId ?? request[`${this.policyKey}PolicyVersionId`];
    const policyKind = this.policyKey === "keyword" ? "keyword-selection" : this.policyKey;
    const policyVersionId = ensurePolicyVersion(this.controlPlane, ctx, { policyKind, versionId: suppliedPolicyVersionId });
    const policy = policyPayload(this.controlPlane, policyVersionId, policyKind);
    const input = { ...request, priorVersionId, policyVersionId };
    let assessment = request.assessment ?? {};
    if (typeof request.assessor === "function") assessment = await request.assessor({ request: cloneJson(request), priorVersionId, policyVersionId });
    const stateCandidate = assessment.proposedState ?? request.proposedState ?? request.state ?? versionState(this.controlPlane, priorVersionId) ?? (this.domain === "classification" ? { schema_version: 1, labels: [] } : { schema_version: 1, entries: [] });
    const normalizedState = this.stateNormalizer(asState(stateCandidate, `${this.domain} state`));
    const inputFingerprint = semanticSha256({ input, state: normalizedState });
    const assessmentId = assessment.assessmentId ?? deterministicId("assessment", `${ctx.operationId}:${this.domain}`);
    this.controlPlane.recordAssessment({ assessmentId, streamId: stream.stream_id, inputFingerprint, payload: { schema_version: 1, state: normalizedState, assessment: assessment.details ?? {} }, operationId: `${ctx.operationId}/assessment` });
    const prior = priorVersionId ? this.controlPlane.readVersion(priorVersionId) : null;
    const semanticHash = semanticSha256(normalizedState);
    if (prior && prior.semanticSha256 === semanticHash) return stepResult("unchanged", { [this.resultRef + "VersionId"]: prior.versionId, assessmentId }, input, semanticHash, { outcome: "continue" });
    const proposalId = deterministicId("proposal", `${ctx.operationId}:${this.domain}`);
    try {
      this.controlPlane.createProposal({
        proposalId, streamId: stream.stream_id, expectedHeadVersionId: priorVersionId,
        proposedSemanticSha256: semanticHash, payload: { schema_version: 1, state: normalizedState, domain: this.domain },
        dependencies: [
          request.corpusVersionId ? { role: "corpus", versionId: request.corpusVersionId } : null,
          policyVersionId ? { role: "policy", versionId: policyVersionId } : null,
          this.domain === "keyword-selection" && request.classificationVersionId ? { role: "classification", versionId: request.classificationVersionId } : null,
        ].filter(Boolean),
        assessmentRefs: { assessmentId, evidenceIds: request.evidenceIds ?? [] }, operationId: `${ctx.operationId}/proposal`,
      });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return stepResult("conflict", { assessmentId }, input, undefined, { outcome: "superseded", conflictAt: this.domain });
      throw error;
    }
    if (!policyAllowsAutoCommit(policy, request)) return stepResult("review_required", { assessmentId, proposalId }, input, semanticHash, { outcome: "review_required" });
    requireContext(ctx, ["state:auto-decide", "state:commit"]);
    const decision = this.controlPlane.createDecision({
      decisionId: deterministicId("decision", `${ctx.operationId}:${this.domain}`), proposalId, outcome: "accepted",
      authorityKind: "system_policy", authorityRef: `${this.domain}-policy`, transitionPolicyVersionId: policyVersionId, operationId: `${ctx.operationId}/decision`,
    });
    const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: ctx.operationId, domainHandler: this.handler() });
    return stepResult(commit.stateResult, { assessmentId, proposalId, decisionId: commit.decisionId, [this.resultRef + "VersionId"]: commit.versionId }, input, commit.semanticSha256, { outcome: "continue" });
  }

  finalize(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:commit"]);
    const proposal = this.controlPlane.readProposal(request.proposalId);
    if (!proposal || proposal.streamId !== getStream(this.controlPlane, this.stream).stream_id) throw stateError("PROPOSAL_NOT_FOUND", `proposal ${request.proposalId} is not a ${this.domain} proposal`);
    const policyKind = this.policyKey === "keyword" ? "keyword-selection" : this.policyKey;
    const proposalPolicyVersionId = proposal.dependencies.find((item) => item.role === "policy")?.versionId;
    const requestedPolicyVersionId = request.transitionPolicyVersionId ?? request.policyVersionId;
    if (proposalPolicyVersionId && requestedPolicyVersionId && proposalPolicyVersionId !== requestedPolicyVersionId) throw stateError("POLICY_VERSION_MISMATCH", `${this.domain} finalization must use the policy pinned by its proposal`);
    const policyVersionId = ensurePolicyVersion(this.controlPlane, ctx, { policyKind, versionId: proposalPolicyVersionId ?? requestedPolicyVersionId });
    const policy = policyPayload(this.controlPlane, policyVersionId, policyKind);
    validateReview(request.review, policy);
    const decisionId = deterministicId("decision", `${ctx.operationId}:${proposal.proposalId}`);
    const decision = this.controlPlane.createDecision({
      decisionId, proposalId: proposal.proposalId, outcome: request.review.outcome === "accept" ? "accepted" : "rejected",
      authorityKind: "human", authorityRef: request.review.actor.actorId, transitionPolicyVersionId: policyVersionId,
      rationale: request.review.rationale ?? null, operationId: `${ctx.operationId}/decision`,
    });
    if (decision.outcome === "rejected") return stepResult("rejected", { proposalId: proposal.proposalId, decisionId }, request, undefined, { outcome: "rejected", domain: this.domain });
    try {
      const commit = this.controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId, operationId: ctx.operationId, domainHandler: this.handler() });
      return stepResult(commit.stateResult, { proposalId: proposal.proposalId, decisionId, [this.resultRef + "VersionId"]: commit.versionId }, request, commit.semanticSha256, { outcome: "continue" });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return stepResult("conflict", { proposalId: proposal.proposalId, decisionId }, request, undefined, { outcome: "superseded", conflictAt: this.domain });
      throw error;
    }
  }
}

export class ClassificationApplicationService extends ReviewableStateService {
  constructor(controlPlane) { super(controlPlane, { domain: "classification", stream: STREAM_KEYS.classification, policyKey: "classification", resultRef: "classification", handler: typedClassificationHandler, stateNormalizer: normalizeLabels }); }
}

export class KeywordSelectionApplicationService extends ReviewableStateService {
  constructor(controlPlane) { super(controlPlane, { domain: "keyword-selection", stream: STREAM_KEYS.keywordSelection, policyKey: "keyword", resultRef: "keywordSelection", handler: typedKeywordHandler, stateNormalizer: normalizeKeywordEntries }); }
}

export class StateQueryApplicationService extends StateQueryService {}

export function createDefaultOperationContext(overrides = {}) {
  return {
    operationId: newId("operation"), workflowSessionId: "local-session", workDefinitionId: "comment-data-update", workDefinitionRevision: 1, stepId: "local-step",
    actor: { actorId: "system", actorType: "system" }, permissions: [...PERMISSIONS], ...overrides,
  };
}

export { requireContext, stepResult, normalizeLabels, normalizeKeywordEntries, policyPayload, policyKindAlias };

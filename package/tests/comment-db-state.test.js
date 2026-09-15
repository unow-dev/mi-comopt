import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMISSIONS,
  STREAM_KEYS,
  StateControlPlane,
  StateControlPlaneError,
  ClassificationApplicationService,
  CorpusApplicationService,
  DeploymentApplicationService,
  KeywordSelectionApplicationService,
  MemoryDeploymentAdapter,
  InMemoryDefinitionRegistry,
  PolicyApplicationService,
  PromotionApplicationService,
  ReleaseApplicationService,
  buildWorkDefinitions,
  createDefaultOperationContext,
  deriveAccountCandidatesFromControlPlane,
  ensureStateControlPlane,
  openCommentStateDatabase,
  recordCutover,
  resolvePinnedSessionInput,
  resolveDeployPromotedReleaseSessionInput,
  projectCompletedSessionOutcome,
  validateAndHashDefinition,
  createWorkOrchestratorCompatibility,
  assertLegacyWriterAllowed,
  backfillKeywordSelectionGenesis,
  MIGRATION_STATUSES,
  readCutover,
  projectLegacyClassification,
} from "../src/comment-db-state.js";
import {
  clearCurrentKeywordCandidatePublication,
  readCurrentKeywordCandidatePublication,
} from "../src/database/keyword-candidate-publication-repository.js";
import { insertObservationLabel } from "../src/database/three-class-label-repository.js";

function context(operationId, actor = { actorId: "system", actorType: "system" }) {
  return createDefaultOperationContext({ operationId, workflowSessionId: "acceptance-session", actor, permissions: [...PERMISSIONS] });
}

async function fixture() {
  const db = await openCommentStateDatabase(":memory:");
  const controlPlane = new StateControlPlane(db);
  const policies = new PolicyApplicationService(controlPlane);
  const policyValues = {
    classification: { schema_version: 1, auto_commit: true },
    "keyword-selection": { schema_version: 1, auto_commit: true },
    "account-candidate": { schema_version: 1, policy_version: "1.0.0", candidate_label: "direct_nuisance", minimum_behavior_events: 2, evidence_sample_size: 2 },
    "projection-definition": { schema_version: 1, projection: "release-v1" },
  };
  const policyIds = {};
  for (const [kind, policy] of Object.entries(policyValues)) policyIds[kind] = policies.register(context(`policy-${kind}`), { policyKind: kind, policy }).versionId;
  return { db, controlPlane, policyIds };
}

async function materializedFixture() {
  const data = await fixture();
  const corpus = new CorpusApplicationService(data.controlPlane).update(context("a01-corpus"), { initialCorpusVersionId: null, state: { schema_version: 1, records: [] } });
  const classification = await new ClassificationApplicationService(data.controlPlane).assess(context("a01-classification"), { classificationVersionId: null, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [] }, autoCommit: true });
  const keywords = await new KeywordSelectionApplicationService(data.controlPlane).assess(context("a01-keywords"), { keywordSelectionVersionId: null, corpusVersionId: corpus.refs.corpusVersionId, classificationVersionId: classification.refs.classificationVersionId, keywordPolicyVersionId: data.policyIds["keyword-selection"], proposedState: { schema_version: 1, entries: [] }, autoCommit: true });
  const releaseService = new ReleaseApplicationService(data.controlPlane);
  const release = releaseService.build(context("a01-release-build"), { corpusVersionId: corpus.refs.corpusVersionId, classificationVersionId: classification.refs.classificationVersionId, keywordSelectionVersionId: keywords.refs.keywordSelectionVersionId, projectionDefinitionVersionId: data.policyIds["projection-definition"], policyVersionIds: { classification: data.policyIds.classification, keyword_selection: data.policyIds["keyword-selection"], account_candidate: data.policyIds["account-candidate"] } });
  const materialized = releaseService.materialize(context("a01-release-materialize"), { releaseId: release.refs.releaseId, artifacts: { comments: { records: [] }, keywords: [], accounts: [] } });
  return { ...data, corpus, classification, keywords, releaseService, release, materialized };
}

test("A01/A06/A21: auto-commitからRelease、human Promotion、Deployment記録まで進む", async () => {
  const data = await materializedFixture();
  const promotionService = new PromotionApplicationService(data.controlPlane);
  const proposal = promotionService.propose(context("a01-promotion-proposal"), { releaseId: data.release.refs.releaseId, expectedHeadVersionId: null });
  const promotion = promotionService.finalize(context("a01-promotion-finalize", { actorId: "alice", actorType: "human" }), { proposalId: proposal.refs.proposalId, releaseId: data.release.refs.releaseId, review: { outcome: "accept", actor: { actorId: "alice", actorType: "human" } } });
  assert.equal(promotion.stateResult, "committed");
  const adapter = new MemoryDeploymentAdapter();
  const deployment = new DeploymentApplicationService(data.controlPlane, { adapter });
  const trigger = await deployment.trigger(context("a01-deployment-trigger"), { releaseId: data.release.refs.releaseId, deploymentRequestId: "deployment-a01" });
  assert.equal(trigger.stateResult, "triggered");
  const request = adapter.complete("deployment-a01");
  deployment.receiveCompletedEvent({ eventType: "deployment.completed", correlationKey: "deployment-a01", payload: { deploymentRequestId: "deployment-a01", target: "production", releaseId: data.release.refs.releaseId, status: "succeeded", externalRunRef: request.externalRunRef, completedAt: new Date().toISOString() } });
  const verified = await deployment.verify(context("a01-deployment-verify"), { releaseId: data.release.refs.releaseId, externalRunRef: request.externalRunRef });
  const recorded = deployment.record(context("a01-deployment-record"), { releaseId: data.release.refs.releaseId, verified: true, verificationRef: verified.refs.verificationRef });
  assert.equal(recorded.stateResult, "committed");
  assert.equal(data.controlPlane.resolveHead(STREAM_KEYS.deployment).payload.state.releaseId, data.release.refs.releaseId);
});

test("A02/A03/A04/A05/A08/A27: human finalizeは正式Decision、権限、stale headを検証する", async () => {
  const data = await fixture();
  const corpus = new CorpusApplicationService(data.controlPlane).update(context("human-corpus"), { initialCorpusVersionId: null, state: { schema_version: 1, records: [] } });
  const classification = new ClassificationApplicationService(data.controlPlane);
  const reviewRequired = await classification.assess(context("human-classification"), { classificationVersionId: null, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "normal" }] }, autoCommit: false });
  assert.equal(reviewRequired.stateResult, "review_required");
  assert.throws(() => classification.finalize(context("unauthorized", { actorId: "bot", actorType: "service" }), { proposalId: reviewRequired.refs.proposalId, review: { outcome: "accept", actor: { actorId: "bot", actorType: "service" } } }), (error) => error.code === "UNAUTHORIZED_ACTOR");
  const accepted = classification.finalize(context("authorized", { actorId: "human", actorType: "human" }), { proposalId: reviewRequired.refs.proposalId, review: { outcome: "accept", actor: { actorId: "human", actorType: "human" } } });
  assert.equal(accepted.stateResult, "committed");
  const rejectedProposal = await classification.assess(context("rejected-assessment"), { classificationVersionId: accepted.refs.classificationVersionId, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "reactive" }] }, autoCommit: false });
  const rejected = classification.finalize(context("rejected-finalize", { actorId: "human", actorType: "human" }), { proposalId: rejectedProposal.refs.proposalId, review: { outcome: "reject", actor: { actorId: "human", actorType: "human" } } });
  assert.equal(rejected.stateResult, "rejected");
  const stale = await classification.assess(context("stale-assessment"), { classificationVersionId: accepted.refs.classificationVersionId, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "direct_nuisance" }] }, autoCommit: false });
  await classification.assess(context("competing-assessment"), { classificationVersionId: accepted.refs.classificationVersionId, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "reactive" }] }, autoCommit: true });
  const superseded = classification.finalize(context("stale-finalize", { actorId: "human", actorType: "human" }), { proposalId: stale.refs.proposalId, review: { outcome: "accept", actor: { actorId: "human", actorType: "human" } } });
  assert.equal(superseded.stateResult, "conflict");
  assert.equal(superseded.details.outcome, "superseded");
});

test("A09/A10/A11/A13/A14/A28: Commitはatomic/idempotent、no-op/rollback/依存roleを守る", async () => {
  const { db, controlPlane } = await fixture();
  const stream = controlPlane.ensureStream({ domain: "test", streamKey: "state" });
  const genesis = controlPlane.createGenesis({ streamId: stream.stream_id, versionId: "test-v1", payload: { schema_version: 1, state: { value: "a" } }, operationId: "genesis" });
  const proposal = controlPlane.createProposal({ proposalId: "test-p1", streamId: stream.stream_id, expectedHeadVersionId: genesis.versionId, payload: { schema_version: 1, state: { value: "b" } }, operationId: "proposal" });
  const decision = controlPlane.createDecision({ decisionId: "test-d1", proposalId: proposal.proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "test", transitionPolicyVersionId: "policy", operationId: "decision" });
  const committed = controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: "commit" });
  assert.deepEqual(controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: "commit" }), committed);
  assert.equal(controlPlane.db.prepare("SELECT COUNT(*) AS count FROM state_transitions").get().count, 1);
  const noOpProposal = controlPlane.createProposal({ proposalId: "test-p2", streamId: stream.stream_id, expectedHeadVersionId: committed.versionId, proposedSemanticSha256: committed.semanticSha256, payload: { schema_version: 1, state: { value: "b" } }, operationId: "proposal-2" });
  const noOpDecision = controlPlane.createDecision({ proposalId: noOpProposal.proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "test", transitionPolicyVersionId: "policy", operationId: "decision-2" });
  assert.equal(controlPlane.commitProposal({ proposalId: noOpProposal.proposalId, decisionId: noOpDecision.decisionId, operationId: "commit-2" }).stateResult, "unchanged");
  const rollbackProposal = controlPlane.createProposal({ proposalId: "test-p3", streamId: stream.stream_id, expectedHeadVersionId: committed.versionId, payload: { schema_version: 1, state: { value: "a" } }, operationId: "proposal-3" });
  const rollbackDecision = controlPlane.createDecision({ proposalId: rollbackProposal.proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "test", transitionPolicyVersionId: "policy", operationId: "decision-3" });
  const rollback = controlPlane.commitProposal({ proposalId: rollbackProposal.proposalId, decisionId: rollbackDecision.decisionId, operationId: "commit-3" });
  assert.equal(rollback.stateResult, "committed");
  assert.equal(rollback.semanticSha256, genesis.semanticSha256);
  assert.equal(controlPlane.resolveHead(stream.stream_id).versionNo, 3);
  assert.deepEqual(controlPlane.runIdempotent({ operationId: "same-op", operationKind: "test", request: { value: 1 } }, () => ({ ok: true })), { ok: true });
  assert.throws(() => controlPlane.runIdempotent({ operationId: "same-op", operationKind: "test", request: { value: 2 } }, () => ({ ok: false })), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  const before = db.prepare("SELECT COUNT(*) AS count FROM state_assessments").get().count;
  await assert.rejects(() => new ClassificationApplicationService(controlPlane).assess(context("failed-assessment"), { classificationVersionId: null, classificationPolicyVersionId: "missing", assessor: () => { throw new Error("temporary model failure"); } }));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM state_assessments").get().count, before);
});

test("A15/A16/A17/A18/A19/A20/A22: Release重複、Promotion no-op、Deployment ensure/verify/event境界", async () => {
  const data = await materializedFixture();
  const repeated = data.releaseService.build(context("release-repeat"), { corpusVersionId: data.corpus.refs.corpusVersionId, classificationVersionId: data.classification.refs.classificationVersionId, keywordSelectionVersionId: data.keywords.refs.keywordSelectionVersionId, projectionDefinitionVersionId: data.policyIds["projection-definition"], policyVersionIds: { classification: data.policyIds.classification, keyword_selection: data.policyIds["keyword-selection"], account_candidate: data.policyIds["account-candidate"] } });
  assert.equal(repeated.stateResult, "reused");
  const promotionService = new PromotionApplicationService(data.controlPlane);
  const first = promotionService.propose(context("promotion-first"), { releaseId: data.release.refs.releaseId, expectedHeadVersionId: null });
  promotionService.finalize(context("promotion-first-finalize", { actorId: "human", actorType: "human" }), { proposalId: first.refs.proposalId, releaseId: data.release.refs.releaseId, review: { outcome: "accept", actor: { actorId: "human", actorType: "human" } } });
  const second = promotionService.propose(context("promotion-second"), { releaseId: data.release.refs.releaseId, expectedHeadVersionId: data.controlPlane.resolveHead(STREAM_KEYS.promotion).versionId });
  assert.equal(promotionService.finalize(context("promotion-second-finalize", { actorId: "human", actorType: "human" }), { proposalId: second.refs.proposalId, releaseId: data.release.refs.releaseId, review: { outcome: "accept", actor: { actorId: "human", actorType: "human" } } }).stateResult, "unchanged");
  const adapter = new MemoryDeploymentAdapter();
  const deployment = new DeploymentApplicationService(data.controlPlane, { adapter });
  const one = await deployment.trigger(context("deploy-one"), { releaseId: data.release.refs.releaseId, deploymentRequestId: "same-request" });
  const two = await deployment.trigger(context("deploy-two"), { releaseId: data.release.refs.releaseId, deploymentRequestId: "same-request" });
  assert.equal(one.refs.deploymentRequestId, two.refs.deploymentRequestId);
  const external = adapter.complete("same-request", "failed");
  const failed = deployment.receiveCompletedEvent({ eventType: "deployment.completed", correlationKey: "same-request", payload: { deploymentRequestId: "same-request", target: "production", releaseId: data.release.refs.releaseId, status: "failed", externalRunRef: external.externalRunRef, completedAt: new Date().toISOString() } });
  assert.equal(deployment.receiveCompletedEvent({ eventType: "deployment.completed", correlationKey: "same-request", payload: { deploymentRequestId: "same-request", target: "production", releaseId: data.release.refs.releaseId, status: "failed", externalRunRef: external.externalRunRef, completedAt: new Date().toISOString() } }).duplicate, true);
  assert.equal(failed.status, "failed");
  assert.equal((await deployment.verify(context("verify-failed"), { releaseId: data.release.refs.releaseId })).stateResult, "not_verified");
  assert.equal(data.controlPlane.resolveHead(STREAM_KEYS.deployment), null);
});

test("A23/A24/A25/A26: Recovery定義、pinned input、revision immutable、互換層fail closed", () => {
  const definitions = buildWorkDefinitions();
  assert.deepEqual(definitions.map((definition) => definition.workDefinitionId), ["comment-data-update", "deploy-promoted-release"]);
  for (const definition of definitions) {
    const validated = validateAndHashDefinition(definition);
    assert.ok(validated.definitionHash);
    assert.match(JSON.stringify(validated), /16-trigger-deployment/);
  }
  const publicApi = { validateAndHashDefinition: (definition) => validateAndHashDefinition(definition) };
  const compatibility = createWorkOrchestratorCompatibility({ publicApi });
  const registered = new InMemoryDefinitionRegistry();
  compatibility.register(registered, definitions[0]);
  const changed = { ...definitions[0], root: { ...definitions[0].root, id: "changed-root" } };
  assert.throws(() => compatibility.register(registered, changed), /DEFINITION_SNAPSHOT_MISMATCH|DEFINITION_HASH_MISMATCH|DEFINITION_IMMUTABLE/);
  assert.throws(() => createWorkOrchestratorCompatibility(), (error) => error.code === "WORK_ORCHESTRATOR_UNAVAILABLE");
});

test("work-orchestrator local package is loaded through its public root and v2 definitions fail closed on hash drift", async () => {
  const publicApi = await import("work-orchestrator");
  assert.equal(typeof publicApi.WorkOrchestrator, "function");
  assert.equal(typeof publicApi.validateAndHashDefinition, "function");
  assert.ok(createWorkOrchestratorCompatibility({ publicApi }).validate(buildWorkDefinitions()[0]).definitionHash);
  const changed = { ...buildWorkDefinitions()[0], root: { ...buildWorkDefinitions()[0].root, id: "changed-root" } };
  assert.throws(() => createWorkOrchestratorCompatibility({ publicApi }).validate(changed), (error) => error.code === "DEFINITION_SNAPSHOT_MISMATCH");
});

test("A29/A30/A31/A32: cutover、legacy projection、派生候補、receipt復旧境界", async () => {
  const data = await fixture();
  const corpus = new CorpusApplicationService(data.controlPlane).update(context("derived-corpus"), { initialCorpusVersionId: null, state: { schema_version: 1, records: [
    { observationId: "1", username: "a", handle: "@same", comment: "one", postedAt: "t1", postedDate: "2026-09-01" },
    { observationId: "2", username: "b", handle: "@same", comment: "two", postedAt: "t2", postedDate: "2026-09-02" },
  ] } });
  const classification = await new ClassificationApplicationService(data.controlPlane).assess(context("derived-classification"), { classificationVersionId: null, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "direct_nuisance" }, { observationId: "2", label: "direct_nuisance" }] }, autoCommit: true });
  const derived = deriveAccountCandidatesFromControlPlane(data.controlPlane, { corpusVersionId: corpus.refs.corpusVersionId, classificationVersionId: classification.refs.classificationVersionId, accountPolicyVersionId: data.policyIds["account-candidate"] });
  assert.equal(derived.derived, true);
  assert.equal(derived.candidates[0].handle, "@same");
  const stream = data.controlPlane.ensureStream(STREAM_KEYS.classification);
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "backfilled", legacyWriterEnabled: true, operationId: "backfill-classification" });
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "verified", legacyWriterEnabled: true, notes: { semanticEquivalenceVerified: true }, operationId: "verify-classification" });
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "cutover", legacyWriterEnabled: false, notes: { gates: {
    semanticEquivalenceVerified: true,
    commitPathExclusive: true,
    legacyWriterDisabled: true,
    legacyOutputRegenerable: true,
    legacyCurrentMarkerNotAuthoritative: true,
    rollbackNoDualAuthority: true,
  } }, operationId: "cutover-classification" });
  assert.throws(() => assertLegacyWriterAllowed(data.controlPlane, stream.stream_id), (error) => error.code === "LEGACY_WRITER_RETIRED");
  assert.equal(readCutover(data.controlPlane, stream.stream_id).status, "cutover");
  assert.deepEqual(projectLegacyClassification(data.controlPlane, classification.refs.classificationVersionId), [{ observation_id: "1", label: "direct_nuisance" }, { observation_id: "2", label: "direct_nuisance" }]);
  const receipt = data.controlPlane.readReceipt("cutover-classification");
  assert.equal(receipt.operationId, "cutover-classification");
  const pinned = resolvePinnedSessionInput(data.controlPlane, { updateRequestId: "update-1", evidenceSource: { kind: "raw", sourceRef: "ref" }, pinned: { classificationPolicyVersionId: data.policyIds.classification, keywordPolicyVersionId: data.policyIds["keyword-selection"], accountPolicyVersionId: data.policyIds["account-candidate"], projectionDefinitionVersionId: data.policyIds["projection-definition"] } });
  const later = new CorpusApplicationService(data.controlPlane).update(context("later-corpus"), { initialCorpusVersionId: corpus.refs.corpusVersionId, state: { schema_version: 1, records: [] } });
  assert.notEqual(later.refs.corpusVersionId, pinned.pinned.initialCorpusVersionId);
  assert.equal(pinned.pinned.initialCorpusVersionId, corpus.refs.corpusVersionId);
});

test("移行cutoverは状態順序と全gateを強制し、Keyword legacy markerをcutover後に拒否する", async () => {
  const data = await fixture();
  assert.deepEqual(MIGRATION_STATUSES, ["backfilled", "verified", "cutover", "legacy_read_compatibility", "retired"]);
  const genesis = backfillKeywordSelectionGenesis(data.controlPlane, { entries: [], legacyRef: "legacy-keyword-publication" });
  const stream = data.controlPlane.ensureStream(STREAM_KEYS.keywordSelection);
  assert.throws(() => recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "cutover", legacyWriterEnabled: false, operationId: "invalid-cutover" }), (error) => error.code === "MIGRATION_STATUS_ORDER");
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "backfilled", legacyWriterEnabled: true, notes: { genesisVersionId: genesis.versionId }, operationId: "keyword-backfilled" });
  assert.throws(() => recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "verified", legacyWriterEnabled: true, operationId: "invalid-verify" }), (error) => error.code === "MIGRATION_GATE_FAILED");
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "verified", legacyWriterEnabled: true, notes: { semanticEquivalenceVerified: true }, operationId: "keyword-verified" });
  assert.throws(() => recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "cutover", legacyWriterEnabled: false, notes: { semanticEquivalenceVerified: true }, operationId: "incomplete-cutover" }), (error) => error.code === "MIGRATION_GATE_FAILED");
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "cutover", legacyWriterEnabled: false, notes: { gates: {
    semanticEquivalenceVerified: true,
    commitPathExclusive: true,
    legacyWriterDisabled: true,
    legacyOutputRegenerable: true,
    legacyCurrentMarkerNotAuthoritative: true,
    rollbackNoDualAuthority: true,
  } }, operationId: "keyword-cutover" });
  assert.throws(() => readCurrentKeywordCandidatePublication(data.db), (error) => error.code === "LEGACY_READER_RETIRED");
  assert.throws(() => clearCurrentKeywordCandidatePublication(data.db), (error) => error.code === "LEGACY_WRITER_RETIRED");
  assert.equal(readCutover(data.controlPlane, stream.stream_id).legacyWriterEnabled, false);
});

test("Classification cutover後はlegacy label writerを拒否する", async () => {
  const data = await fixture();
  const corpus = await new CorpusApplicationService(data.controlPlane).update(context("classification-cutover-corpus"), { initialCorpusVersionId: null, state: { schema_version: 1, records: [] } });
  const classification = await new ClassificationApplicationService(data.controlPlane).assess(context("classification-cutover-state"), { classificationVersionId: null, corpusVersionId: corpus.refs.corpusVersionId, classificationPolicyVersionId: data.policyIds.classification, proposedState: { schema_version: 1, labels: [] }, autoCommit: true });
  const stream = data.controlPlane.ensureStream(STREAM_KEYS.classification);
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "backfilled", legacyWriterEnabled: true, operationId: "classification-writer-backfilled" });
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "verified", legacyWriterEnabled: true, notes: { semanticEquivalenceVerified: true }, operationId: "classification-writer-verified" });
  recordCutover(data.controlPlane, { streamId: stream.stream_id, status: "cutover", legacyWriterEnabled: false, notes: { gates: {
    semanticEquivalenceVerified: true,
    commitPathExclusive: true,
    legacyWriterDisabled: true,
    legacyOutputRegenerable: true,
    legacyCurrentMarkerNotAuthoritative: true,
    rollbackNoDualAuthority: true,
  } }, operationId: "classification-writer-cutover" });
  assert.ok(classification.refs.classificationVersionId);
  assert.throws(() => insertObservationLabel(data.db, { observationId: 1, label: "normal" }), (error) => error.code === "LEGACY_WRITER_RETIRED");
});

test("State schemaは既存Comment DBへ明示的にだけ追加される", async () => {
  const db = await openCommentStateDatabase(":memory:");
  ensureStateControlPlane(db);
  assert.equal(db.prepare("SELECT schema_version FROM state_schema").get().schema_version, 1);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='state_transitions'").get());
});

test("v2のPolicy pin、recovery starter、Deployment ledger/outbox、Outcome projectorを検証する", async () => {
  const data = await materializedFixture();
  const policyService = new PolicyApplicationService(data.controlPlane);
  policyService.register(context("v2-promotion-policy"), { policyKind: "promotion-production", policy: { schema_version: 1, authorization: { allowed_actor_types: ["human"] } } });
  policyService.register(context("v2-deployment-policy"), { policyKind: "deployment-production", policy: { schema_version: 1, auto_commit: true } });
  const pinned = resolvePinnedSessionInput(data.controlPlane, { updateRequestId: "v2-update", evidenceSource: { kind: "raw", sourceRef: "v2-ref" }, pinned: { classificationPolicyVersionId: data.policyIds.classification, keywordPolicyVersionId: data.policyIds["keyword-selection"], accountPolicyVersionId: data.policyIds["account-candidate"], projectionDefinitionVersionId: data.policyIds["projection-definition"] } });
  assert.ok(pinned.pinned.corpusPolicyVersionId);
  assert.throws(() => resolvePinnedSessionInput(data.controlPlane, { updateRequestId: "v2-update-wrong", evidenceSource: { kind: "raw", sourceRef: "v2-ref" }, pinned: { corpusPolicyVersionId: data.policyIds.classification, classificationPolicyVersionId: data.policyIds.classification, keywordPolicyVersionId: data.policyIds["keyword-selection"], accountPolicyVersionId: data.policyIds["account-candidate"], projectionDefinitionVersionId: data.policyIds["projection-definition"] } }), (error) => error.code === "POLICY_VERSION_STREAM_MISMATCH");
  const promotionService = new PromotionApplicationService(data.controlPlane);
  const proposal = promotionService.propose(context("v2-promotion-propose"), { releaseId: data.release.refs.releaseId });
  const promotion = promotionService.finalize(context("v2-promotion-finalize", { actorId: "reviewer", actorType: "human", workDefinitionRevision: 2 }), { proposalId: proposal.refs.proposalId, releaseId: data.release.refs.releaseId, review: { outcome: "accept", actor: { actorId: "reviewer", actorType: "human" } } });
  const promotionHead = data.controlPlane.resolveHead(STREAM_KEYS.promotion);
  assert.equal(promotion.refs.promotionVersionId, promotionHead.versionId);
  const recovery = resolveDeployPromotedReleaseSessionInput(data.controlPlane);
  assert.deepEqual(recovery, { promotionVersionId: promotionHead.versionId, releaseId: data.release.refs.releaseId, target: { deploymentTarget: "production" } });

  let observedLedgerStatus;
  let adapter;
  adapter = new MemoryDeploymentAdapter({ onEnsure: async (record) => { observedLedgerStatus = data.controlPlane.db.prepare("SELECT status FROM deployment_requests WHERE deployment_request_id = ?").get(record.deploymentRequestId).status; } });
  const deployment = new DeploymentApplicationService(data.controlPlane, { adapter });
  const trigger = await deployment.trigger(createDefaultOperationContext({ operationId: "v2-trigger", workflowSessionId: "v2-session", workDefinitionRevision: 2, permissions: [...PERMISSIONS] }), { promotionVersionId: promotionHead.versionId, releaseId: data.release.refs.releaseId });
  assert.equal(observedLedgerStatus, "prepared");
  assert.equal(trigger.stateResult, "triggered");
  const row = data.controlPlane.db.prepare("SELECT workflow_session_id, promotion_version_id, status FROM deployment_requests WHERE deployment_request_id = ?").get(trigger.refs.deploymentRequestId);
  assert.equal(row.workflow_session_id, "v2-session");
  assert.equal(row.promotion_version_id, promotionHead.versionId);
  assert.equal(row.status, "requested");
  const external = adapter.complete(trigger.refs.deploymentRequestId);
  deployment.receiveCompletedEvent({ eventType: "deployment.completed", correlationKey: trigger.refs.deploymentRequestId, payload: { deploymentRequestId: trigger.refs.deploymentRequestId, target: "production", releaseId: data.release.refs.releaseId, status: "succeeded", externalRunRef: external.externalRunRef, completedAt: new Date().toISOString() } });
  let delivered;
  assert.equal((await deployment.deliverPendingEvents(async (_sessionId, event) => { delivered = event; })).pending, 0);
  assert.equal(delivered.eventId.length > 0, true);

  assert.deepEqual(projectCompletedSessionOutcome({ session: { state: "completed" }, resultsByStepId: { "20-record-deployment-state": { stateResult: "committed", refs: { releaseId: data.release.refs.releaseId } }, "deployment-record-completed": { terminalStatus: "deployed" } } }), { status: "deployed", releaseId: data.release.refs.releaseId, changed: true });
});

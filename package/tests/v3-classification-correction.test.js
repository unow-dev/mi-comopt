import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initWorkspace, openWorkspace } from "work-orchestrator";
import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInputIntoDatabase, openCommentDatabase } from "../src/database/comment-database.js";
import { readSelectedSnapshotsInReferenceOrder } from "../src/database/raw-snapshot-repository.js";
import { readClassificationVersionLabels } from "../src/database/three-class-label-repository.js";
import { STREAM_KEYS, typedClassificationHandler, typedCorpusHandler } from "../src/application/services.js";
import { ClassificationApplicationServiceV3 } from "../src/application/index.js";
import { ClassificationCorrectionServiceV3, readCorrectionReviewSummary } from "../src/application/v3/correction-service.js";
import { createV3OperationContext } from "../src/application/v3/context.js";
import { createV3LocalRuntime, prepareV3SessionInput, startClassificationCorrectionV3, startCommentDataUpdateV3 } from "../src/integration/v3-runtime.js";
import { completeV3HumanTask, listV3HumanTasks, openV3HumanTask, openV3Operator, startV3ClassificationCorrection } from "../src/integration/v3-operator.js";
import { MemoryDeploymentAdapter } from "../src/deployment/adapter.js";
import { completeValidatedHumanArtifact } from "../src/integration/human-artifact-completion-v3.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { canonicalJson, semanticSha256 } from "../src/state/canonical.js";
import { buildClassificationCorrectionDefinitionV3, buildCommentDataUpdateDefinitionV3, validateClassificationCorrectionDefinitionV3, validateV3Definition } from "../src/workflow/v3/definitions.js";
import { workStepResultRuleTable } from "../src/workflow/v3/result-rules.js";
import { buildCorrectedClassificationState } from "../src/three-class/classification-correction.js";
import { planCumulativeClassification } from "../src/three-class/cumulative-classification-plan.js";
import { testKeywordHandoffBuilder } from "./v3-keyword-handoff-test-support.js";

const CORRECTION = Object.freeze({ observationId: "1", expectedLabel: "direct_nuisance", newLabel: "normal", reason: "誤分類を確認したため修正" });

function correctionContext(sessionId, stepId, permissions) {
  return createV3OperationContext({
    sessionId,
    workDefinitionId: "classification-correction",
    workDefinitionRevision: 1,
    stepId,
    actor: { actorId: "application-service", actorType: "service" },
    permissions,
  });
}

function seed(controlPlane, stream, versionId, state, { dependencies = [], domainHandler = undefined } = {}) {
  const record = controlPlane.ensureStream(stream);
  return controlPlane.createGenesis({ streamId: record.stream_id, versionId, payload: { schema_version: 1, state }, dependencies, domainHandler });
}

async function makeFixture(dbPath = ":memory:", { mixedLabels = false } = {}) {
  const db = await openCommentDatabase(dbPath, { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  const comments = [
    { username: "u1", handle: "h1", comment: "AAA", postedAt: "2026-10-01T00:00:00Z", postedDate: "2026-10-01" },
    { username: "u2", handle: "h2", comment: "AAA", postedAt: "2026-10-02T00:00:00Z", postedDate: "2026-10-02" },
    { username: "u3", handle: "h3", comment: "BBB", postedAt: "2026-10-03T00:00:00Z", postedDate: "2026-10-03" },
  ];
  const imported = importRawInputIntoDatabase(db, adaptCommentBatchBytes(Buffer.from(JSON.stringify(comments))));
  const corpusState = { schema_version: 2, snapshot_refs: [{ payloadSha256: imported.payloadSha256, snapshotIndex: 0 }] };
  seed(controlPlane, STREAM_KEYS.corpus, "corpus-0", corpusState, { domainHandler: typedCorpusHandler() });
  const policyState = { schema_version: 1, auto_commit: true, authorization: { allowed_actor_types: ["human"], allowed_actor_ids: ["reviewer"] } };
  for (const [stream, versionId, policyKind] of [
    [STREAM_KEYS.corpusPolicy, "corpus-policy-0", "corpus"],
    [STREAM_KEYS.classificationPolicy, "classification-policy-0", "classification"],
    [STREAM_KEYS.keywordPolicy, "keyword-policy-0", "keyword-selection"],
    [STREAM_KEYS.accountPolicy, "account-policy-0", "account-candidate"],
    [STREAM_KEYS.promotionPolicy, "promotion-policy-0", "promotion-production"],
    [STREAM_KEYS.deploymentPolicy, "deployment-policy-0", "deployment-production"],
  ]) seed(controlPlane, stream, versionId, { ...policyState, policy_kind: policyKind });
  seed(controlPlane, STREAM_KEYS.projectionDefinition, "projection-0", { schema_version: 1, projection: "test" });
  seed(controlPlane, STREAM_KEYS.keywordSelection, "keyword-0", { schema_version: 1, entries: [] });

  const bundles = readSelectedSnapshotsInReferenceOrder(db, corpusState.snapshot_refs);
  const survivors = bundles.flatMap((bundle) => bundle.observations.map((row) => ({ observationId: String(row.observationId), commentText: row.commentText })));
  const labels = survivors.map((row, index) => ({
    observationId: row.observationId,
    label: row.commentText === "BBB" ? "reactive" : mixedLabels && index === 1 ? "reactive" : "direct_nuisance",
  }));
  const baseState = { schema_version: 2, labels };
  seed(controlPlane, STREAM_KEYS.classification, "classification-0", baseState, {
    dependencies: [{ role: "corpus", versionId: "corpus-0" }, { role: "policy", versionId: "classification-policy-0" }],
    domainHandler: typedClassificationHandler(),
  });
  return { db, controlPlane, imported, corpusState, survivors, labels, baseState, baseClassificationVersionId: "classification-0", corpusVersionId: "corpus-0", classificationPolicyVersionId: "classification-policy-0" };
}

function correctionRequest(fixture, overrides = {}) {
  return {
    corpusVersionId: fixture.corpusVersionId,
    classificationVersionId: fixture.baseClassificationVersionId,
    classificationPolicyVersionId: fixture.classificationPolicyVersionId,
    correction: { ...CORRECTION, ...overrides.correction },
    requestedBy: { actorType: "human", actorId: "requester" },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "correction")),
  };
}

function proposeCorrection(fixture, sessionId = "correction-propose") {
  const service = new ClassificationCorrectionServiceV3(fixture.controlPlane);
  const ctx = correctionContext(sessionId, "03-correction-propose", ["state:read", "state:propose"]);
  return service.propose(ctx, correctionRequest(fixture));
}

function finalizeCorrection(fixture, proposalId, { outcome = "accept", trusted = true, actorId = "reviewer", rationale = "human review completed" } = {}) {
  const service = new ClassificationApplicationServiceV3(fixture.controlPlane);
  const ctx = correctionContext(`finalize-${proposalId}`, "06-finalize-classification", ["state:read", "state:commit"]);
  const review = { outcome, actor: { actorType: "human", actorId }, rationale, ...(trusted ? { trustedTaskCompletion: true } : {}) };
  return service.finalize(ctx, { proposalId, review });
}

function commitCorpusAdvance(fixture) {
  const stream = fixture.controlPlane.ensureStream(STREAM_KEYS.corpus);
  const state = { ...fixture.corpusState, note: "advanced" };
  fixture.controlPlane.createProposal({
    proposalId: "corpus-advance-proposal",
    streamId: stream.stream_id,
    expectedHeadVersionId: fixture.corpusVersionId,
    proposedSemanticSha256: semanticSha256(state),
    payload: { schema_version: 1, state },
    operationId: "corpus-advance-proposal-operation",
  });
  const decision = fixture.controlPlane.createDecision({ proposalId: "corpus-advance-proposal", outcome: "accepted", authorityKind: "human", authorityRef: "operator", transitionPolicyVersionId: "corpus-policy-0", operationId: "corpus-advance-decision-operation" });
  return fixture.controlPlane.commitProposal({ proposalId: "corpus-advance-proposal", decisionId: decision.decisionId, operationId: "corpus-advance-commit-operation" });
}

test("T01/T02: exact comment groups converge while unrelated observations stay fixed and base schema is preserved", () => {
  const survivors = [{ observationId: "101", commentText: "AAA" }, { observationId: "102", commentText: "AAA" }, { observationId: "103", commentText: "BBB" }];
  const baseLabels = [{ observationId: "101", label: "direct_nuisance" }, { observationId: "102", label: "reactive" }, { observationId: "103", label: "reactive" }];
  const result = buildCorrectedClassificationState({ survivors, baseLabels, correction: { ...CORRECTION, observationId: "101" }, schemaVersion: 2 });
  assert.deepEqual(result.state, { schema_version: 2, labels: [{ observationId: "101", label: "normal" }, { observationId: "102", label: "normal" }, { observationId: "103", label: "reactive" }] });
  assert.deepEqual(result.change, { commentText: "AAA", affectedObservationCount: 2, changedObservationCount: 2, previousLabels: [{ label: "direct_nuisance", count: 1 }, { label: "reactive", count: 1 }], newLabel: "normal" });
});

test("T03: malformed IDs, labels, coverage, reason, and unchanged corrections fail closed", () => {
  const survivors = [{ observationId: "1", commentText: "AAA" }, { observationId: "2", commentText: "AAA" }];
  const baseLabels = [{ observationId: "1", label: "direct_nuisance" }, { observationId: "2", label: "direct_nuisance" }];
  const build = (updates = {}) => buildCorrectedClassificationState({ survivors, baseLabels, correction: { ...CORRECTION, ...updates } });
  assert.throws(() => build({ observationId: null }), (error) => error.code === "INVALID_OBSERVATION_ID");
  assert.throws(() => build({ observationId: "missing" }), (error) => error.code === "TARGET_NOT_FOUND");
  assert.throws(() => build({ expectedLabel: "reactive" }), (error) => error.code === "EXPECTED_LABEL_MISMATCH");
  assert.throws(() => build({ newLabel: "other" }), (error) => error.code === "INVALID_LABEL");
  assert.throws(() => build({ newLabel: "direct_nuisance" }), (error) => error.code === "UNCHANGED_CORRECTION");
  assert.throws(() => build({ reason: "   " }), (error) => error.code === "CORRECTION_REASON_REQUIRED");
  assert.throws(() => buildCorrectedClassificationState({ survivors: [...survivors, survivors[0]], baseLabels, correction: CORRECTION }), (error) => error.code === "DUPLICATE_SURVIVOR");
  assert.throws(() => buildCorrectedClassificationState({ survivors, baseLabels: baseLabels.slice(0, 1), correction: CORRECTION }), (error) => error.code === "INCOMPLETE_CLASSIFICATION");
});

test("T04/T05/T06/T10: proposal always requires human review, rejection preserves head, and acceptance creates an inheritable immutable version", async () => {
  const fixture = await makeFixture(":memory:", { mixedLabels: true });
  try {
    const proposalResult = proposeCorrection(fixture, "correction-accepted");
    assert.equal(proposalResult.stateResult, "review_required");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, fixture.baseClassificationVersionId);
    assert.equal(fixture.controlPlane.readDecision(proposalResult.refs.proposalId), null);
    const summary = readCorrectionReviewSummary(fixture.controlPlane, proposalResult.refs);
    assert.equal(summary.baseClassificationVersionId, fixture.baseClassificationVersionId);
    assert.equal(summary.commentText, "AAA");
    assert.equal(summary.requestedBy.actorId, "requester");
    assert.deepEqual(summary.change.previousLabels, [{ label: "direct_nuisance", count: 1 }, { label: "reactive", count: 1 }]);
    assert.throws(() => readCorrectionReviewSummary(fixture.controlPlane, { proposalId: proposalResult.refs.proposalId, assessmentId: "wrong-assessment" }), (error) => error.code === "CORRECTION_REVIEW_INTEGRITY_ERROR");

    assert.throws(() => new ClassificationApplicationServiceV3(fixture.controlPlane).finalize(correctionContext("finalize-shortcut", "06-finalize-classification", ["state:read", "state:commit"]), {
      proposalId: proposalResult.refs.proposalId,
      assessed: { refs: { classificationVersionId: fixture.baseClassificationVersionId } },
    }), (error) => error.code === "CORRECTION_REVIEW_REQUIRED");
    assert.throws(() => finalizeCorrection(fixture, proposalResult.refs.proposalId, { trusted: false }), (error) => error.code === "CORRECTION_REVIEW_REQUIRED");
    assert.equal(fixture.controlPlane.readDecision(proposalResult.refs.proposalId), null);

    const result = finalizeCorrection(fixture, proposalResult.refs.proposalId);
    assert.equal(result.stateResult, "committed");
    const corrected = fixture.controlPlane.readVersion(result.refs.classificationVersionId);
    assert.equal(corrected.payload.state.schema_version, 2);
    assert.equal(corrected.payload.correction.kind, "manual_classification_correction");
    assert.deepEqual(corrected.payload.state.labels, [
      { observationId: "1", label: "normal" },
      { observationId: "2", label: "normal" },
      { observationId: "3", label: "reactive" },
    ]);
    assert.deepEqual(fixture.controlPlane.readVersion(fixture.baseClassificationVersionId).payload.state, fixture.baseState);
    assert.deepEqual(fixture.controlPlane.readDependencies(corrected.versionId), [
      { role: "corpus", versionId: fixture.corpusVersionId },
      { role: "policy", versionId: fixture.classificationPolicyVersionId },
    ]);
    const decision = fixture.controlPlane.readDecision(proposalResult.refs.proposalId);
    assert.equal(decision.authorityRef, "reviewer");
    assert.equal(decision.rationale, "human review completed");

    const priorLabels = readClassificationVersionLabels(fixture.db, corrected.versionId);
    const futureSurvivors = [...fixture.survivors, { observationId: "999", commentText: "AAA" }];
    const plan = planCumulativeClassification({ survivors: futureSurvivors, priorLabels });
    assert.equal(plan.labels.find((item) => item.observationId === "999").label, "normal");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, corrected.versionId);
  } finally {
    fixture.db.close();
    fixture.db = null;
  }
});

test("T09/T14/T15: Corpus head races and tampered no-op proposals are rejected before state no-op handling", async () => {
  const fixture = await makeFixture();
  try {
    const proposalResult = proposeCorrection(fixture, "correction-corpus-race");
    commitCorpusAdvance(fixture);
    const result = finalizeCorrection(fixture, proposalResult.refs.proposalId);
    assert.equal(result.stateResult, "conflict");
    assert.equal(result.details.conflictAt, "corpus");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, fixture.baseClassificationVersionId);
    assert.equal(fixture.controlPlane.readDecision(proposalResult.refs.proposalId).outcome, "accepted");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM state_transitions WHERE stream_id = ?").get(fixture.controlPlane.ensureStream(STREAM_KEYS.classification).stream_id).n, 0);
  } finally {
    fixture.db.close();
  }

  const tampered = await makeFixture();
  try {
    const proposalResult = proposeCorrection(tampered, "correction-noop-tamper");
    const proposal = tampered.controlPlane.readProposal(proposalResult.refs.proposalId);
    const payload = { ...proposal.payload, state: tampered.baseState };
    tampered.db.prepare("UPDATE state_proposals SET proposal_payload_json = ?, proposed_semantic_sha256 = ? WHERE proposal_id = ?")
      .run(canonicalJson(payload), tampered.controlPlane.readVersion(tampered.baseClassificationVersionId).semanticSha256, proposal.proposalId);
    assert.throws(() => finalizeCorrection(tampered, proposal.proposalId), (error) => error.code === "CORRECTION_PROPOSAL_INVALID");
    assert.equal(tampered.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, tampered.baseClassificationVersionId);
    assert.equal(tampered.db.prepare("SELECT COUNT(*) AS n FROM state_transitions WHERE stream_id = ?").get(tampered.controlPlane.ensureStream(STREAM_KEYS.classification).stream_id).n, 0);
  } finally {
    tampered.db.close();
  }
});

test("T08: a Classification head advance after review supersedes the correction", async () => {
  const fixture = await makeFixture();
  try {
    const proposalResult = proposeCorrection(fixture, "correction-classification-race");
    const stream = fixture.controlPlane.ensureStream(STREAM_KEYS.classification);
    const competingState = { ...fixture.baseState, labels: fixture.baseState.labels.map((item) => item.observationId === "3" ? { ...item, label: "normal" } : item) };
    const competingProposal = fixture.controlPlane.createProposal({
      proposalId: "classification-advance-proposal",
      streamId: stream.stream_id,
      expectedHeadVersionId: fixture.baseClassificationVersionId,
      proposedSemanticSha256: semanticSha256(competingState),
      payload: { schema_version: 1, state: competingState },
      dependencies: [{ role: "corpus", versionId: fixture.corpusVersionId }, { role: "policy", versionId: fixture.classificationPolicyVersionId }],
      operationId: "classification-advance-proposal-operation",
    });
    const decision = fixture.controlPlane.createDecision({ proposalId: competingProposal.proposalId, outcome: "accepted", authorityKind: "human", authorityRef: "other-reviewer", transitionPolicyVersionId: fixture.classificationPolicyVersionId, operationId: "classification-advance-decision-operation" });
    fixture.controlPlane.commitProposal({ proposalId: competingProposal.proposalId, decisionId: decision.decisionId, operationId: "classification-advance-commit-operation", domainHandler: typedClassificationHandler() });

    const result = finalizeCorrection(fixture, proposalResult.refs.proposalId);
    assert.equal(result.stateResult, "conflict");
    assert.equal(result.details?.conflictAt, "classification", JSON.stringify(result));
    assert.equal(fixture.controlPlane.readDecision(proposalResult.refs.proposalId).outcome, "accepted");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM state_transitions WHERE stream_id = ?").get(stream.stream_id).n, 1);
  } finally {
    fixture.db.close();
  }
});

test("T11/T19: correction WorkDefinition has exact result rules and leaves the existing comment-data-update hash intact", async () => {
  const normal = validateV3Definition(buildCommentDataUpdateDefinitionV3({ revision: 3 }));
  assert.equal(normal.definitionHash, "9598f503ba9a8e8753e0b1d9d1e4af2f1a80a4d10b718aba5ab250840438a726");
  const safeNormal = validateV3Definition(buildCommentDataUpdateDefinitionV3());
  assert.equal(safeNormal.revision, 4);
  assert.equal(safeNormal.definitionHash, "b6e7d6bc04025ea54b4cbe2e8ff221e98f7b9d9a026950e79126915f3c09d1f4");
  const correction = validateClassificationCorrectionDefinitionV3(buildClassificationCorrectionDefinitionV3());
  const { validateAndHashDefinition } = await import("work-orchestrator");
  const providerDefinition = validateAndHashDefinition(correction);
  assert.equal(providerDefinition.definitionHash, correction.definitionHash);
  const agentIds = [];
  const visit = (step) => {
    if (step?.kind === "task" && step.contract?.workerKind === "agent") agentIds.push(step.id);
    step?.children?.forEach(visit);
    if (step?.kind === "choice") Object.values(step.branches).forEach(visit);
  };
  visit(correction.root);
  assert.ok(agentIds.includes("03-correction-propose"));
  assert.ok(agentIds.includes("11-build-release-bundle-reuse"));
  assert.ok(agentIds.every((stepId) => workStepResultRuleTable()[stepId]));
  const safeAgentIds = [];
  const visitSafe = (step) => {
    if (step?.kind === "task" && step.contract?.workerKind === "agent") safeAgentIds.push(step.id);
    step?.children?.forEach(visitSafe);
    if (step?.kind === "choice") Object.values(step.branches).forEach(visitSafe);
  };
  visitSafe(safeNormal.root);
  assert.equal(validateAndHashDefinition(safeNormal).definitionHash, safeNormal.definitionHash);
  assert.ok(safeAgentIds.length > 100);
  assert.ok(safeAgentIds.every((stepId) => workStepResultRuleTable()[stepId]), safeAgentIds.filter((stepId) => !workStepResultRuleTable()[stepId]).join(", "));
  const serialized = canonicalJson(correction.root);
  assert.match(serialized, /"review":\{"path":"","source":"task","stepId":"05-review-classification"\}/);
  const correctionFinalize = correction.root.children[1].branches.review_required.children[1].children[0];
  assert.deepEqual(Object.keys(correctionFinalize.inputBindings).sort(), ["proposalId", "review"]);
});

test("T17: comment-data-update revision 4 stops after a rejected classification review", async () => {
  const fixture = await makeFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "comment-data-update-v4-safe-"));
  initWorkspace(root);
  const workspace = openWorkspace(root);
  const environment = createV3LocalRuntime({ controlPlane: fixture.controlPlane, registry: workspace.registry, artifactStore: workspace.artifactStore, workspace, keywordHandoffBuilder: testKeywordHandoffBuilder, revision: 4 });
  const sessionId = "comment-update-v4-rejected-classification";
  const actor = { actorId: "reviewer", actorType: "human" };
  try {
    const input = prepareV3SessionInput({ controlPlane: fixture.controlPlane, input: {
      updateRequestId: "comment-update-v4-rejected-classification-request",
      pinned: {
        initialCorpusVersionId: fixture.corpusVersionId,
        classificationVersionId: fixture.baseClassificationVersionId,
        keywordSelectionVersionId: "keyword-0",
        corpusPolicyVersionId: "corpus-policy-0",
        classificationPolicyVersionId: fixture.classificationPolicyVersionId,
        keywordPolicyVersionId: "keyword-policy-0",
        accountPolicyVersionId: "account-policy-0",
        projectionDefinitionVersionId: "projection-0",
      },
      target: { promotionStream: "production", deploymentTarget: "production" },
    } });
    await startCommentDataUpdateV3({ runtime: environment.runtime, controlPlane: fixture.controlPlane, sessionId, input, revision: 4 });
    const receive = Object.values(environment.runtime.state(sessionId).tasks).find((item) => item.stepId === "00-receive-update-artifact");
    const execution = await environment.runtime.openHumanTaskWorkspace(sessionId, receive.taskId, actor);
    await writeFile(path.join(execution.outputPath, "comment-batch.json"), `${JSON.stringify([{ username: "u4", handle: "h4", comment: "CCC", postedAt: "2026-10-04T00:00:00Z", postedDate: "2026-10-04" }])}\n`);
    await completeValidatedHumanArtifact({ runtime: environment.runtime, registry: workspace.registry, artifactStore: workspace.artifactStore, sessionId, taskId: receive.taskId, actor, executionId: execution.executionId, outputDirectory: execution.outputPath, stepId: receive.stepId });
    let state = environment.runtime.state(sessionId);
    const worksetId = state.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    const classificationResponse = Object.values(state.tasks).find((item) => item.stepId === "03b-receive-classification-response-classification-handoff");
    const responseExecution = await environment.runtime.openHumanTaskWorkspace(sessionId, classificationResponse.taskId, actor);
    await writeFile(path.join(responseExecution.outputPath, "response.json"), `${JSON.stringify({ workset_id: worksetId, decisions: { I1: "normal" } })}\n`);
    await completeValidatedHumanArtifact({ runtime: environment.runtime, registry: workspace.registry, artifactStore: workspace.artifactStore, sessionId, taskId: classificationResponse.taskId, actor, executionId: responseExecution.executionId, outputDirectory: responseExecution.outputPath, stepId: classificationResponse.stepId });
    state = environment.runtime.state(sessionId);
    const review = Object.values(state.tasks).find((item) => item.stepId === "05-review-classification-classification-handoff");
    assert.ok(review, JSON.stringify(Object.values(state.tasks).map((item) => item.stepId)));
    await environment.runtime.claimTask(sessionId, review.taskId, actor);
    await environment.runtime.completeHumanTaskWithInput(sessionId, review.taskId, actor, { outcome: "reject", result: { rationale: "rejected in isolated regression" } }, "comment-update-v4-reject-review");
    state = environment.runtime.state(sessionId);
    assert.equal(state.resultsByStepId["06-finalize-classification-classification-handoff-reviewed"].stateResult, "rejected");
    assert.equal(Object.keys(state.resultsByStepId).some((stepId) => stepId.startsWith("07a-prepare-keyword-handoff")), false);
    assert.equal(Object.keys(state.resultsByStepId).some((stepId) => stepId.startsWith("11-build-release-bundle")), false);
  } finally {
    workspace.registry.close();
    fixture.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("T09/T17: a stale Corpus accepted at correction review stops before keyword and Release tasks", async () => {
  const fixture = await makeFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "classification-correction-corpus-race-"));
  initWorkspace(root);
  const workspace = openWorkspace(root);
  const environment = createV3LocalRuntime({ controlPlane: fixture.controlPlane, registry: workspace.registry, artifactStore: workspace.artifactStore, workspace, keywordHandoffBuilder: testKeywordHandoffBuilder });
  try {
    const started = await startClassificationCorrectionV3({ runtime: environment.runtime, controlPlane: fixture.controlPlane, sessionId: "correction-runtime-corpus-race", command: { baseClassificationVersionId: fixture.baseClassificationVersionId, ...CORRECTION }, authenticatedActor: { actorType: "human", actorId: "requester" } });
    const state = environment.runtime.state(started.sessionId);
    const proposal = state.resultsByStepId["03-correction-propose"];
    const review = Object.values(state.tasks).find((item) => item.stepId === "05-review-classification");
    commitCorpusAdvance(fixture);
    const reviewer = { actorId: "reviewer", actorType: "human" };
    await environment.runtime.claimTask(started.sessionId, review.taskId, reviewer);
    await environment.runtime.completeHumanTaskWithInput(started.sessionId, review.taskId, reviewer, { outcome: "accept", result: { rationale: "accept stale proposal to verify commit preflight" } }, "correction-corpus-race-review");
    const completed = environment.runtime.state(started.sessionId);
    const finalizer = completed.resultsByStepId["06-finalize-classification"];
    assert.equal(finalizer.stateResult, "conflict");
    assert.equal(finalizer.details.conflictAt, "corpus");
    assert.equal(fixture.controlPlane.readDecision(proposal.refs.proposalId).outcome, "accepted");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, fixture.baseClassificationVersionId);
    assert.equal(Object.keys(completed.resultsByStepId).some((stepId) => stepId.startsWith("07a-prepare-keyword-handoff")), false);
    assert.equal(Object.keys(completed.resultsByStepId).some((stepId) => stepId.startsWith("11-build-release-bundle")), false);
  } finally {
    workspace.registry.close();
    fixture.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("T04/T05/T06/T18: runtime rejects an unauthenticated actor, shows persisted review data, and stops after rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "classification-correction-operator-"));
  const dbPath = path.join(root, "comments.sqlite3");
  const workspacePath = path.join(root, "workspace");
  initWorkspace(workspacePath);
  let fixture;
  let operator;
  try {
    fixture = await makeFixture(dbPath);
    fixture.db.close();
    fixture.db = null;
    operator = await openV3Operator({
      dbPath,
      workspacePath,
      deploymentAdapter: new MemoryDeploymentAdapter(),
      keywordHandoffBuilder: testKeywordHandoffBuilder,
      authenticateHumanActor: (actorId) => ["requester", "reviewer"].includes(actorId) ? { actorType: "human", actorId } : null,
    });
    await assert.rejects(startV3ClassificationCorrection(operator, {
      sessionId: "correction-unauthenticated",
      actorId: "spoofed",
      command: { baseClassificationVersionId: "classification-0", ...CORRECTION },
    }), (error) => error.code === "UNAUTHENTICATED_ACTOR");
    const started = await startV3ClassificationCorrection(operator, {
      sessionId: "correction-operator-reject",
      actorId: "requester",
      command: { baseClassificationVersionId: "classification-0", ...CORRECTION },
    });
    assert.equal(started.workDefinitionId, "classification-correction");
    const review = listV3HumanTasks(operator, started.sessionId).find((item) => item.stepId === "05-review-classification");
    assert.equal(review.correctionReview.reason, CORRECTION.reason);
    assert.equal(review.correctionReview.requestedBy.actorId, "requester");
    await openV3HumanTask(operator, { sessionId: started.sessionId, stepId: "05-review-classification", actorId: "reviewer" });
    await completeV3HumanTask(operator, { sessionId: started.sessionId, stepId: "05-review-classification", actorId: "reviewer", outcome: "reject", rationale: "reject test" });
    const state = operator.runtime.state(started.sessionId);
    assert.equal(state.resultsByStepId["06-finalize-classification"].stateResult, "rejected");
    assert.equal(Object.values(state.tasks).some((task) => task.stepId === "07a-prepare-keyword-handoff"), false);
    assert.equal(operator.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, "classification-0");
    assert.equal(Object.values(state.tasks).some((task) => task.stepId.startsWith("11-build-release-bundle")), false);
  } finally {
    operator?.close();
    fixture?.db?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("T04/T06/T07: runtime acceptance commits only after claimant review and starts the shared keyword flow with the new pin", async () => {
  const fixture = await makeFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "classification-correction-e2e-"));
  initWorkspace(root);
  const workspace = openWorkspace(root);
  const environment = createV3LocalRuntime({ controlPlane: fixture.controlPlane, registry: workspace.registry, artifactStore: workspace.artifactStore, workspace, keywordHandoffBuilder: testKeywordHandoffBuilder });
  try {
    const started = await startClassificationCorrectionV3({
      runtime: environment.runtime,
      controlPlane: fixture.controlPlane,
      sessionId: "correction-runtime-accept",
      command: { baseClassificationVersionId: fixture.baseClassificationVersionId, ...CORRECTION },
      authenticatedActor: { actorType: "human", actorId: "requester" },
    });
    let state = environment.runtime.state("correction-runtime-accept");
    const proposalResult = state.resultsByStepId["03-correction-propose"];
    assert.equal(proposalResult.stateResult, "review_required");
    assert.equal(fixture.controlPlane.readDecision(proposalResult.refs.proposalId), null);
    const task = Object.values(state.tasks).find((item) => item.stepId === "05-review-classification");
    const reviewer = { actorId: "reviewer", actorType: "human" };
    await environment.runtime.claimTask(started.sessionId, task.taskId, reviewer);
    await environment.runtime.completeHumanTaskWithInput(started.sessionId, task.taskId, reviewer, { outcome: "accept", result: { rationale: "approved by reviewer" } }, "correction-runtime-review");
    state = environment.runtime.state(started.sessionId);
    const finalize = state.resultsByStepId["06-finalize-classification"];
    assert.equal(finalize.stateResult, "committed");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, finalize.refs.classificationVersionId);
    const keywordPreparation = Object.values(state.tasks).find((item) => item.stepId === "07a-prepare-keyword-handoff");
    assert.equal(keywordPreparation.inputs.classificationVersionId, finalize.refs.classificationVersionId);
    assert.ok(Object.values(state.tasks).some((item) => item.stepId === "07b-receive-keyword-proposal"));
    assert.equal(fixture.controlPlane.readDecision(proposalResult.refs.proposalId).authorityRef, "reviewer");

    const keywordRefs = state.resultsByStepId["07a-prepare-keyword-handoff"].refs;
    const keywordTask = Object.values(state.tasks).find((item) => item.stepId === "07b-receive-keyword-proposal");
    const keywordExecution = await environment.runtime.openHumanTaskWorkspace(started.sessionId, keywordTask.taskId, reviewer);
    await writeFile(path.join(keywordExecution.outputPath, "candidate_proposal.json"), `${JSON.stringify({ schema_version: 1, request_id: keywordRefs.candidateRequestId, input_fingerprint: keywordRefs.candidateInputFingerprint, actions: [] })}\n`);
    await completeValidatedHumanArtifact({ runtime: environment.runtime, registry: workspace.registry, artifactStore: workspace.artifactStore, sessionId: started.sessionId, taskId: keywordTask.taskId, actor: reviewer, executionId: keywordExecution.executionId, outputDirectory: keywordExecution.outputPath, stepId: keywordTask.stepId });

    state = environment.runtime.state(started.sessionId);
    const buildEntry = Object.entries(state.resultsByStepId).find(([stepId]) => stepId.startsWith("11-build-release-bundle-"));
    assert.ok(buildEntry, "accepted correction must build a downstream Release");
    const releaseId = buildEntry[1].refs.releaseId;
    const release = fixture.db.prepare("SELECT pins_json FROM v3_release_bundles WHERE release_id = ?").get(releaseId);
    assert.equal(JSON.parse(release.pins_json).classificationVersionId, finalize.refs.classificationVersionId);

    const promotionReview = Object.values(state.tasks).find((item) => item.stepId.startsWith("13-review-production-promotion-"));
    await environment.runtime.claimTask(started.sessionId, promotionReview.taskId, reviewer);
    await environment.runtime.completeHumanTaskWithInput(started.sessionId, promotionReview.taskId, reviewer, { outcome: "accept", result: { rationale: "isolated end-to-end promotion approval" } }, "correction-promotion-review");

    state = environment.runtime.state(started.sessionId);
    const triggerEntry = Object.entries(state.resultsByStepId).find(([stepId]) => stepId.startsWith("16-trigger-deployment-"));
    assert.ok(triggerEntry, "accepted Promotion must trigger the in-memory Deployment adapter");
    const trigger = triggerEntry[1];
    const deployment = environment.agentAdapter.taskHandlers.services.deployment;
    const deploymentRequest = deployment.adapter.complete(trigger.refs.deploymentRequestId, "succeeded");
    deployment.receiveCompletedEvent({
      eventId: "correction-e2e-deployment-completed",
      eventType: "deployment.completed",
      correlationKey: trigger.refs.deploymentRequestId,
      payload: { deploymentRequestId: trigger.refs.deploymentRequestId, target: "production", releaseId: trigger.refs.releaseId, status: "succeeded", externalRunRef: deploymentRequest.externalRunRef },
    });
    const delivery = await deployment.deliverPendingEvents((sessionId, event, commandId) => environment.runtime.receiveExternalEvent(sessionId, event, { actorId: "memory-deployment", actorType: "external" }, commandId), { registry: workspace.registry });
    assert.deepEqual(delivery, { delivered: ["correction-e2e-deployment-completed"], deadLettered: [] });
    state = environment.runtime.state(started.sessionId);
    assert.equal(state.session.state, "completed");
    assert.equal(Object.entries(state.resultsByStepId).find(([stepId]) => stepId.startsWith("19-verify-deployment-after-wait-"))[1].stateResult, "verified");
    assert.equal(Object.entries(state.resultsByStepId).find(([stepId]) => stepId.startsWith("20-record-deployment-state-after-wait-"))[1].stateResult, "committed");

    const nextBaseVersionId = fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId;
    await startClassificationCorrectionV3({ runtime: environment.runtime, controlPlane: fixture.controlPlane, sessionId: "correction-runtime-deployment-failed", authenticatedActor: { actorType: "human", actorId: "requester" }, command: {
      baseClassificationVersionId: nextBaseVersionId,
      observationId: "1",
      expectedLabel: "normal",
      newLabel: "reactive",
      reason: "second isolated correction for deployment-failure routing",
    } });
    state = environment.runtime.state("correction-runtime-deployment-failed");
    const secondClassificationReview = Object.values(state.tasks).find((item) => item.stepId === "05-review-classification");
    await environment.runtime.claimTask("correction-runtime-deployment-failed", secondClassificationReview.taskId, reviewer);
    await environment.runtime.completeHumanTaskWithInput("correction-runtime-deployment-failed", secondClassificationReview.taskId, reviewer, { outcome: "accept", result: { rationale: "accepted for failure-branch test" } }, "correction-failure-classification-review");
    state = environment.runtime.state("correction-runtime-deployment-failed");
    const secondKeywordRefs = state.resultsByStepId["07a-prepare-keyword-handoff"].refs;
    const secondKeywordTask = Object.values(state.tasks).find((item) => item.stepId === "07b-receive-keyword-proposal");
    const secondKeywordExecution = await environment.runtime.openHumanTaskWorkspace("correction-runtime-deployment-failed", secondKeywordTask.taskId, reviewer);
    await writeFile(path.join(secondKeywordExecution.outputPath, "candidate_proposal.json"), `${JSON.stringify({ schema_version: 1, request_id: secondKeywordRefs.candidateRequestId, input_fingerprint: secondKeywordRefs.candidateInputFingerprint, actions: [] })}\n`);
    await completeValidatedHumanArtifact({ runtime: environment.runtime, registry: workspace.registry, artifactStore: workspace.artifactStore, sessionId: "correction-runtime-deployment-failed", taskId: secondKeywordTask.taskId, actor: reviewer, executionId: secondKeywordExecution.executionId, outputDirectory: secondKeywordExecution.outputPath, stepId: secondKeywordTask.stepId });
    state = environment.runtime.state("correction-runtime-deployment-failed");
    const secondPromotionReview = Object.values(state.tasks).find((item) => item.stepId.startsWith("13-review-production-promotion-"));
    assert.ok(secondPromotionReview);
    deployment.adapter.onEnsure = async () => ({ status: "failed" });
    await environment.runtime.claimTask("correction-runtime-deployment-failed", secondPromotionReview.taskId, reviewer);
    await environment.runtime.completeHumanTaskWithInput("correction-runtime-deployment-failed", secondPromotionReview.taskId, reviewer, { outcome: "accept", result: { rationale: "accept to exercise failed deployment routing" } }, "correction-failure-promotion-review");
    state = environment.runtime.state("correction-runtime-deployment-failed");
    assert.equal(Object.entries(state.resultsByStepId).find(([stepId]) => stepId.startsWith("16-trigger-deployment-"))[1].stateResult, "deployment_failed");
    assert.equal(Object.keys(state.resultsByStepId).some((stepId) => stepId.startsWith("19-verify-deployment-")), false);
    assert.equal(Object.keys(state.resultsByStepId).some((stepId) => stepId.startsWith("20-record-deployment-state-")), false);
  } finally {
    workspace.registry.close();
    fixture.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactStore, initWorkspace, openWorkspace, Registry } from "work-orchestrator";
import { completeValidatedHumanArtifact } from "../src/integration/human-artifact-completion-v3.js";
import { createV3LocalRuntime, createV3TemporalRuntime, prepareV3SessionInput, startCommentDataUpdateV3 } from "../src/integration/v3-runtime.js";
import { DeploymentQueueServiceV3 } from "../src/application/v3/deployment-services.js";
import { PromotionApplicationServiceV3 } from "../src/application/v3/release-services.js";
import { createV3OperationContext } from "../src/application/v3/context.js";
import { STREAM_KEYS } from "../src/application/services.js";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { semanticSha256 } from "../src/state/canonical.js";

function seed(controlPlane, stream, versionId, state = {}) {
  const record = controlPlane.ensureStream(stream);
  return controlPlane.createGenesis({ streamId: record.stream_id, versionId, payload: { schema_version: 1, state } });
}

function seedV3State(controlPlane) {
  seed(controlPlane, STREAM_KEYS.corpus, "corpus-0", { snapshot_refs: [], unresolved_target_count: 1 });
  seed(controlPlane, STREAM_KEYS.classification, "classification-0", { unresolved_target_count: 1, labels: [] });
  seed(controlPlane, STREAM_KEYS.keywordSelection, "keyword-0", { entries: [] });
  for (const [stream, versionId, policyKind] of [
    [STREAM_KEYS.corpusPolicy, "corpus-policy-0", "corpus"],
    [STREAM_KEYS.classificationPolicy, "classification-policy-0", "classification"],
    [STREAM_KEYS.keywordPolicy, "keyword-policy-0", "keyword-selection"],
    [STREAM_KEYS.accountPolicy, "account-policy-0", "account-candidate"],
    [STREAM_KEYS.projectionDefinition, "projection-0", "projection-definition"],
    [STREAM_KEYS.promotionPolicy, "promotion-policy-0", "promotion-production"],
    [STREAM_KEYS.deploymentPolicy, "deployment-policy-0", "deployment-production"],
  ]) seed(controlPlane, stream, versionId, { policy_kind: policyKind, auto_commit: true });
}

async function localFixture(sessionId = "v3-e2e-session", updateRequestId = "update-v3-e2e") {
  const root = await mkdtemp(path.join(tmpdir(), "comment-db-v3-runtime-"));
  initWorkspace(root);
  const workspace = openWorkspace(root);
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  seedV3State(controlPlane);
  const environment = createV3LocalRuntime({ controlPlane, registry: workspace.registry, artifactStore: workspace.artifactStore, workspace });
  const input = prepareV3SessionInput({
    controlPlane,
    input: {
      updateRequestId,
      pinned: {
        initialCorpusVersionId: "corpus-0",
        classificationVersionId: "classification-0",
        keywordSelectionVersionId: "keyword-0",
        corpusPolicyVersionId: "corpus-policy-0",
        classificationPolicyVersionId: "classification-policy-0",
        keywordPolicyVersionId: "keyword-policy-0",
        accountPolicyVersionId: "account-policy-0",
        projectionDefinitionVersionId: "projection-0",
      },
      target: { promotionStream: "production", deploymentTarget: "production" },
    },
  });
  await startCommentDataUpdateV3({ runtime: environment.runtime, controlPlane, sessionId, input });
  return { ...environment, controlPlane, db, root, workspace, sessionId };
}

function task(runtime, sessionId, stepId) {
  const value = Object.values(runtime.state(sessionId)?.tasks ?? {}).find((item) => item.stepId === stepId);
  assert.ok(value, `task ${stepId} must exist`);
  return value;
}

async function submitFile(fixture, stepId, logicalPath, value) {
  const actor = { actorId: "reviewer", actorType: "human" };
  const current = task(fixture.runtime, fixture.sessionId, stepId);
  const execution = await fixture.runtime.openHumanTaskWorkspace(fixture.sessionId, current.taskId, actor);
  await writeFile(path.join(execution.outputPath, logicalPath), JSON.stringify(value));
  return completeValidatedHumanArtifact({
    runtime: fixture.runtime,
    registry: fixture.workspace.registry,
    artifactStore: fixture.workspace.artifactStore,
    sessionId: fixture.sessionId,
    taskId: current.taskId,
    actor,
    executionId: execution.executionId,
    outputDirectory: execution.outputPath,
    stepId,
  });
}

async function submitDecision(fixture, stepId, outcome = "accept") {
  const current = task(fixture.runtime, fixture.sessionId, stepId);
  return fixture.runtime.completeHumanTaskWithInput(
    fixture.sessionId,
    current.taskId,
    { actorId: "reviewer", actorType: "human" },
    { outcome, result: { rationale: "v3 integration test" } },
    `v3-decision:${stepId}`,
  );
}

async function disposeLocalFixture(fixture) {
  fixture.workspace.registry.close();
  fixture.db.close();
  await rm(fixture.root, { recursive: true, force: true });
}

test("[V3-E2E01][V3-HF05] local v3 runtime completes review, deployment event, and record flow", async () => {
  const fixture = await localFixture();
  try {
    await submitFile(fixture, "00-receive-update-artifact", "comment-batch.json", []);
    const stateAfterEvidence = fixture.runtime.state(fixture.sessionId);
    const worksetId = stateAfterEvidence.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await submitFile(fixture, "03b-receive-classification-response", "response.json", { workset_id: worksetId, decisions: {} });
    await submitDecision(fixture, "05-review-classification");
    await submitFile(fixture, "07b-receive-keyword-proposal", "candidate_proposal.json", { schema_version: 1, request_id: "candidate", input_fingerprint: "candidate-input", actions: [] });
    await submitDecision(fixture, "09-review-keyword-selection");
    await submitDecision(fixture, "13-review-production-promotion");

    const beforeEvent = fixture.runtime.state(fixture.sessionId);
    const trigger = beforeEvent.resultsByStepId["16-trigger-deployment"];
    assert.equal(trigger.stateResult, "triggered");
    const requestId = trigger.refs.deploymentRequestId;
    const deployment = fixture.agentAdapter.taskHandlers.services.deployment;
    deployment.adapter.complete(requestId, "succeeded");
    deployment.receiveCompletedEvent({
      eventId: "v3-e2e-deployment-event",
      eventType: "deployment.completed",
      correlationKey: requestId,
      payload: {
        deploymentRequestId: requestId,
        target: "production",
        releaseId: trigger.refs.releaseId,
        status: "succeeded",
        externalRunRef: "v3-e2e-external-run",
      },
    });
    const delivery = await deployment.deliverPendingEvents(
      (sessionId, event, commandId) => fixture.runtime.receiveExternalEvent(sessionId, event, { actorId: "provider", actorType: "external" }, commandId),
      { registry: fixture.workspace.registry },
    );
    assert.deepEqual(delivery, { delivered: ["v3-e2e-deployment-event"], deadLettered: [] });
    const completed = fixture.runtime.state(fixture.sessionId);
    assert.equal(completed.session.state, "completed");
    assert.equal(completed.resultsByStepId["19-verify-deployment"].stateResult, "verified");
    assert.equal(completed.resultsByStepId["20-record-deployment-state"].stateResult, "committed");
  } finally {
    await disposeLocalFixture(fixture);
  }
});

test("[V3-E2E02] Human reject at Classification, Keyword, and Promotion prevents downstream execution", async () => {
  const classification = await localFixture("v3-e2e-reject-classification", "update-v3-reject-classification");
  try {
    await submitFile(classification, "00-receive-update-artifact", "comment-batch.json", []);
    const worksetId = classification.runtime.state(classification.sessionId).resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await submitFile(classification, "03b-receive-classification-response", "response.json", { workset_id: worksetId, decisions: {} });
    await submitDecision(classification, "05-review-classification", "reject");
    const state = classification.runtime.state(classification.sessionId);
    assert.equal(state.session.state, "completed");
    assert.equal(state.resultsByStepId["06-finalize-classification"].stateResult, "rejected");
    assert.equal(state.resultsByStepId["07a-prepare-keyword-handoff"], undefined);
  } finally {
    await disposeLocalFixture(classification);
  }

  const keyword = await localFixture("v3-e2e-reject-keyword", "update-v3-reject-keyword");
  try {
    await submitFile(keyword, "00-receive-update-artifact", "comment-batch.json", []);
    const worksetId = keyword.runtime.state(keyword.sessionId).resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await submitFile(keyword, "03b-receive-classification-response", "response.json", { workset_id: worksetId, decisions: {} });
    await submitDecision(keyword, "05-review-classification");
    await submitFile(keyword, "07b-receive-keyword-proposal", "candidate_proposal.json", { schema_version: 1, request_id: "candidate", input_fingerprint: "candidate-input", actions: [] });
    await submitDecision(keyword, "09-review-keyword-selection", "reject");
    const state = keyword.runtime.state(keyword.sessionId);
    assert.equal(state.session.state, "completed");
    assert.equal(state.resultsByStepId["10-finalize-keyword-selection"].stateResult, "rejected");
    assert.equal(state.resultsByStepId["11-build-release-bundle"], undefined);
  } finally {
    await disposeLocalFixture(keyword);
  }

  const promotion = await localFixture("v3-e2e-reject-promotion", "update-v3-reject-promotion");
  try {
    await submitFile(promotion, "00-receive-update-artifact", "comment-batch.json", []);
    const worksetId = promotion.runtime.state(promotion.sessionId).resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await submitFile(promotion, "03b-receive-classification-response", "response.json", { workset_id: worksetId, decisions: {} });
    await submitDecision(promotion, "05-review-classification");
    await submitFile(promotion, "07b-receive-keyword-proposal", "candidate_proposal.json", { schema_version: 1, request_id: "candidate", input_fingerprint: "candidate-input", actions: [] });
    await submitDecision(promotion, "09-review-keyword-selection");
    await submitDecision(promotion, "13-review-production-promotion", "reject");
    const state = promotion.runtime.state(promotion.sessionId);
    assert.equal(state.session.state, "completed");
    assert.equal(state.resultsByStepId["14-finalize-production-promotion"].stateResult, "rejected");
    assert.equal(state.resultsByStepId["16-trigger-deployment"], undefined);
  } finally {
    await disposeLocalFixture(promotion);
  }
});

test("[V3-E2E03] Accepted Promotion Decision is retained while a concurrent head advance supersedes the stale commit", async () => {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  seedV3State(controlPlane);
  db.prepare("INSERT INTO v3_release_bundles (release_id, release_key, pins_json, projection_definition_version_id, bundle_sha256, bundle_json, materialization_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "release-e2e3",
    "release-key-e2e3",
    JSON.stringify({}),
    "projection-0",
    "0".repeat(64),
    JSON.stringify({ schema_version: 1 }),
    JSON.stringify({ projectionDefinitionVersionId: "projection-0", artifacts: [] }),
    controlPlane.now(),
  );
  const service = new PromotionApplicationServiceV3(controlPlane);
  const proposed = service.propose(
    createV3OperationContext({ sessionId: "v3-e2e03", stepId: "13-propose-production-promotion", permissions: ["state:read", "state:propose"] }),
    { releaseId: "release-e2e3", promotionStream: "production" },
  );
  const promotionStream = controlPlane.ensureStream(STREAM_KEYS.promotion);
  const competingState = { target: "production", releaseId: "release-e2e3-newer" };
  const competingProposal = controlPlane.createProposal({
    proposalId: "proposal-e2e3-competing",
    streamId: promotionStream.stream_id,
    expectedHeadVersionId: null,
    proposedSemanticSha256: semanticSha256(competingState),
    payload: { schema_version: 1, state: competingState },
    operationId: "operation-e2e3-competing-proposal",
  });
  const competingDecision = controlPlane.createDecision({
    decisionId: "decision-e2e3-competing",
    proposalId: competingProposal.proposalId,
    outcome: "accepted",
    authorityKind: "system_policy",
    authorityRef: "test",
    transitionPolicyVersionId: "promotion-policy-0",
    operationId: "operation-e2e3-competing-decision",
  });
  const competingCommit = controlPlane.commitProposal({ proposalId: competingProposal.proposalId, decisionId: competingDecision.decisionId, operationId: "operation-e2e3-competing-commit" });

  const result = service.finalize(
    createV3OperationContext({ sessionId: "v3-e2e03", stepId: "14-finalize-production-promotion", permissions: ["state:read", "state:commit"] }),
    { proposalId: proposed.refs.proposalId, releaseId: "release-e2e3", review: { outcome: "accept", actor: { actorId: "reviewer", actorType: "human" }, rationale: "stale-head test" } },
  );
  assert.equal(result.stateResult, "conflict");
  assert.equal(controlPlane.readDecision(proposed.refs.proposalId).outcome, "accepted");
  assert.equal(controlPlane.resolveHead(promotionStream.stream_id).versionId, competingCommit.versionId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM state_transitions WHERE decision_id = ?").get(controlPlane.readDecision(proposed.refs.proposalId).decisionId).count, 0);
  db.close();
});

test("[V3-E2E04] Newer Promotion prevents older deployment authority from committing and stale queued requests make no external call", async () => {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  seedV3State(controlPlane);
  const firstPromotion = seed(controlPlane, STREAM_KEYS.promotion, "promotion-e2e4-1", { target: "production", releaseId: "release-e2e4-1" });
  const promotionStream = controlPlane.ensureStream(STREAM_KEYS.promotion);
  const newerState = { target: "production", releaseId: "release-e2e4-2" };
  const newerProposal = controlPlane.createProposal({
    proposalId: "proposal-e2e4-newer",
    streamId: promotionStream.stream_id,
    expectedHeadVersionId: firstPromotion.versionId,
    proposedSemanticSha256: semanticSha256(newerState),
    payload: { schema_version: 1, state: newerState },
    operationId: "operation-e2e4-newer-proposal",
  });
  const newerDecision = controlPlane.createDecision({
    decisionId: "decision-e2e4-newer",
    proposalId: newerProposal.proposalId,
    outcome: "accepted",
    authorityKind: "system_policy",
    authorityRef: "test",
    transitionPolicyVersionId: "promotion-policy-0",
    operationId: "operation-e2e4-newer-decision",
  });
  const adapterCalls = [];
  const completed = new Set();
  const adapter = {
    async ensureDeployment(request) {
      adapterCalls.push(request.deploymentRequestId);
      return { status: "requested", externalRunRef: `run-${request.deploymentRequestId}` };
    },
    async verifyDeployment(request) {
      const verified = completed.has(request.deploymentRequestId);
      return { verified, servedReleaseId: verified ? request.releaseId : null, verificationRef: verified ? `verification-${request.deploymentRequestId}` : null };
    },
  };
  const service = new DeploymentQueueServiceV3(controlPlane, { adapter });
  const oldRequest = { acceptedPromotionDecisionId: "decision-e2e4-old", promotionVersionId: firstPromotion.versionId, releaseId: "release-e2e4-1", target: "production" };
  const oldContext = createV3OperationContext({ sessionId: "v3-e2e04-old", stepId: "16-trigger-deployment", permissions: ["state:read", "deployment:trigger"] });
  const firstTrigger = await service.trigger(oldContext, oldRequest);
  assert.equal(firstTrigger.stateResult, "triggered");
  assert.equal(adapterCalls.length, 1);

  const newerCommit = controlPlane.commitProposal({ proposalId: newerProposal.proposalId, decisionId: newerDecision.decisionId, operationId: "operation-e2e4-newer-commit" });
  const newRequest = { acceptedPromotionDecisionId: "decision-e2e4-new", promotionVersionId: newerCommit.versionId, releaseId: "release-e2e4-2", target: "production" };
  const newContext = createV3OperationContext({ sessionId: "v3-e2e04-new", stepId: "16-trigger-deployment", permissions: ["state:read", "deployment:trigger"] });
  const waiting = await service.trigger(newContext, newRequest);
  assert.equal(waiting.stateResult, "triggered");
  assert.equal(adapterCalls.length, 1);

  completed.add(firstTrigger.refs.deploymentRequestId);
  service.receiveCompletedEvent({ eventId: "e2e4-old-completed", eventType: "deployment.completed", correlationKey: firstTrigger.refs.deploymentRequestId, payload: { deploymentRequestId: firstTrigger.refs.deploymentRequestId, target: "production", releaseId: "release-e2e4-1", status: "succeeded", externalRunRef: `run-${firstTrigger.refs.deploymentRequestId}` } });
  const oldVerification = await service.verify(createV3OperationContext({ sessionId: "v3-e2e04-old", stepId: "19-verify-deployment", permissions: ["state:read", "deployment:verify"] }), { deploymentRequestId: firstTrigger.refs.deploymentRequestId, releaseId: "release-e2e4-1", promotionVersionId: firstPromotion.versionId });
  assert.equal(oldVerification.stateResult, "conflict");
  assert.equal(controlPlane.streamId(STREAM_KEYS.deployment.domain, STREAM_KEYS.deployment.streamKey), null);

  const secondTrigger = await service.trigger(newContext, newRequest);
  assert.equal(secondTrigger.stateResult, "triggered");
  assert.equal(adapterCalls.length, 2);
  completed.add(secondTrigger.refs.deploymentRequestId);
  service.receiveCompletedEvent({ eventId: "e2e4-new-completed", eventType: "deployment.completed", correlationKey: secondTrigger.refs.deploymentRequestId, payload: { deploymentRequestId: secondTrigger.refs.deploymentRequestId, target: "production", releaseId: "release-e2e4-2", status: "succeeded", externalRunRef: `run-${secondTrigger.refs.deploymentRequestId}` } });
  const verification = await service.verify(createV3OperationContext({ sessionId: "v3-e2e04-new", stepId: "19-verify-deployment", permissions: ["state:read", "deployment:verify"] }), { deploymentRequestId: secondTrigger.refs.deploymentRequestId, releaseId: "release-e2e4-2", promotionVersionId: newerCommit.versionId });
  assert.equal(verification.stateResult, "verified");
  const recorded = service.record(createV3OperationContext({ sessionId: "v3-e2e04-new", stepId: "20-record-deployment-state", permissions: ["state:read", "state:propose", "state:auto-decide", "state:commit"] }), { deploymentRequestId: secondTrigger.refs.deploymentRequestId, releaseId: "release-e2e4-2", promotionVersionId: newerCommit.versionId, verificationRef: verification.refs.verificationRef });
  assert.equal(recorded.stateResult, "committed");
  assert.equal(controlPlane.resolveHead(STREAM_KEYS.deployment).payload.state.deploymentRequestId, secondTrigger.refs.deploymentRequestId);

  const staleRequest = { acceptedPromotionDecisionId: "decision-e2e4-stale", promotionVersionId: firstPromotion.versionId, releaseId: "release-e2e4-1", target: "production" };
  service.ensureIntent(createV3OperationContext({ sessionId: "v3-e2e04-stale", stepId: "16-trigger-deployment" }), staleRequest);
  const stale = await service.trigger(createV3OperationContext({ sessionId: "v3-e2e04-stale", stepId: "16-trigger-deployment", permissions: ["state:read", "deployment:trigger"] }), staleRequest);
  assert.equal(stale.stateResult, "conflict");
  assert.equal(adapterCalls.length, 2);
  assert.equal(db.prepare("SELECT status FROM v3_deployment_requests WHERE accepted_promotion_decision_id = ?").get("decision-e2e4-stale").status, "superseded");
  db.close();
});

test("[V3-DE03][V3-DE09][V3-DE10] deployment queue claims one external call and receipt-first delivery", async () => {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  const promotion = seed(controlPlane, STREAM_KEYS.promotion, "promotion-1", { target: "production", releaseId: "release-1" });
  seed(controlPlane, STREAM_KEYS.deploymentPolicy, "deployment-policy-1", { policy_kind: "deployment-production", auto_commit: true });
  let active = 0;
  let maxActive = 0;
  const adapter = {
    async ensureDeployment() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: "requested", externalRunRef: "run-1" };
    },
    async verifyDeployment() { return { verified: false, servedReleaseId: null, verificationRef: null }; },
  };
  const service = new DeploymentQueueServiceV3(controlPlane, { adapter });
  const first = createV3OperationContext({ sessionId: "dispatcher-1", stepId: "16-trigger-deployment", permissions: ["state:read", "deployment:trigger"] });
  const second = createV3OperationContext({ sessionId: "dispatcher-2", stepId: "16-trigger-deployment", permissions: ["state:read", "deployment:trigger"] });
  const request = { acceptedPromotionDecisionId: "decision-1", promotionVersionId: promotion.versionId, releaseId: "release-1", target: "production" };
  const [left, right] = await Promise.all([service.trigger(first, request), service.trigger(second, request)]);
  assert.equal(maxActive, 1);
  assert.deepEqual(new Set([left.stateResult, right.stateResult]), new Set(["triggered"]));
  const requestRow = db.prepare("SELECT deployment_request_id, deployment_sequence, status FROM v3_deployment_requests").get();
  assert.equal(requestRow.deployment_sequence, 1);
  assert.equal(requestRow.status, "active");

  const event = { eventId: "receipt-first-event", eventType: "deployment.completed", correlationKey: requestRow.deployment_request_id, payload: { deploymentRequestId: requestRow.deployment_request_id, target: "production", releaseId: "release-1", status: "succeeded", externalRunRef: "run-1" } };
  service.receiveCompletedEvent(event);
  const eventRow = db.prepare("SELECT request_sha256, command_id FROM v3_deployment_event_outbox").get();
  let delivered = false;
  const result = await service.deliverPendingEvents(() => { delivered = true; }, { registry: { getReceipt: () => ({ requestHash: eventRow.request_sha256 }) } });
  assert.equal(delivered, false);
  assert.deepEqual(result, { delivered: ["receipt-first-event"], deadLettered: [] });
  assert.equal(eventRow.command_id, "event:receipt-first-event");
  assert.equal(semanticSha256(event), eventRow.request_sha256);
  db.close();
});

test("[V3-E2E01] Temporal runtime facade registers the same v3 definition and forwards the pinned start input", async () => {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  seedV3State(controlPlane);
  const registry = new Registry();
  const artifactStore = ArtifactStore.temporary();
  const calls = [];
  try {
    const environment = createV3TemporalRuntime({
      controlPlane,
      registry,
      artifactStore,
      client: {
        async start(input) {
          calls.push(input);
          return { workflowId: input.sessionId };
        },
      },
    });
    const input = prepareV3SessionInput({
      controlPlane,
      input: {
        updateRequestId: "update-v3-temporal-facade",
        pinned: {
          initialCorpusVersionId: "corpus-0",
          classificationVersionId: "classification-0",
          keywordSelectionVersionId: "keyword-0",
          corpusPolicyVersionId: "corpus-policy-0",
          classificationPolicyVersionId: "classification-policy-0",
          keywordPolicyVersionId: "keyword-policy-0",
          accountPolicyVersionId: "account-policy-0",
          projectionDefinitionVersionId: "projection-0",
        },
        target: { promotionStream: "production", deploymentTarget: "production" },
      },
    });
    await startCommentDataUpdateV3({ runtime: environment.runtime, controlPlane, sessionId: "v3-temporal-facade", input });
    assert.equal(environment.revision, 3);
    assert.equal(environment.definition.definitionHash, "9598f503ba9a8e8753e0b1d9d1e4af2f1a80a4d10b718aba5ab250840438a726");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].revision, 3);
    assert.deepEqual(calls[0].input, input);
    assert.equal(typeof environment.activities.commitCommand, "function");
  } finally {
    registry.close();
    db.close();
    await rm(artifactStore.root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore, claimTaskUpdate, completeHumanTaskUpdate, receiveExternalEventUpdate, Registry, runtimeStateQuery, workSessionWorkflow } from "work-orchestrator";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { createV3TemporalRuntime, prepareV3SessionInput, startClassificationCorrectionBatchV3 } from "../src/integration/v3-runtime.js";
import { DeploymentQueueServiceV3 } from "../src/application/v3/deployment-services.js";
import { createV3OperationContext } from "../src/application/v3/context.js";
import { STREAM_KEYS, typedClassificationHandler, typedCorpusHandler } from "../src/application/services.js";
import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInputIntoDatabase } from "../src/database/comment-database.js";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { semanticSha256 } from "../src/state/canonical.js";
import { testKeywordHandoffBuilder } from "./v3-keyword-handoff-test-support.js";

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

function findTemporalTask(state, stepId) {
  return Object.values(state?.tasks ?? {}).find((item) => item.stepId === stepId && item.state === "ready");
}

function temporalTask(state, stepId) {
  const task = findTemporalTask(state, stepId);
  assert.ok(task, `Temporal task ${stepId} must be ready`);
  return task;
}

async function waitForTemporalState(handle, predicate, attempts = 120) {
  for (let index = 0; index < attempts; index += 1) {
    const state = await handle.query(runtimeStateQuery);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return handle.query(runtimeStateQuery);
}

async function completeTemporalDecision(handle, stepId, outcome = "accept") {
  const state = await waitForTemporalState(handle, (candidate) => findTemporalTask(candidate, stepId));
  const task = temporalTask(state, stepId);
  return handle.executeUpdate(completeHumanTaskUpdate, {
    args: [{ taskId: task.taskId, actor: { actorId: "reviewer", actorType: "human" }, outcome, result: { rationale: "v3 temporal integration test" }, commandId: `temporal-decision:${stepId}` }],
  });
}

async function completeTemporalArtifact({ handle, artifactStore, stepId, logicalPath, value }) {
  const state = await waitForTemporalState(handle, (candidate) => findTemporalTask(candidate, stepId));
  const task = temporalTask(state, stepId);
  const actor = { actorId: "reviewer", actorType: "human" };
  const claimed = await handle.executeUpdate(claimTaskUpdate, {
    args: [{ taskId: task.taskId, actor, commandId: `temporal-claim:${stepId}` }],
  });
  const content = Buffer.from(JSON.stringify(value));
  const staged = artifactStore.stage(content, "application/json");
  artifactStore.finalize(staged);
  const artifact = {
    artifactVersionId: `${claimed.executionId}:artifact:0`,
    artifactKind: "file",
    blobHash: staged.blobHash,
    size: staged.size,
    mediaType: "application/json",
    logicalPath,
    origin: { kind: "execution", executionId: claimed.executionId },
    immutable: true,
  };
  return handle.executeUpdate(completeHumanTaskUpdate, {
    args: [{
      taskId: task.taskId,
      actor,
      outcome: "submitted",
      result: { executionId: claimed.executionId, artifact: { artifactVersionId: artifact.artifactVersionId, blobHash: artifact.blobHash, logicalPath, size: artifact.size } },
      artifactVersions: [artifact],
      commandId: `temporal-submit:${stepId}`,
    }],
  });
}

async function completeTemporalKeywordProposal(fixture) {
  const state = await waitForTemporalState(fixture.handle, (candidate) => findTemporalTask(candidate, "07b-receive-keyword-proposal"));
  const refs = state.resultsByStepId["07a-prepare-keyword-handoff"].refs;
  return completeTemporalArtifact({
    handle: fixture.handle,
    artifactStore: fixture.artifactStore,
    stepId: "07b-receive-keyword-proposal",
    logicalPath: "candidate_proposal.json",
    value: { schema_version: 1, request_id: refs.candidateRequestId, input_fingerprint: refs.candidateInputFingerprint, actions: [] },
  });
}

function temporalInput(controlPlane, updateRequestId) {
  return prepareV3SessionInput({
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
}

async function temporalHarness({ environment = undefined, taskQueue = "comment-db-v3-temporal-e2e", seedState = seedV3State } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "comment-db-v3-temporal-e2e-"));
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  seedState(controlPlane);
  const registry = new Registry(path.join(root, "registry.sqlite"));
  const artifactStore = new ArtifactStore(path.join(root, "artifacts"));
  const ownedEnvironment = environment ?? await TestWorkflowEnvironment.createLocal();
  const runtime = createV3TemporalRuntime({ controlPlane, registry, artifactStore, revision: 3, keywordHandoffBuilder: testKeywordHandoffBuilder });
  const worker = await Worker.create({
    connection: ownedEnvironment.nativeConnection,
    taskQueue,
    workflowsPath: realpathSync(fileURLToPath(new URL("../../node_modules/work-orchestrator/dist/temporal-workflow.js", import.meta.url))),
    activities: runtime.activities,
  });
  const workerRun = worker.run();
  return { root, db, controlPlane, registry, artifactStore, environment: ownedEnvironment, runtime, worker, workerRun, taskQueue, ownsEnvironment: !environment };
}

async function startTemporalSession(harness, sessionId, updateRequestId = `${sessionId}:request`) {
  const handle = await harness.environment.client.workflow.start(workSessionWorkflow, {
    workflowId: sessionId,
    taskQueue: harness.taskQueue,
    args: [{ sessionId, workDefinitionId: "comment-data-update", revision: 3, input: temporalInput(harness.controlPlane, updateRequestId) }],
  });
  return { ...harness, handle, sessionId };
}

async function temporalFixture(sessionId, options = {}) {
  const harness = await temporalHarness(options);
  return startTemporalSession(harness, sessionId);
}

async function disposeTemporalFixture(fixture) {
  await fixture.worker.shutdown();
  await fixture.workerRun.catch(() => undefined);
  if (fixture.ownsEnvironment) await fixture.environment.teardown();
  fixture.registry.close();
  fixture.db.close();
  await rm(fixture.root, { recursive: true, force: true });
}

function commitCompetingTemporalPromotion(controlPlane, releaseId, operationSuffix) {
  const promotionStream = controlPlane.ensureStream(STREAM_KEYS.promotion);
  const expectedHeadVersionId = controlPlane.resolveHead(promotionStream.stream_id)?.versionId ?? null;
  const state = { target: "production", releaseId };
  const proposal = controlPlane.createProposal({ proposalId: `proposal-${operationSuffix}`, streamId: promotionStream.stream_id, expectedHeadVersionId, proposedSemanticSha256: semanticSha256(state), payload: { schema_version: 1, state }, operationId: `operation-${operationSuffix}-proposal` });
  const decision = controlPlane.createDecision({ decisionId: `decision-${operationSuffix}`, proposalId: proposal.proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "temporal-e2e", transitionPolicyVersionId: "promotion-policy-0", operationId: `operation-${operationSuffix}-decision` });
  return controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: `operation-${operationSuffix}-commit` });
}

test("[V3-E2E01][V3-HF05][V3-DE02] Temporal v3 runtime completes artifact, review, deployment event, and record flow", { timeout: 120_000 }, async () => {
  const fixture = await temporalFixture("v3-temporal-e2e");
  try {
    await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "00-receive-update-artifact", logicalPath: "comment-batch.json", value: [] });
    const afterClassificationHandoff = await waitForTemporalState(fixture.handle, (state) => findTemporalTask(state, "03b-receive-classification-response"));
    const worksetId = afterClassificationHandoff.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "03b-receive-classification-response", logicalPath: "response.json", value: { workset_id: worksetId, decisions: {} } });
    await completeTemporalDecision(fixture.handle, "05-review-classification");
    await completeTemporalKeywordProposal(fixture);
    await completeTemporalDecision(fixture.handle, "09-review-keyword-selection");
    await completeTemporalDecision(fixture.handle, "13-review-production-promotion");
    const beforeEvent = await waitForTemporalState(fixture.handle, (state) => state.resultsByStepId["16-trigger-deployment"]?.stateResult === "triggered");
    const trigger = beforeEvent.resultsByStepId["16-trigger-deployment"];
    const deployment = fixture.runtime.agentAdapter.taskHandlers.services.deployment;
    const requestId = trigger.refs.deploymentRequestId;
    deployment.adapter.complete(requestId, "succeeded");
    const event = { eventId: "v3-temporal-deployment-event", eventType: "deployment.completed", correlationKey: requestId, payload: { deploymentRequestId: requestId, target: "production", releaseId: trigger.refs.releaseId, status: "succeeded", externalRunRef: "v3-temporal-external-run" } };
    deployment.receiveCompletedEvent(event);
    const delivery = await deployment.deliverPendingEvents((sessionId, deliveredEvent, commandId) => fixture.handle.executeUpdate(receiveExternalEventUpdate, { args: [{ event: deliveredEvent, actor: { actorId: "provider", actorType: "external" }, commandId }] }), { registry: fixture.registry });
    assert.deepEqual(delivery, { delivered: [event.eventId], deadLettered: [] });
    const completed = await waitForTemporalState(fixture.handle, (state) => state.session.state === "completed");
    assert.equal(completed.resultsByStepId["19-verify-deployment"].stateResult, "verified");
    assert.equal(completed.resultsByStepId["20-record-deployment-state"].stateResult, "committed");
  } finally {
    await disposeTemporalFixture(fixture);
  }
});

test("[V3-E2E02] Temporal Human reject at Classification, Keyword, and Promotion prevents downstream execution", { timeout: 180_000 }, async () => {
  const cases = [
    { suffix: "classification", rejectStep: "05-review-classification", rejectedStep: "06-finalize-classification", downstreamStep: "07a-prepare-keyword-handoff" },
    { suffix: "keyword", rejectStep: "09-review-keyword-selection", rejectedStep: "10-finalize-keyword-selection", downstreamStep: "11-build-release-bundle" },
    { suffix: "promotion", rejectStep: "13-review-production-promotion", rejectedStep: "14-finalize-production-promotion", downstreamStep: "16-trigger-deployment" },
  ];
  for (const item of cases) {
    const fixture = await temporalFixture(`v3-temporal-e2e02-${item.suffix}`);
    try {
      await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "00-receive-update-artifact", logicalPath: "comment-batch.json", value: [] });
      const state = await waitForTemporalState(fixture.handle, (candidate) => findTemporalTask(candidate, "03b-receive-classification-response"));
      const worksetId = state.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
      await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "03b-receive-classification-response", logicalPath: "response.json", value: { workset_id: worksetId, decisions: {} } });
      if (item.suffix !== "classification") {
        await completeTemporalDecision(fixture.handle, "05-review-classification");
        await completeTemporalKeywordProposal(fixture);
      }
      if (item.suffix === "promotion") await completeTemporalDecision(fixture.handle, "09-review-keyword-selection");
      await completeTemporalDecision(fixture.handle, item.rejectStep, "reject");
      const completed = await waitForTemporalState(fixture.handle, (candidate) => candidate.session.state === "completed");
      assert.equal(completed.resultsByStepId[item.rejectedStep].stateResult, "rejected");
      assert.equal(completed.resultsByStepId[item.downstreamStep], undefined);
    } finally {
      await disposeTemporalFixture(fixture);
    }
  }
});

test("[V3-E2E03] Temporal accepted Promotion Decision is retained while a concurrent head advance supersedes the stale commit", { timeout: 120_000 }, async () => {
  const fixture = await temporalFixture("v3-temporal-e2e03");
  try {
    await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "00-receive-update-artifact", logicalPath: "comment-batch.json", value: [] });
    const afterClassificationHandoff = await waitForTemporalState(fixture.handle, (state) => findTemporalTask(state, "03b-receive-classification-response"));
    const worksetId = afterClassificationHandoff.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "03b-receive-classification-response", logicalPath: "response.json", value: { workset_id: worksetId, decisions: {} } });
    await completeTemporalDecision(fixture.handle, "05-review-classification");
    await completeTemporalKeywordProposal(fixture);
    await completeTemporalDecision(fixture.handle, "09-review-keyword-selection");
    const waiting = await waitForTemporalState(fixture.handle, (state) => findTemporalTask(state, "13-review-production-promotion"));
    const proposalId = waiting.resultsByStepId["13-propose-production-promotion"].refs.proposalId;
    const releaseId = waiting.resultsByStepId["12-materialize-release"].refs.releaseId;
    const competing = commitCompetingTemporalPromotion(fixture.controlPlane, `${releaseId}-newer`, "temporal-e2e03-competing");
    await completeTemporalDecision(fixture.handle, "13-review-production-promotion");
    const completed = await waitForTemporalState(fixture.handle, (state) => state.session.state === "completed");
    assert.equal(completed.resultsByStepId["14-finalize-production-promotion"].stateResult, "conflict");
    assert.equal(completed.resultsByStepId["16-trigger-deployment"], undefined);
    assert.equal(fixture.controlPlane.readDecision(proposalId).outcome, "accepted");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.promotion).versionId, competing.versionId);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM v3_deployment_requests").get().count, 0);
  } finally {
    await disposeTemporalFixture(fixture);
  }
});

test("[V3-E2E04] Temporal same-target deployment race never lets an older result overwrite newer Promotion authority", { timeout: 180_000 }, async () => {
  const fixture = await temporalFixture("v3-temporal-e2e04-old");
  try {
    await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "00-receive-update-artifact", logicalPath: "comment-batch.json", value: [] });
    const afterClassificationHandoff = await waitForTemporalState(fixture.handle, (state) => findTemporalTask(state, "03b-receive-classification-response"));
    const worksetId = afterClassificationHandoff.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await completeTemporalArtifact({ handle: fixture.handle, artifactStore: fixture.artifactStore, stepId: "03b-receive-classification-response", logicalPath: "response.json", value: { workset_id: worksetId, decisions: {} } });
    await completeTemporalDecision(fixture.handle, "05-review-classification");
    await completeTemporalKeywordProposal(fixture);
    await completeTemporalDecision(fixture.handle, "09-review-keyword-selection");
    await waitForTemporalState(fixture.handle, (state) => findTemporalTask(state, "13-review-production-promotion"));
    await completeTemporalDecision(fixture.handle, "13-review-production-promotion");
    const olderTriggered = await waitForTemporalState(fixture.handle, (state) => state.resultsByStepId["16-trigger-deployment"]?.stateResult === "triggered");
    const olderRequestId = olderTriggered.resultsByStepId["16-trigger-deployment"].refs.deploymentRequestId;
    const olderReleaseId = olderTriggered.resultsByStepId["16-trigger-deployment"].refs.releaseId;
    const oldAdapter = fixture.runtime.agentAdapter.taskHandlers.services.deployment.adapter;
    const newerReleaseId = `${olderReleaseId}-newer`;
    const newerPromotion = commitCompetingTemporalPromotion(fixture.controlPlane, newerReleaseId, "temporal-e2e04-newer");
    oldAdapter.complete(olderRequestId, "succeeded");
    const oldDeployment = fixture.runtime.agentAdapter.taskHandlers.services.deployment;
    oldDeployment.receiveCompletedEvent({ eventId: "temporal-e2e04-old-completed", eventType: "deployment.completed", correlationKey: olderRequestId, payload: { deploymentRequestId: olderRequestId, target: "production", releaseId: olderReleaseId, status: "succeeded", externalRunRef: `run-${olderRequestId}` } });
    const oldDelivery = await oldDeployment.deliverPendingEvents((sessionId, event, commandId) => fixture.environment.client.workflow.getHandle(sessionId).executeUpdate(receiveExternalEventUpdate, { args: [{ event, actor: { actorId: "provider", actorType: "external" }, commandId }] }), { registry: fixture.registry });
    assert.deepEqual(oldDelivery, { delivered: ["temporal-e2e04-old-completed"], deadLettered: [] });
    const oldCompleted = await waitForTemporalState(fixture.handle, (state) => state.session.state === "completed");
    assert.equal(oldCompleted.resultsByStepId["19-verify-deployment"].stateResult, "conflict");

    const newDeployment = new DeploymentQueueServiceV3(fixture.controlPlane, { adapter: oldAdapter });
    const secondTrigger = await newDeployment.trigger(createV3OperationContext({ sessionId: "v3-temporal-e2e04-new", stepId: "16-trigger-deployment", permissions: ["state:read", "deployment:trigger"] }), { acceptedPromotionDecisionId: newerPromotion.decisionId, promotionVersionId: newerPromotion.versionId, releaseId: newerReleaseId, target: "production" });
    const newerRequestId = secondTrigger.refs.deploymentRequestId;
    assert.equal(secondTrigger.stateResult, "triggered");
    oldAdapter.complete(newerRequestId, "succeeded");
    newDeployment.receiveCompletedEvent({ eventId: "temporal-e2e04-new-completed", eventType: "deployment.completed", correlationKey: newerRequestId, payload: { deploymentRequestId: newerRequestId, target: "production", releaseId: newerReleaseId, status: "succeeded", externalRunRef: `run-${newerRequestId}` } });
    const verification = await newDeployment.verify(createV3OperationContext({ sessionId: "v3-temporal-e2e04-new", stepId: "19-verify-deployment", permissions: ["state:read", "deployment:verify"] }), { deploymentRequestId: newerRequestId, releaseId: newerReleaseId, promotionVersionId: newerPromotion.versionId });
    assert.equal(verification.stateResult, "verified");
    const recorded = newDeployment.record(createV3OperationContext({ sessionId: "v3-temporal-e2e04-new", stepId: "20-record-deployment-state", permissions: ["state:read", "state:propose", "state:auto-decide", "state:commit"] }), { deploymentRequestId: newerRequestId, releaseId: newerReleaseId, promotionVersionId: newerPromotion.versionId, verificationRef: verification.refs.verificationRef });
    assert.equal(recorded.stateResult, "committed");
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.deployment).payload.state.deploymentRequestId, newerRequestId);
  } finally {
    await disposeTemporalFixture(fixture);
  }
});


test("[V3-BATCH-TEMPORAL] authenticated batch binds one completed Human execution and commits once", async () => {
  const fixture = await temporalHarness({ taskQueue: "classification-correction-batch-temporal", seedState(controlPlane) {
    const comments = ["AAA", "AAA", "BBB"].map((comment, index) => ({ username: `u${index}`, handle: `h${index}`, comment, postedAt: "2026-10-01T00:00:00Z", postedDate: "2026-10-01" }));
    const imported = importRawInputIntoDatabase(controlPlane.db, adaptCommentBatchBytes(Buffer.from(JSON.stringify(comments))));
    for (const [stream, versionId, policyKind] of [
      [STREAM_KEYS.corpusPolicy, "corpus-policy-0", "corpus"], [STREAM_KEYS.classificationPolicy, "classification-policy-0", "classification"], [STREAM_KEYS.keywordPolicy, "keyword-policy-0", "keyword-selection"], [STREAM_KEYS.accountPolicy, "account-policy-0", "account-candidate"], [STREAM_KEYS.promotionPolicy, "promotion-policy-0", "promotion-production"], [STREAM_KEYS.deploymentPolicy, "deployment-policy-0", "deployment-production"],
    ]) seed(controlPlane, stream, versionId, { policy_kind: policyKind, auto_commit: true });
    seed(controlPlane, STREAM_KEYS.projectionDefinition, "projection-0", { schema_version: 1 });
    seed(controlPlane, STREAM_KEYS.keywordSelection, "keyword-0", { schema_version: 1, entries: [] });
    controlPlane.createGenesis({ streamId: controlPlane.ensureStream(STREAM_KEYS.corpus).stream_id, versionId: "corpus-0", payload: { schema_version: 1, state: { schema_version: 2, snapshot_refs: [{ payloadSha256: imported.payloadSha256, snapshotIndex: 0 }] } }, domainHandler: typedCorpusHandler() });
    controlPlane.createGenesis({ streamId: controlPlane.ensureStream(STREAM_KEYS.classification).stream_id, versionId: "classification-0", payload: { schema_version: 1, state: { schema_version: 2, labels: ["1", "2", "3"].map((observationId) => ({ observationId, label: "normal" })) } }, dependencies: [{ role: "corpus", versionId: "corpus-0" }, { role: "policy", versionId: "classification-policy-0" }], domainHandler: typedClassificationHandler() });
  } });
  try {
    let handle;
    const runtime = { registry: fixture.registry, start: async (input) => { handle = await fixture.environment.client.workflow.start(workSessionWorkflow, { workflowId: input.sessionId, taskQueue: fixture.taskQueue, args: [input] }); return { sessionId: input.sessionId }; } };
    const command = { correctionOperationId: "temporal-batch-operation", baseClassificationVersionId: "classification-0", corrections: ["1", "3"].map((targetObservationId) => ({ targetObservationId, expectedLabel: "normal", replacementLabel: "direct_nuisance", reason: "Temporalの一括修正を確認" })) };
    const actor = { actorType: "human", actorId: "requester" };
    await startClassificationCorrectionBatchV3({ runtime, controlPlane: fixture.controlPlane, sessionId: "temporal-batch-session", command, authenticatedActor: actor });
    await completeTemporalDecision(handle, "05-review-classification");
    const state = await waitForTemporalState(handle, (candidate) => candidate.resultsByStepId["06-finalize-correction-batch"]);
    const final = state.resultsByStepId["06-finalize-correction-batch"];
    assert.equal(final?.stateResult, "committed", JSON.stringify(state.tasks));
    assert.equal(fixture.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, final.refs.classificationVersionId);
    const resent = await startClassificationCorrectionBatchV3({ runtime, controlPlane: fixture.controlPlane, sessionId: "temporal-batch-resend", command, authenticatedActor: actor });
    assert.equal(resent.sessionId, "temporal-batch-session");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM state_transitions").get().n, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM v3_deployment_requests").get().n, 0);
    await handle.cancel();
  } finally { await disposeTemporalFixture(fixture); }
});

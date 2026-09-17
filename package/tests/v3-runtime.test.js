import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactStore, initWorkspace, openWorkspace, Registry } from "work-orchestrator";
import { completeValidatedHumanArtifact } from "../src/integration/human-artifact-completion-v3.js";
import { createV3LocalRuntime, createV3TemporalRuntime, prepareV3SessionInput, startCommentDataUpdateV3 } from "../src/integration/v3-runtime.js";
import { DeploymentQueueServiceV3 } from "../src/application/v3/deployment-services.js";
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

async function localFixture() {
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
      updateRequestId: "update-v3-e2e",
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
  await startCommentDataUpdateV3({ runtime: environment.runtime, controlPlane, sessionId: "v3-e2e-session", input });
  return { ...environment, controlPlane, db, root, workspace };
}

function task(runtime, sessionId, stepId) {
  const value = Object.values(runtime.state(sessionId)?.tasks ?? {}).find((item) => item.stepId === stepId);
  assert.ok(value, `task ${stepId} must exist`);
  return value;
}

async function submitFile(fixture, stepId, logicalPath, value) {
  const actor = { actorId: "reviewer", actorType: "human" };
  const current = task(fixture.runtime, "v3-e2e-session", stepId);
  const execution = await fixture.runtime.openHumanTaskWorkspace("v3-e2e-session", current.taskId, actor);
  await writeFile(path.join(execution.outputPath, logicalPath), JSON.stringify(value));
  return completeValidatedHumanArtifact({
    runtime: fixture.runtime,
    registry: fixture.workspace.registry,
    artifactStore: fixture.workspace.artifactStore,
    sessionId: "v3-e2e-session",
    taskId: current.taskId,
    actor,
    executionId: execution.executionId,
    outputDirectory: execution.outputPath,
    stepId,
  });
}

async function submitDecision(fixture, stepId, outcome = "accept") {
  const current = task(fixture.runtime, "v3-e2e-session", stepId);
  return fixture.runtime.completeHumanTaskWithInput(
    "v3-e2e-session",
    current.taskId,
    { actorId: "reviewer", actorType: "human" },
    { outcome, result: { rationale: "v3 integration test" } },
    `v3-decision:${stepId}`,
  );
}

test("[V3-E2E01][V3-HF05] local v3 runtime completes review, deployment event, and record flow", async () => {
  const fixture = await localFixture();
  try {
    await submitFile(fixture, "00-receive-update-artifact", "comment-batch.json", []);
    const stateAfterEvidence = fixture.runtime.state("v3-e2e-session");
    const worksetId = stateAfterEvidence.resultsByStepId["03a-prepare-classification-handoff"].refs.worksetId;
    await submitFile(fixture, "03b-receive-classification-response", "response.json", { workset_id: worksetId, decisions: {} });
    await submitDecision(fixture, "05-review-classification");
    await submitFile(fixture, "07b-receive-keyword-proposal", "candidate_proposal.json", { schema_version: 1, request_id: "candidate", input_fingerprint: "candidate-input", actions: [] });
    await submitDecision(fixture, "09-review-keyword-selection");
    await submitDecision(fixture, "13-review-production-promotion");

    const beforeEvent = fixture.runtime.state("v3-e2e-session");
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
    const completed = fixture.runtime.state("v3-e2e-session");
    assert.equal(completed.session.state, "completed");
    assert.equal(completed.resultsByStepId["19-verify-deployment"].stateResult, "verified");
    assert.equal(completed.resultsByStepId["20-record-deployment-state"].stateResult, "committed");
  } finally {
    fixture.workspace.registry.close();
    fixture.db.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
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

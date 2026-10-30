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
import { createV3OperationContext } from "../src/application/v3/context.js";
import { createV3LocalRuntime, startClassificationCorrectionBatchV3 } from "../src/integration/v3-runtime.js";
import { listV3HumanTasks, startV3ClassificationCorrectionBatch } from "../src/integration/v3-operator.js";
import { completeValidatedHumanArtifact } from "../src/integration/human-artifact-completion-v3.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { semanticSha256 } from "../src/state/canonical.js";
import { testKeywordHandoffBuilder } from "./v3-keyword-handoff-test-support.js";
import { batchOperationKey, readBatchCorrectionReviewSummary } from "../src/application/v3/correction-batch-service.js";
import { batchRequestFingerprint, buildBatchCorrectionChangeSet } from "../src/three-class/classification-correction-batch.js";

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


const corrections = [
  { targetObservationId: "1", expectedLabel: "direct_nuisance", replacementLabel: "normal", reason: "グループAを修正" },
  { targetObservationId: "3", expectedLabel: "reactive", replacementLabel: "normal", reason: "グループBを修正" },
];
function batchCommand(operationId = "batch-test", items = corrections) {
  return { correctionOperationId: operationId, baseClassificationVersionId: "classification-0", corrections: items };
}
async function environmentFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "correction-batch-"));
  const fixture = await makeFixture(path.join(root, "comments.sqlite3"), options);
  const workspacePath = path.join(root, "workspace");
  initWorkspace(workspacePath);
  const workspace = openWorkspace(workspacePath);
  const environment = createV3LocalRuntime({ controlPlane: fixture.controlPlane, registry: workspace.registry, artifactStore: workspace.artifactStore, workspace, keywordHandoffBuilder: testKeywordHandoffBuilder });
  return { ...fixture, ...environment, root, workspace, async close() { workspace.registry.close(); fixture.db.close(); await rm(root, { recursive: true, force: true }); } };
}
async function startBatch(env, { sessionId = "batch-session", command = batchCommand(), actorId = "requester", ...options } = {}) {
  return startClassificationCorrectionBatchV3({ runtime: env.runtime, controlPlane: env.controlPlane, sessionId, command, authenticatedActor: { actorType: "human", actorId }, ...options });
}
async function reviewTask(env, prefix, { outcome = "accept", sessionId = "batch-session", actorId = "reviewer" } = {}) {
  const state = env.runtime.state(sessionId);
  const task = Object.values(state.tasks).find((item) => item.stepId.startsWith(prefix));
  assert.ok(task, JSON.stringify(Object.values(state.tasks).map((row) => ({ step: row.stepId, state: row.state, attention: row.attention }))));
  const actor = { actorType: "human", actorId };
  await env.runtime.claimTask(sessionId, task.taskId, actor);
  await env.runtime.completeHumanTaskWithInput(sessionId, task.taskId, actor, { outcome, result: { rationale: "隔離環境で全件を確認" } }, `review:${sessionId}:${task.stepId}`);
  return env.runtime.state(sessionId);
}
async function completeKeyword(env, sessionId = "batch-session") {
  const state = env.runtime.state(sessionId);
  const task = Object.values(state.tasks).find((item) => item.stepId === "07b-receive-keyword-proposal");
  const actor = { actorId: "reviewer", actorType: "human" };
  const execution = await env.runtime.openHumanTaskWorkspace(sessionId, task.taskId, actor);
  const refs = state.resultsByStepId["07a-prepare-keyword-handoff"].refs;
  await writeFile(path.join(execution.outputPath, "candidate_proposal.json"), JSON.stringify({ schema_version: 1, request_id: refs.candidateRequestId, input_fingerprint: refs.candidateInputFingerprint, actions: [] }));
  await completeValidatedHumanArtifact({ runtime: env.runtime, registry: env.workspace.registry, artifactStore: env.workspace.artifactStore, sessionId, taskId: task.taskId, actor, executionId: execution.executionId, outputDirectory: execution.outputPath, stepId: task.stepId });
  return env.runtime.state(sessionId);
}
function tableCount(env, table) { return env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
function finalized(env, sessionId = "batch-session") { return env.runtime.state(sessionId).resultsByStepId["06-finalize-correction-batch"]; }

test("batch: one atomic Proposal and Version, separate Promotion review and one verified Deployment; cross-Session resends reuse the owner", async () => {
  const env = await environmentFixture();
  try {
    await startBatch(env);
    let state = env.runtime.state("batch-session");
    assert.equal(state.resultsByStepId["02-resolve-correction-batch"]?.details?.observationCount, 3, JSON.stringify(state.tasks));
    assert.equal(tableCount(env, "state_assessments"), 1);
    assert.equal(tableCount(env, "state_proposals"), 1);
    const proposal = state.resultsByStepId["03-propose-correction-batch"].refs;
    const summary = readBatchCorrectionReviewSummary(env.controlPlane, proposal);
    assert.equal(summary.groupCount, 2);
    assert.equal(summary.observationCount, 3);
    const resend = await startBatch(env, { sessionId: "another-session", command: batchCommand("batch-test", corrections.slice().reverse()) });
    assert.equal(resend.sessionId, "batch-session");
    assert.equal(env.runtime.state("another-session"), undefined);
    state = await reviewTask(env, "05-review-classification");
    assert.equal(finalized(env)?.stateResult, "committed", JSON.stringify(state.tasks));
    const versionId = finalized(env).refs.classificationVersionId;
    assert.deepEqual(readClassificationVersionLabels(env.db, versionId).map((row) => row.label), ["normal", "normal", "normal"]);
    assert.equal(tableCount(env, "v3_release_bundles"), 0);
    assert.equal(tableCount(env, "v3_deployment_requests"), 0);
    state = await completeKeyword(env);
    assert.equal(tableCount(env, "v3_release_bundles"), 1, JSON.stringify(state.tasks));
    const release = env.db.prepare("SELECT pins_json FROM v3_release_bundles").get();
    assert.equal(JSON.parse(release.pins_json).classificationVersionId, versionId);
    assert.equal(tableCount(env, "v3_deployment_requests"), 0);
    state = await reviewTask(env, "13-review-production-promotion");
    const trigger = Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("16-trigger-deployment"))?.[1];
    assert.ok(trigger, JSON.stringify(state.tasks));
    const deployment = env.agentAdapter.taskHandlers.services.deployment;
    const completed = deployment.adapter.complete(trigger.refs.deploymentRequestId, "succeeded");
    deployment.receiveCompletedEvent({ eventId: "batch-event", eventType: "deployment.completed", correlationKey: trigger.refs.deploymentRequestId, payload: { deploymentRequestId: trigger.refs.deploymentRequestId, target: "production", releaseId: trigger.refs.releaseId, status: "succeeded", externalRunRef: completed.externalRunRef } });
    await deployment.deliverPendingEvents((sessionId, event, commandId) => env.runtime.receiveExternalEvent(sessionId, event, { actorId: "memory", actorType: "external" }, commandId), { registry: env.workspace.registry });
    state = env.runtime.state("batch-session");
    assert.equal(state.session.state, "completed");
    assert.equal(Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("19-verify-deployment"))[1].stateResult, "verified");
    assert.equal(Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("20-record-deployment"))[1].stateResult, "committed");
    const counts = ["state_versions", "state_proposals", "v3_release_bundles", "v3_deployment_requests"].map((name) => tableCount(env, name));
    await startBatch(env, { sessionId: "after-deployment" });
    assert.deepEqual(["state_versions", "state_proposals", "v3_release_bundles", "v3_deployment_requests"].map((name) => tableCount(env, name)), counts);
    await assert.rejects(startBatch(env, { command: batchCommand("batch-test", [{ ...corrections[0], reason: "別内容" }]) }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  } finally { await env.close(); }
});

test("batch domain: exact text, string IDs, all-member expectations, duplicate groups and complete coverage", () => {
  const survivors = ["a", " a", "ａ", "a\n", "a"].map((commentText, i) => ({ observationId: ["001", "1", "2", "3", "4"][i], commentText }));
  const baseLabels = survivors.map(({ observationId }) => ({ observationId, label: "normal" }));
  const request = { corrections: [{ targetObservationId: "001", expectedLabel: "normal", replacementLabel: "reactive", reason: "完全一致" }] };
  const args = { request, survivors, baseLabels };
  const value = buildBatchCorrectionChangeSet(args);
  assert.deepEqual(value.changes.map((row) => row.observationId), ["001", "4"]);
  assert.equal(value.state.labels.find((row) => row.observationId === "1").label, "normal");
  const cases = [
    [{ ...request, corrections: [] }, "BATCH_INPUT_INVALID"],
    [{ corrections: [{ ...request.corrections[0], reason: " " }] }, "CORRECTION_REASON_REQUIRED"],
    [{ corrections: [{ ...request.corrections[0], replacementLabel: "normal" }] }, "UNCHANGED_CORRECTION"],
    [{ corrections: [{ ...request.corrections[0], expectedLabel: "unknown" }] }, "INVALID_LABEL"],
    [{ corrections: [{ ...request.corrections[0], targetObservationId: "unknown" }] }, "TARGET_NOT_FOUND"],
    [{ corrections: [request.corrections[0], { ...request.corrections[0], targetObservationId: "4" }] }, "DUPLICATE_GROUP"],
    [{ corrections: [request.corrections[0], { ...request.corrections[0], targetObservationId: "4", replacementLabel: "direct_nuisance" }] }, "DUPLICATE_GROUP"],
  ];
  for (const [bad, code] of cases) assert.throws(() => buildBatchCorrectionChangeSet({ ...args, request: bad }), (error) => error.code === code);
  assert.throws(() => buildBatchCorrectionChangeSet({ ...args, baseLabels: baseLabels.slice(1) }), (error) => error.code === "INCOMPLETE_CLASSIFICATION");
  assert.throws(() => buildBatchCorrectionChangeSet({ ...args, baseLabels: baseLabels.map((row) => row.observationId === "4" ? { ...row, label: "reactive" } : row) }), (error) => error.code === "EXPECTED_LABEL_MISMATCH");
  assert.deepEqual(args.baseLabels, baseLabels);
});

test("batch: invalid member or duplicate group terminates before Proposal/publication; rejection records one Decision", async () => {
  for (const [kind, items] of [
    ["unknown", [...corrections, { ...corrections[0], targetObservationId: "999" }]],
    ["duplicate", [...corrections, { ...corrections[0], targetObservationId: "2" }]],
    ["expectation", [{ ...corrections[0], expectedLabel: "reactive" }]],
    ["reject", corrections],
  ]) {
    const env = await environmentFixture();
    try {
      await startBatch(env, { command: batchCommand(kind, items) });
      if (kind === "reject") {
        await reviewTask(env, "05-review-classification", { outcome: "reject" });
        assert.equal(finalized(env).stateResult, "rejected");
        assert.equal(tableCount(env, "state_decisions"), 1);
      } else {
        assert.equal(env.runtime.state("batch-session").resultsByStepId["02-resolve-correction-batch"].stateResult, "blocked");
        assert.equal(tableCount(env, "state_proposals"), 0);
      }
      assert.equal(env.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, "classification-0");
      assert.equal(tableCount(env, "v3_release_bundles"), 0);
      assert.equal(tableCount(env, "v3_deployment_requests"), 0);
      assert.equal(Object.keys(env.runtime.state("batch-session").resultsByStepId).some((id) => id.startsWith("07")), false);
      assert.equal(env.runtime.state("batch-session").session.state, "completed");
    } finally { await env.close(); }
  }
});

function advanceHead(env, which) {
  const stream = env.controlPlane.ensureStream(which === "corpus" ? STREAM_KEYS.corpus : STREAM_KEYS.classification);
  const current = env.controlPlane.resolveHead(stream.stream_id);
  const state = { ...(current.payload?.state ?? current.payload), note: "concurrent advance" };
  const proposal = env.controlPlane.createProposal({ streamId: stream.stream_id, expectedHeadVersionId: current.versionId, payload: { schema_version: 1, state }, dependencies: env.controlPlane.readDependencies(current.versionId) });
  env.controlPlane.createDecision({ proposalId: proposal.proposalId, outcome: "accepted", authorityKind: "human", authorityRef: "reviewer", transitionPolicyVersionId: "classification-policy-0" });
  return env.controlPlane.commitProposal({ proposalId: proposal.proposalId, operationId: `advance-${which}` }).versionId;
}

test("batch: stale Classification/Corpus head stops atomically before downstream tasks", async () => {
  for (const which of ["classification", "corpus"]) {
    const env = await environmentFixture();
    try {
      await startBatch(env);
      const advanced = advanceHead(env, which);
      const counts = tableCount(env, "state_versions");
      await reviewTask(env, "05-review-classification");
      assert.equal(finalized(env).stateResult, "conflict");
      assert.equal(finalized(env).details.conflictAt, which);
      assert.equal(tableCount(env, "state_versions"), counts);
      assert.equal(env.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, which === "classification" ? advanced : "classification-0");
      assert.equal(tableCount(env, "v3_release_bundles"), 0);
      assert.equal(env.controlPlane.readReceipt(batchOperationKey("batch-test", "commit")), null);
      assert.equal(env.runtime.state("batch-session").session.state, "completed");
    } finally { await env.close(); }
  }
});

test("batch: tampered Proposal/Assessment/ChangeSet or unauthorized reviewer cannot commit", async () => {
  for (const kind of ["proposal", "assessment", "changeset", "reviewer"]) {
    const env = await environmentFixture();
    try {
      await startBatch(env);
      const refs = env.runtime.state("batch-session").resultsByStepId["03-propose-correction-batch"].refs;
      if (kind === "proposal") env.db.prepare("UPDATE state_proposals SET proposal_sha256 = ? WHERE proposal_id = ?").run("0".repeat(64), refs.proposalId);
      if (kind === "assessment") env.db.prepare("UPDATE state_assessments SET assessment_payload_json = '{}' WHERE assessment_id = ?").run(refs.assessmentId);
      if (kind === "changeset") env.db.prepare("UPDATE application_operation_receipts SET result_json = '{}' WHERE operation_id = ?").run(batchOperationKey("batch-test", "change-set"));
      await reviewTask(env, "05-review-classification", { actorId: kind === "reviewer" ? "intruder" : "reviewer" });
      assert.equal(finalized(env), undefined);
      assert.equal(env.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, "classification-0");
      assert.equal(tableCount(env, "state_decisions"), 0);
      assert.equal(tableCount(env, "v3_release_bundles"), 0);
      assert.equal(tableCount(env, "v3_deployment_requests"), 0);
    } finally { await env.close(); }
  }
});

test("batch: Proposal bundle and finalization roll back together, and committed result survives loss of the Task receipt", async () => {
  const env = await environmentFixture();
  try {
    const originalProposal = env.controlPlane.createProposal.bind(env.controlPlane);
    env.controlPlane.createProposal = (input) => { if (input.payload?.correctionBatch) throw new Error("injected save failure"); return originalProposal(input); };
    await startBatch(env);
    assert.equal(tableCount(env, "state_assessments"), 0);
    assert.equal(tableCount(env, "state_proposals"), 0);
    assert.equal(env.controlPlane.readReceipt(batchOperationKey("batch-test", "assessment")), null);
    env.controlPlane.createProposal = originalProposal;
    const service = env.agentAdapter.taskHandlers.services.correctionBatch;
    const registration = env.controlPlane.readReceipt(batchOperationKey("batch-test", "registration")).result;
    const resolved = env.controlPlane.readReceipt(batchOperationKey("batch-test", "change-set")).result;
    const ctx = createV3OperationContext({ sessionId: "batch-session", workDefinitionId: "classification-correction", workDefinitionRevision: 2, stepId: "03-propose-correction-batch", permissions: ["state:read", "state:propose"] });
    service.propose(ctx, { correctionOperationId: "batch-test", requestFingerprint: registration.requestFingerprint, changeSetId: batchOperationKey("batch-test", "change-set"), changeSetHash: resolved.changeSetHash });
    assert.equal(tableCount(env, "state_assessments"), 1);
    assert.equal(tableCount(env, "state_proposals"), 1);
  } finally { await env.close(); }

  const second = await environmentFixture();
  try {
    await startBatch(second);
    const handler = second.agentAdapter.taskHandlers.handlers["classification-correction.batch.finalize"];
    let lostResponse = false;
    second.agentAdapter.taskHandlers.handlers["classification-correction.batch.finalize"] = (ctx, input) => {
      const result = handler(ctx, input);
      if (!lostResponse) { lostResponse = true; throw new Error("crash after business commit, before Task receipt"); }
      return result;
    };
    await reviewTask(second, "05-review-classification");
    assert.equal(finalized(second).stateResult, "committed");
    assert.equal(tableCount(second, "state_transitions"), 1);
    assert.equal(tableCount(second, "state_decisions"), 1);
    assert.ok(second.controlPlane.readReceipt(batchOperationKey("batch-test", "finalization")));
    const finalizerTask = Object.values(second.runtime.state("batch-session").tasks).find((row) => row.stepId === "06-finalize-correction-batch");
    const ctx = createV3OperationContext({ sessionId: "batch-session", workDefinitionId: "classification-correction", workDefinitionRevision: 2, stepId: finalizerTask.stepId, permissions: ["state:read", "state:commit"] });
    const again = handler(ctx, finalizerTask.inputs);
    assert.deepEqual(again, finalized(second));
    assert.equal(tableCount(second, "state_transitions"), 1);
  } finally { await second.close(); }
});

test("batch: typed label persistence failure rolls back Version, Decision, Head and commit/finalization receipts", async () => {
  const env = await environmentFixture();
  try {
    await startBatch(env);
    const count = tableCount(env, "state_versions");
    env.db.exec("CREATE TEMP TRIGGER injected_label_failure BEFORE INSERT ON classification_state_labels WHEN NEW.version_id <> 'classification-0' BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;");
    await reviewTask(env, "05-review-classification");
    assert.equal(finalized(env), undefined);
    assert.equal(tableCount(env, "state_versions"), count);
    assert.equal(tableCount(env, "state_decisions"), 0);
    assert.equal(env.controlPlane.resolveHead(STREAM_KEYS.classification).versionId, "classification-0");
    assert.equal(env.controlPlane.readReceipt(batchOperationKey("batch-test", "commit")), null);
    assert.equal(env.controlPlane.readReceipt(batchOperationKey("batch-test", "finalization")), null);
  } finally { await env.close(); }
});

test("batch: provenance must match stored source bytes, receipt items, workset, representative and replacement", async () => {
  for (const kind of ["valid", "item", "hash", "workset", "source-label"]) {
    const env = await environmentFixture();
    try {
      const source = { workset_id: "workset-test", decisions: { I1: kind === "source-label" ? "reactive" : "normal", I2: "normal" } };
      const staged = env.workspace.artifactStore.stage(Buffer.from(JSON.stringify(source)), "application/json");
      env.workspace.artifactStore.finalize(staged);
      env.controlPlane.runIdempotent({ operationId: "saved-handoff", operationKind: "test.handoff", request: {} }, () => ({ refs: { worksetId: "workset-test" }, details: { classificationPlan: { handoffItems: [{ id: "I1", observationId: "1", commentText: "AAA" }, { id: "I2", observationId: "3", commentText: "BBB" }] } } }));
      const hash = kind === "hash" ? "0".repeat(64) : staged.blobHash;
      const command = { ...batchCommand(`provenance-${kind}`), provenance: { sourceSha256: hash, receiptRef: "saved-handoff", worksetId: kind === "workset" ? "wrong" : "workset-test" },
        corrections: corrections.map((row, index) => ({ ...row, provenance: { sourceSha256: hash, handoffItemId: kind === "item" && !index ? "I2" : `I${index + 1}` } })) };
      await startBatch(env, { command });
      const state = env.runtime.state("batch-session");
      assert.equal(state.resultsByStepId["02-resolve-correction-batch"].stateResult, kind === "valid" ? "succeeded" : "blocked");
      assert.equal(tableCount(env, "state_proposals"), kind === "valid" ? 1 : 0);
    } finally { await env.close(); }
  }
});

test("batch: spoofed requester and review input are refused; registered owner survives process restart", async () => {
  const env = await environmentFixture();
  try {
    await assert.rejects(startBatch(env, { authenticatedActor: { actorType: "service", actorId: "requester" } }), (error) => error.code === "UNAUTHORIZED_ACTOR");
    await startBatch(env);
    const state = env.runtime.state("batch-session");
    const proposal = state.resultsByStepId["03-propose-correction-batch"].refs;
    const resolve = state.resultsByStepId["02-resolve-correction-batch"].details;
    const service = env.agentAdapter.taskHandlers.services.correctionBatch;
    const ctx = createV3OperationContext({ sessionId: "batch-session", workDefinitionId: "classification-correction", workDefinitionRevision: 2, stepId: "06-finalize-correction-batch", permissions: ["state:read", "state:commit"] });
    assert.throws(() => service.finalize(ctx, { correctionOperationId: "batch-test", ...proposal, approvedChangeSetHash: resolve.changeSetHash, review: { outcome: "accept", actor: { actorType: "human", actorId: "reviewer" }, result: { rationale: "forged" }, trustedTaskCompletion: true } }), (error) => error.code === "BATCH_REVIEW_REQUIRED");
    const reopened = openWorkspace(env.workspace.root);
    try {
      const runtime = createV3LocalRuntime({ controlPlane: env.controlPlane, registry: reopened.registry, artifactStore: reopened.artifactStore, workspace: reopened, keywordHandoffBuilder: testKeywordHandoffBuilder }).runtime;
      const resent = await startClassificationCorrectionBatchV3({ runtime, controlPlane: env.controlPlane, sessionId: "restarted-resend", command: batchCommand(), authenticatedActor: { actorType: "human", actorId: "requester" } });
      assert.equal(resent.sessionId, "batch-session");
      assert.equal(tableCount(env, "state_proposals"), 1);
    } finally { reopened.registry.close(); }
    const operator = { runtime: env.runtime, controlPlane: env.controlPlane, workspace: env.workspace, authenticateHumanActor: (id) => id === "requester" ? { actorType: "human", actorId: id } : null };
    await assert.rejects(startV3ClassificationCorrectionBatch(operator, { sessionId: "spoofed", command: batchCommand(), actorId: "intruder" }), (error) => error.code === "UNAUTHENTICATED_ACTOR");
    const review = listV3HumanTasks(operator, "batch-session")[0];
    assert.equal(review.correctionReview.groupCount, 2);
    assert.equal(review.correctionReview.observationCount, 3);
    assert.equal(review.correctionReview.request.requester.actorId, "requester");
  } finally { await env.close(); }
});

test("batch: optimized label JOIN preserves exact string IDs and legacy query results", async () => {
  const env = await environmentFixture();
  try {
    env.db.prepare("INSERT INTO classification_state_labels(version_id, observation_id, label) VALUES (?, ?, ?)").run("classification-0", "001", "normal");
    env.db.prepare("INSERT INTO classification_state_labels(version_id, observation_id, label) VALUES (?, ?, ?)").run("classification-0", "text-id", "reactive");
    const result = readClassificationVersionLabels(env.db, "classification-0");
    assert.equal(result.find((row) => row.observationId === "001").commentText, null);
    assert.equal(result.find((row) => row.observationId === "1").commentText, "AAA");
    assert.equal(result.find((row) => row.observationId === "text-id").commentText, null);
    const legacy = env.db.prepare(`SELECT CAST(labels.observation_id AS TEXT) AS observationId, sco.comment_text AS commentText, labels.label
      FROM classification_state_labels labels LEFT JOIN snapshot_comment_observations sco ON CAST(sco.observation_id AS TEXT) = labels.observation_id
      WHERE labels.version_id = ? ORDER BY CAST(labels.observation_id AS INTEGER), labels.observation_id`).all("classification-0").map((row) => ({ ...row }));
    assert.deepEqual(result, legacy);
  } finally { await env.close(); }
});

test("batch publication: already deployed, failed deployment, stale promotion and lost trigger response keep one path", async () => {
  for (const kind of ["already", "failed", "superseded", "lost-response"]) {
    const env = await environmentFixture();
    try {
      await startBatch(env);
      await reviewTask(env, "05-review-classification");
      await completeKeyword(env);
      const deployment = env.agentAdapter.taskHandlers.services.deployment;
      if (kind === "already") deployment.adapter.onEnsure = async () => ({ status: "succeeded" });
      if (kind === "failed") deployment.adapter.onEnsure = async () => ({ status: "failed" });
      if (kind === "lost-response") {
        const original = env.agentAdapter.taskHandlers.handlers["deployment.trigger"];
        let lost = false;
        env.agentAdapter.taskHandlers.handlers["deployment.trigger"] = async (ctx, input) => { const result = await original(ctx, input); if (!lost) { lost = true; throw new Error("response lost after request creation"); } return result; };
      }
      if (kind === "superseded") {
        const original = env.agentAdapter.taskHandlers.handlers["deployment.trigger"];
        env.agentAdapter.taskHandlers.handlers["deployment.trigger"] = async (ctx, input) => {
          const proposal = env.controlPlane.createProposal({ streamId: env.controlPlane.ensureStream(STREAM_KEYS.promotion).stream_id, expectedHeadVersionId: input.promotionVersionId, payload: { state: { releaseId: "competing-release", target: "production" } } });
          env.controlPlane.createDecision({ proposalId: proposal.proposalId, outcome: "accepted", authorityKind: "human", authorityRef: "reviewer", transitionPolicyVersionId: "promotion-policy-0" });
          env.controlPlane.commitProposal({ proposalId: proposal.proposalId, operationId: "competing-promotion" });
          return original(ctx, input);
        };
      }
      const state = await reviewTask(env, "13-review-production-promotion");
      const trigger = Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("16-trigger-deployment"))?.[1];
      assert.equal(trigger?.stateResult, { already: "already_deployed", failed: "deployment_failed", superseded: "conflict", "lost-response": "triggered" }[kind], JSON.stringify(state.tasks));
      const verify = Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("19-verify-deployment"));
      const record = Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("20-record-deployment"));
      if (kind === "already") {
        assert.equal(verify[1].stateResult, "verified");
        assert.equal(record[1].stateResult, "committed");
        assert.equal(Object.keys(state.waits).length, 0);
      } else { assert.equal(verify, undefined); assert.equal(record, undefined); }
      assert.equal(tableCount(env, "v3_release_bundles"), 1);
      assert.equal(tableCount(env, "v3_deployment_requests"), 1);
      if (kind === "superseded") assert.equal(env.db.prepare("SELECT status FROM v3_deployment_requests").get().status, "superseded");
      assert.equal(deployment.adapter.requests.size, kind === "superseded" ? 0 : 1);
      assert.equal(finalized(env).stateResult, "committed");
    } finally { await env.close(); }
  }
});

test("batch: one item uses the new contract; mixed group expectations and null keyword pins remain explicit", async () => {
  const env = await environmentFixture();
  try {
    await startBatch(env, { command: batchCommand("single-item", [corrections[0]]), pinned: { keywordSelectionVersionId: null } });
    const resolved = env.runtime.state("batch-session").resultsByStepId["02-resolve-correction-batch"].details;
    assert.equal(resolved.groupCount, 1);
    assert.equal(resolved.observationCount, 2);
    await reviewTask(env, "05-review-classification");
    const rows = readClassificationVersionLabels(env.db, finalized(env).refs.classificationVersionId);
    assert.deepEqual(rows.map((row) => row.label), ["normal", "normal", "reactive"]);
    assert.equal(tableCount(env, "state_proposals"), 1);
    assert.equal(env.runtime.state("batch-session").session.input.pinned.keywordSelectionVersionId, null);
    await assert.rejects(startBatch(env, { sessionId: "colliding", command: batchCommand("single-item", [corrections[0]]), pinned: { unknown: "ignored?" } }), (error) => error.code === "SESSION_INPUT_INVALID");
  } finally { await env.close(); }
  const mixed = await environmentFixture({ mixedLabels: true });
  try {
    await startBatch(mixed, { command: batchCommand("mixed-group", [corrections[0]]) });
    assert.equal(mixed.runtime.state("batch-session").resultsByStepId["02-resolve-correction-batch"].details.violations[0].code, "EXPECTED_LABEL_MISMATCH");
    assert.equal(tableCount(mixed, "state_proposals"), 0);
  } finally { await mixed.close(); }
});

test("batch contracts: exported schemas/bindings match runtime; new result details and frozen legacy hashes are enforced", async () => {
  const { readFile } = await import("node:fs/promises");
  const { buildClassificationCorrectionDefinitionV3, buildCommentDataUpdateDefinitionV3, validateClassificationCorrectionDefinitionV3, validateV3Definition } = await import("../src/workflow/v3/definitions.js");
  const { validateV3WorkStepResult, workStepResultRuleTable } = await import("../src/workflow/v3/result-rules.js");
  const { CLASSIFICATION_CORRECTION_BATCH_SESSION_INPUT_SCHEMA, CLASSIFICATION_CORRECTION_BATCH_OUTCOME_SCHEMA, validateClassificationCorrectionBatchOutcomeSchema } = await import("../src/workflow/v3/contracts.js");
  const definition = buildClassificationCorrectionDefinitionV3({ revision: 2 });
  const { validateAndHashDefinition } = await import("work-orchestrator");
  validateAndHashDefinition(definition);
  const tasks = [];
  const visit = (step) => { if (step.kind === "task") tasks.push(step); step.children?.forEach(visit); if (step.kind === "choice") Object.values(step.branches).forEach(visit); };
  visit(definition.root);
  const bindings = JSON.parse(await readFile(new URL("../contracts/classification-correction-batch/task-binding-map.json", import.meta.url), "utf8"));
  assert.deepEqual(bindings.steps, tasks.map((task) => ({ stepId: task.id, workerKind: task.contract.workerKind, capability: task.contract.requiredCapabilities[0] ?? null, inputBindings: task.inputBindings, allowedOutcomes: task.contract.allowedOutcomes })));
  assert.ok(tasks.filter((task) => task.contract.workerKind === "agent").every((task) => workStepResultRuleTable()[task.id]));
  assert.deepEqual(JSON.parse(await readFile(new URL("../contracts/classification-correction-batch/session-input.schema.json", import.meta.url), "utf8")), CLASSIFICATION_CORRECTION_BATCH_SESSION_INPUT_SCHEMA);
  assert.deepEqual(JSON.parse(await readFile(new URL("../contracts/classification-correction-batch/outcome.schema.json", import.meta.url), "utf8")), CLASSIFICATION_CORRECTION_BATCH_OUTCOME_SCHEMA);
  assert.equal(validateClassificationCorrectionDefinitionV3(buildClassificationCorrectionDefinitionV3()).definitionHash, "ed591d63927ebef56db9412d9fdb9a48b39ec6e2f0283aedef9cdedb8b8adabd");
  assert.equal(validateV3Definition(buildCommentDataUpdateDefinitionV3({ revision: 3 })).definitionHash, "9598f503ba9a8e8753e0b1d9d1e4af2f1a80a4d10b718aba5ab250840438a726");
  assert.equal(validateV3Definition(buildCommentDataUpdateDefinitionV3({ revision: 4 })).definitionHash, "b6e7d6bc04025ea54b4cbe2e8ff221e98f7b9d9a026950e79126915f3c09d1f4");
  assert.throws(() => validateV3WorkStepResult({ stepId: "02-resolve-correction-batch", routingOutcome: "continue", result: { stateResult: "succeeded", refs: {} } }), (error) => error.code === "WORK_STEP_RESULT_INVALID");
  assert.deepEqual(validateClassificationCorrectionBatchOutcomeSchema({ terminalStatus: "invalid_request" }), { terminalStatus: "invalid_request" });
});

import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initWorkspace, openWorkspace } from "work-orchestrator";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { readClassificationVersionLabels } from "../src/database/three-class-label-repository.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { STREAM_KEYS } from "../src/application/services.js";
import { createV3LocalRuntime, startClassificationCorrectionBatchV3 } from "../src/integration/v3-runtime.js";
import { completeValidatedHumanArtifact } from "../src/integration/human-artifact-completion-v3.js";
import { readBatchCorrectionReviewSummary } from "../src/application/v3/correction-batch-service.js";
import { testKeywordHandoffBuilder } from "./v3-keyword-handoff-test-support.js";

const sourcePath = process.env.BATCH_CORRECTION_ACCEPTANCE_DB;

test("Issue 3: read-only source backup → 25 groups/29 observations/44,419 labels → one isolated publication", { skip: !sourcePath }, async (t) => {
  const fixture = JSON.parse(await readFile(new URL("../../docs/active/handoff/mi-comopt-issue3-handoff/fixtures/issue3-targets.json", import.meta.url), "utf8"));
  const sourceBytes = await readFile(new URL("../../docs/active/handoff/response%20(3).json", import.meta.url));
  const root = await mkdtemp(path.join(os.tmpdir(), "issue3-isolated-"));
  const source = new DatabaseSync(path.resolve(sourcePath), { readOnly: true });
  let db, workspace;
  try {
    const sourceHeadBefore = source.prepare("SELECT stream_id, head_version_id FROM state_stream_heads ORDER BY stream_id").all();
    await backup(source, path.join(root, "copy.sqlite3"));
    db = await openCommentDatabase(path.join(root, "copy.sqlite3"), { stateControlPlane: true });
    const controlPlane = new StateControlPlane(db);
    initWorkspace(path.join(root, "workspace"));
    workspace = openWorkspace(path.join(root, "workspace"));
    const env = createV3LocalRuntime({ controlPlane, registry: workspace.registry, artifactStore: workspace.artifactStore, workspace, keywordHandoffBuilder: testKeywordHandoffBuilder });
    const staged = workspace.artifactStore.stage(sourceBytes, "application/json");
    assert.equal(staged.blobHash, fixture.canonicalSource.sha256);
    workspace.artifactStore.finalize(staged);
    const baseline = fixture.baseline.classificationVersionId;
    assert.equal(controlPlane.resolveHead(STREAM_KEYS.classification).versionId, baseline);
    const labelStart = performance.now();
    const before = readClassificationVersionLabels(db, baseline);
    const optimizedMs = performance.now() - labelStart;
    assert.equal(before.length, fixture.expectedTotal);
    const readSql = `SELECT CAST(labels.observation_id AS TEXT) AS observation_id, sco.comment_text, labels.label
      FROM classification_state_labels labels LEFT JOIN snapshot_comment_observations sco
      ON sco.observation_id = CAST(labels.observation_id AS INTEGER) AND CAST(sco.observation_id AS TEXT) = labels.observation_id
      WHERE labels.version_id = ? ORDER BY CAST(labels.observation_id AS INTEGER), labels.observation_id`;
    const oldSql = readSql.replace("sco.observation_id = CAST(labels.observation_id AS INTEGER) AND ", "");
    const queryPlan = db.prepare(`EXPLAIN QUERY PLAN ${readSql}`).all(baseline);
    assert.ok(queryPlan.some((row) => /INTEGER PRIMARY KEY/.test(row.detail)));
    const legacyPlan = db.prepare(`EXPLAIN QUERY PLAN ${oldSql}`).all(baseline);
    let legacyMs = null;
    if (process.env.BATCH_CORRECTION_BENCHMARK_LEGACY === "1") {
      console.log("Issue3 benchmark: legacy full JOIN begins on the isolated copy");
      const started = performance.now();
      const legacy = db.prepare(oldSql).all(baseline).map((row) => ({ observationId: row.observation_id, commentText: row.comment_text, label: row.label }));
      legacyMs = performance.now() - started;
      assert.deepEqual(legacy, before);
    }
    const actor = { actorType: "human", actorId: "isolated-reviewer" };
    const command = { correctionOperationId: "issue3-isolated-acceptance", baseClassificationVersionId: baseline,
      provenance: { sourceSha256: fixture.canonicalSource.sha256, worksetId: fixture.canonicalSource.worksetId, receiptRef: fixture.canonicalSource.receiptRef },
      corrections: fixture.targets.map((row) => ({ targetObservationId: row.representativeObservationId, expectedLabel: "normal", replacementLabel: "direct_nuisance", reason: "Issue 3の正本との一致を隔離環境で検証", provenance: { sourceSha256: fixture.canonicalSource.sha256, handoffItemId: row.handoffItemId } })) };
    const initialCounts = Object.fromEntries(["state_versions", "state_assessments", "state_proposals", "state_decisions", "v3_release_bundles", "v3_deployment_requests"].map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
    const start = performance.now();
    await startClassificationCorrectionBatchV3({ runtime: env.runtime, controlPlane, sessionId: "issue3-session", command, authenticatedActor: actor });
    const startMs = performance.now() - start;
    let state = env.runtime.state("issue3-session");
    const refs = state.resultsByStepId["03-propose-correction-batch"]?.refs;
    assert.ok(refs, JSON.stringify(Object.values(state.tasks).map((row) => ({ step: row.stepId, state: row.state, attention: row.attention }))));
    const reviewStart = performance.now();
    const review = readBatchCorrectionReviewSummary(controlPlane, refs);
    const reviewMs = performance.now() - reviewStart;
    assert.equal(review.groupCount, 25);
    assert.equal(review.observationCount, 29);
    assert.deepEqual(review.afterDistribution, fixture.expectedDistribution);
    assert.deepEqual(review.groups.find((row) => row.targetObservationId === "45921").observationIds, fixture.targets[0].observationIds.slice().sort());
    const approve = async (prefix) => {
      state = env.runtime.state("issue3-session");
      const task = Object.values(state.tasks).find((row) => row.stepId.startsWith(prefix));
      assert.ok(task, JSON.stringify({ prefix, tasks: Object.values(state.tasks).map((row) => ({ step: row.stepId, state: row.state, attention: row.attention })), executions: Object.values(state.executions).filter((row) => row.failure).map((row) => row.failure) }));
      await env.runtime.claimTask("issue3-session", task.taskId, actor);
      await env.runtime.completeHumanTaskWithInput("issue3-session", task.taskId, actor, { outcome: "accept", result: { rationale: "隔離コピーだけの検証承認" } }, `review:${task.stepId}`);
    };
    const commitStart = performance.now();
    await approve("05-review-classification");
    const commitMs = performance.now() - commitStart;
    state = env.runtime.state("issue3-session");
    const committed = state.resultsByStepId["06-finalize-correction-batch"];
    assert.equal(committed?.stateResult, "committed", JSON.stringify(state.tasks));
    const after = readClassificationVersionLabels(db, committed.refs.classificationVersionId);
    const afterMap = new Map(after.map((row) => [row.observationId, row.label]));
    assert.equal(after.length, 44419);
    const changed = before.filter((row) => row.label !== afterMap.get(row.observationId));
    assert.equal(changed.length, 29);
    assert.ok(changed.every((row) => row.label === "normal" && afterMap.get(row.observationId) === "direct_nuisance"));
    assert.deepEqual(readClassificationVersionLabels(db, baseline), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM state_versions v JOIN state_streams s USING(stream_id) WHERE s.domain='classification' AND s.stream_key='comments'").get().n, 13);
    const requestRefs = state.resultsByStepId["07a-prepare-keyword-handoff"].refs;
    const task = Object.values(state.tasks).find((row) => row.stepId === "07b-receive-keyword-proposal");
    const execution = await env.runtime.openHumanTaskWorkspace("issue3-session", task.taskId, actor);
    await writeFile(path.join(execution.outputPath, "candidate_proposal.json"), JSON.stringify({ schema_version: 1, request_id: requestRefs.candidateRequestId, input_fingerprint: requestRefs.candidateInputFingerprint, actions: [] }));
    await completeValidatedHumanArtifact({ runtime: env.runtime, registry: workspace.registry, artifactStore: workspace.artifactStore, sessionId: "issue3-session", taskId: task.taskId, actor, executionId: execution.executionId, outputDirectory: execution.outputPath, stepId: task.stepId });
    state = env.runtime.state("issue3-session");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v3_deployment_requests").get().n, initialCounts.v3_deployment_requests);
    if (Object.values(state.tasks).some((row) => row.stepId.startsWith("09-review-keyword-selection") && row.state === "ready")) await approve("09-review-keyword-selection");
    await approve("13-review-production-promotion");
    state = env.runtime.state("issue3-session");
    const trigger = Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("16-trigger-deployment"))?.[1];
    assert.ok(trigger, JSON.stringify(state.tasks));
    const deployment = env.agentAdapter.taskHandlers.services.deployment;
    const completed = deployment.adapter.complete(trigger.refs.deploymentRequestId, "succeeded");
    deployment.receiveCompletedEvent({ eventId: "issue3-deployed", eventType: "deployment.completed", correlationKey: trigger.refs.deploymentRequestId,
      payload: { deploymentRequestId: trigger.refs.deploymentRequestId, target: "production", releaseId: trigger.refs.releaseId, status: "succeeded", externalRunRef: completed.externalRunRef } });
    await deployment.deliverPendingEvents((id, event, cmd) => env.runtime.receiveExternalEvent(id, event, { actorId: "memory", actorType: "external" }, cmd), { registry: workspace.registry });
    state = env.runtime.state("issue3-session");
    assert.equal(state.session.state, "completed");
    assert.equal(Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("19-verify-deployment"))[1].stateResult, "verified");
    assert.equal(Object.entries(state.resultsByStepId).find(([id]) => id.startsWith("20-record-deployment"))[1].stateResult, "committed");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v3_release_bundles").get().n - initialCounts.v3_release_bundles, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v3_deployment_requests").get().n - initialCounts.v3_deployment_requests, 1);
    const releasePins = JSON.parse(db.prepare("SELECT pins_json FROM v3_release_bundles WHERE release_id = ?").get(trigger.refs.releaseId).pins_json);
    assert.equal(releasePins.classificationVersionId, committed.refs.classificationVersionId);
    const resent = await startClassificationCorrectionBatchV3({ runtime: env.runtime, controlPlane, sessionId: "issue3-resend", command, authenticatedActor: actor });
    assert.equal(resent.sessionId, "issue3-session");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v3_deployment_requests").get().n - initialCounts.v3_deployment_requests, 1);
    assert.deepEqual(source.prepare("SELECT stream_id, head_version_id FROM state_stream_heads ORDER BY stream_id").all(), sourceHeadBefore);
    t.diagnostic(JSON.stringify({ labels: before.length, optimizedReadMs: optimizedMs, legacyReadMs: legacyMs, startMs, reviewMs, commitAndKeywordPreparationMs: commitMs, queryPlan, legacyPlan, classificationVersionId: committed.refs.classificationVersionId, releaseId: trigger.refs.releaseId, deploymentRequestId: trigger.refs.deploymentRequestId }));
  } finally {
    workspace?.registry.close(); db?.close(); source.close();
    await rm(root, { recursive: true, force: true });
  }
});

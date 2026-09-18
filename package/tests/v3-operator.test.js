import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { initWorkspace } from "work-orchestrator";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { STREAM_KEYS } from "../src/application/services.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import {
  completeV3HumanTask,
  getV3Session,
  listV3HumanTasks,
  openV3HumanTask,
  openV3Operator,
  startV3Session,
} from "../src/integration/v3-operator.js";

function seed(controlPlane, stream, versionId, state = {}) {
  const record = controlPlane.ensureStream(stream);
  return controlPlane.createGenesis({ streamId: record.stream_id, versionId, payload: { schema_version: 1, state } });
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "comment-db-v3-operator-"));
  const workspacePath = path.join(root, "work-orchestrator");
  const dbPath = path.join(root, "comment-history.sqlite3");
  initWorkspace(workspacePath);
  const db = await openCommentDatabase(dbPath, { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
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
  controlPlane.close();
  return { root, dbPath, workspacePath };
}

async function submitArtifact(operator, sessionId, stepId, value, actorId) {
  const opened = await openV3HumanTask(operator, { sessionId, stepId, actorId });
  await writeFile(path.join(opened.outputPath, opened.expectedFile), `${JSON.stringify(value)}\n`);
  return completeV3HumanTask(operator, { sessionId, stepId, actorId });
}

async function submitDecision(operator, sessionId, stepId, actorId) {
  await openV3HumanTask(operator, { sessionId, stepId, actorId });
  return completeV3HumanTask(operator, { sessionId, stepId, actorId, outcome: "accept", rationale: "operator integration test" });
}

test("v3 operator persists Session start, Human artifact open, and validated completion across operator instances", async () => {
  const value = await fixture();
  let operator;
  try {
    operator = await openV3Operator(value);
    const started = await startV3Session(operator, {
      sessionId: "operator-session-1",
      updateRequestId: "operator-update-1",
      actorId: "production-operator",
    });
    assert.equal(started.sessionId, "operator-session-1");
    assert.equal(started.revision, 3);
    assert.equal(listV3HumanTasks(operator, started.sessionId)[0].stepId, "00-receive-update-artifact");
    operator.close();
    operator = undefined;

    operator = await openV3Operator(value);
    const opened = await openV3HumanTask(operator, {
      sessionId: started.sessionId,
      stepId: "00-receive-update-artifact",
      actorId: "production-operator",
    });
    assert.equal(opened.expectedFile, "comment-batch.json");
    await writeFile(path.join(opened.outputPath, opened.expectedFile), "[]\n");
    operator.close();
    operator = undefined;

    operator = await openV3Operator(value);
    const completed = await completeV3HumanTask(operator, {
      sessionId: started.sessionId,
      stepId: "00-receive-update-artifact",
      actorId: "production-operator",
    });
    assert.equal(completed.mode, "artifact");
    assert.equal(getV3Session(operator, started.sessionId).tasks[completed.taskId].state, "completed");
    assert.ok((await readFile(path.join(opened.outputPath, opened.expectedFile), "utf8")).includes("[]"));

    const afterEvidence = getV3Session(operator, started.sessionId);
    const classificationWorksetId = afterEvidence.resultsByStepId["03a-prepare-classification-handoff"]?.refs?.worksetId;
    assert.ok(classificationWorksetId);
    await submitArtifact(operator, started.sessionId, "03b-receive-classification-response", { workset_id: classificationWorksetId, decisions: {} }, "production-operator");
    await submitDecision(operator, started.sessionId, "05-review-classification", "production-operator");

    const afterClassification = getV3Session(operator, started.sessionId);
    const keywordRefs = afterClassification.resultsByStepId["07a-prepare-keyword-handoff"]?.refs;
    assert.ok(keywordRefs?.candidateRequestId);
    const keywordTask = listV3HumanTasks(operator, started.sessionId).find((task) => task.stepId === "07b-receive-keyword-proposal");
    assert.deepEqual(keywordTask?.artifactContext, {
      requestId: keywordRefs.candidateRequestId,
      inputFingerprint: keywordRefs.candidateInputFingerprint,
    });
    await submitArtifact(operator, started.sessionId, "07b-receive-keyword-proposal", {
      schema_version: 1,
      request_id: keywordRefs.candidateRequestId,
      input_fingerprint: keywordRefs.candidateInputFingerprint,
      actions: [],
    }, "production-operator");
    await submitDecision(operator, started.sessionId, "09-review-keyword-selection", "production-operator");
    await submitDecision(operator, started.sessionId, "13-review-production-promotion", "production-operator");
    assert.equal(getV3Session(operator, started.sessionId).tasks[completed.taskId].state, "completed");
  } finally {
    operator?.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v3 operator does not allow another actor to complete a claimed Human Task", async () => {
  const value = await fixture();
  let operator;
  try {
    operator = await openV3Operator(value);
    await startV3Session(operator, {
      sessionId: "operator-session-2",
      updateRequestId: "operator-update-2",
      actorId: "production-operator",
    });
    await openV3HumanTask(operator, {
      sessionId: "operator-session-2",
      stepId: "00-receive-update-artifact",
      actorId: "production-operator",
    });
    await assert.rejects(
      completeV3HumanTask(operator, {
        sessionId: "operator-session-2",
        stepId: "00-receive-update-artifact",
        actorId: "other-operator",
      }),
      /Human Task must be opened by the same actor/,
    );
  } finally {
    operator?.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

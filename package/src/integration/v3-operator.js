import path from "node:path";
import { existsSync } from "node:fs";
import { executionWorkspace, openWorkspace } from "work-orchestrator";
import { completeValidatedHumanArtifact, EXPECTED_FILES } from "./human-artifact-completion-v3.js";
import { createV3LocalRuntime, prepareV3SessionInput, startCommentDataUpdateV3 } from "./v3-runtime.js";
import { MemoryDeploymentAdapter } from "../deployment/adapter.js";
import { openCommentDatabase } from "../database/comment-database.js";
import { StateControlPlane } from "../state/control-plane.js";
import { stateError } from "../state/errors.js";

const WORK_DEFINITION_ID = "comment-data-update";
const V3_REVISION = 3;

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw stateError("VALIDATION_ERROR", `${name} must be a non-empty string`);
  return value;
}

function actorRef(actorId) {
  return { actorId: requiredString(actorId, "actorId"), actorType: "human" };
}

function resolveTask(state, { taskId = undefined, stepId = undefined } = {}) {
  if (!taskId && !stepId) throw stateError("TASK_REQUIRED", "taskId or stepId is required");
  const matches = Object.values(state?.tasks ?? {}).filter((task) => (
    task.workerKind === "human" &&
    (taskId ? task.taskId === taskId : task.stepId === stepId)
  ));
  if (matches.length === 0) throw stateError("TASK_NOT_FOUND", `Human Task was not found: ${taskId ?? stepId}`);
  if (matches.length > 1) throw stateError("TASK_AMBIGUOUS", `multiple Human Tasks match: ${stepId}`);
  return matches[0];
}

function taskSummary(task) {
  const summary = {
    taskId: task.taskId,
    stepId: task.stepId,
    goal: task.goal,
    state: task.state,
    workerKind: task.workerKind,
    allowedOutcomes: task.contract?.allowedOutcomes ?? [],
  };
  if (task.claimantActorId) summary.claimantActorId = task.claimantActorId;
  if (task.currentExecutionId) summary.executionId = task.currentExecutionId;
  const expectedFile = EXPECTED_FILES[task.stepId];
  if (expectedFile) summary.expectedFile = expectedFile;
  return summary;
}

/**
 * Open the already-initialized production authorities. This function never
 * initializes a Workspace or creates a replacement database. The runtime uses
 * the v3 application-service adapter, while the provider Registry and
 * ArtifactStore remain the workflow authorities.
 */
export async function openV3Operator({ dbPath, workspacePath, deploymentAdapter = new MemoryDeploymentAdapter() } = {}) {
  requiredString(dbPath, "dbPath");
  requiredString(workspacePath, "workspacePath");
  if (dbPath !== ":memory:" && !existsSync(path.resolve(dbPath))) throw stateError("AUTHORITY_NOT_FOUND", `production authority DB does not exist: ${dbPath}`);
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const db = await openCommentDatabase(dbPath, { stateControlPlane: true });
  let workspace;
  let controlPlane;
  try {
    workspace = openWorkspace(resolvedWorkspacePath);
    controlPlane = new StateControlPlane(db);
    const environment = createV3LocalRuntime({
      controlPlane,
      registry: workspace.registry,
      artifactStore: workspace.artifactStore,
      workspace,
      deploymentAdapter,
      revision: V3_REVISION,
    });
    let closed = false;
    return {
      ...environment,
      controlPlane,
      workspace,
      close() {
        if (closed) return;
        closed = true;
        workspace.registry.close();
        controlPlane.close();
      },
    };
  } catch (error) {
    workspace?.registry?.close();
    controlPlane?.close();
    if (!controlPlane) db.close();
    throw error;
  }
}

export function listV3Sessions(operator) {
  const { workspace } = operator;
  return workspace.registry.listSessions(200)
    .filter((session) => session.work_definition_id === WORK_DEFINITION_ID && Number(session.definition_revision) >= V3_REVISION)
    .map((session) => {
      const state = workspace.registry.getRuntimeState(session.session_id);
      const tasks = Object.values(state?.tasks ?? {});
      return {
        sessionId: session.session_id,
        revision: Number(session.definition_revision),
        state: state?.session?.state ?? session.state,
        runtimeRevision: state?.revision ?? Number(session.revision),
        actionableHumanTasks: tasks.filter((task) => task.workerKind === "human" && ["ready", "active"].includes(task.state)).map(taskSummary),
      };
    });
}

export function getV3Session(operator, sessionId) {
  requiredString(sessionId, "sessionId");
  const state = operator.runtime.state(sessionId);
  if (!state || state.session?.workDefinitionId !== WORK_DEFINITION_ID || Number(state.session?.definitionRevision) < V3_REVISION) {
    throw stateError("SESSION_NOT_FOUND", `v3 Session was not found: ${sessionId}`);
  }
  return state;
}

export function listV3HumanTasks(operator, sessionId) {
  const state = getV3Session(operator, sessionId);
  return Object.values(state.tasks)
    .filter((task) => task.workerKind === "human")
    .map(taskSummary);
}

export async function startV3Session(operator, { sessionId, updateRequestId, actorId, pinned = {} } = {}) {
  requiredString(sessionId, "sessionId");
  requiredString(updateRequestId, "updateRequestId");
  const input = prepareV3SessionInput({
    controlPlane: operator.controlPlane,
    input: {
      updateRequestId,
      pinned,
      target: { promotionStream: "production", deploymentTarget: "production" },
    },
  });
  const response = await startCommentDataUpdateV3({
    runtime: operator.runtime,
    controlPlane: operator.controlPlane,
    sessionId,
    input,
    actor: actorRef(actorId),
    revision: V3_REVISION,
  });
  return { ...response, sessionId, revision: V3_REVISION, input };
}

export async function openV3HumanTask(operator, { sessionId, taskId, stepId, actorId } = {}) {
  const actor = actorRef(actorId);
  const state = getV3Session(operator, sessionId);
  const task = resolveTask(state, { taskId, stepId });
  const workspace = await operator.runtime.openHumanTaskWorkspace(sessionId, task.taskId, actor);
  return {
    sessionId,
    task: taskSummary(operator.runtime.state(sessionId).tasks[task.taskId]),
    executionId: workspace.executionId,
    outputPath: workspace.outputPath,
    expectedFile: EXPECTED_FILES[task.stepId] ?? null,
  };
}

export async function completeV3HumanTask(operator, { sessionId, taskId, stepId, actorId, outcome, rationale } = {}) {
  const actor = actorRef(actorId);
  const state = getV3Session(operator, sessionId);
  const task = resolveTask(state, { taskId, stepId });
  if (task.state !== "active" || task.claimantActorId !== actor.actorId || !task.currentExecutionId) {
    throw stateError("NOT_CLAIM_OWNER", "Human Task must be opened by the same actor before completion");
  }
  if (EXPECTED_FILES[task.stepId]) {
    const execution = state.executions[task.currentExecutionId];
    if (!execution) throw stateError("EXECUTION_NOT_FOUND", `Human Execution was not found: ${task.currentExecutionId}`);
    const executionWorkspace = executionWorkspaceFor(operator, sessionId, execution.executionId);
    const response = await completeValidatedHumanArtifact({
      runtime: operator.runtime,
      registry: operator.workspace.registry,
      artifactStore: operator.workspace.artifactStore,
      sessionId,
      taskId: task.taskId,
      actor,
      executionId: task.currentExecutionId,
      outputDirectory: executionWorkspace.outputPath,
      stepId: task.stepId,
      commandId: `complete-human-artifact:${task.currentExecutionId}`,
    });
    return { mode: "artifact", response, sessionId, taskId: task.taskId, stepId: task.stepId };
  }
  requiredString(outcome, "outcome");
  if (!(task.contract?.allowedOutcomes ?? []).includes(outcome)) throw stateError("OUTCOME_INVALID", `outcome ${outcome} is not allowed for ${task.stepId}`);
  requiredString(rationale, "rationale");
  const response = await operator.runtime.completeHumanTaskWithInput(
    sessionId,
    task.taskId,
    actor,
    { outcome, result: { rationale } },
    `complete-human:${task.currentExecutionId}`,
  );
  return { mode: "decision", response, sessionId, taskId: task.taskId, stepId: task.stepId, outcome };
}

function executionWorkspaceFor(operator, sessionId, executionId) {
  return executionWorkspace(operator.workspace, sessionId, executionId);
}

export async function releaseV3HumanTask(operator, { sessionId, taskId, stepId, actorId } = {}) {
  const actor = actorRef(actorId);
  const state = getV3Session(operator, sessionId);
  const task = resolveTask(state, { taskId, stepId });
  const response = await operator.runtime.releaseTask(sessionId, task.taskId, actor, `release-human:${task.taskId}:${actor.actorId}`);
  return { response, sessionId, taskId: task.taskId, stepId: task.stepId };
}

export { EXPECTED_FILES };

import { semanticSha256, canonicalize, cloneJson } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

export const WORK_DEFINITION_REVISION = 1;
export const DEFINITION_SNAPSHOT_HASHES = Object.freeze({
  "comment-data-update@1": "46631dfcfe301faefb5cc2a861b3c15ad80d39851f46d623f99d55d438a02adb",
  "deploy-promoted-release@1": "5d2470412841db1334e77459fa969536a6829f2612ac241f39270daeace76579",
});
export const ROUTING_OUTCOMES = Object.freeze(["continue", "review_required", "rejected", "superseded", "blocked", "wait", "verify"]);
export const HUMAN_REVIEW_OUTCOMES = Object.freeze(["accept", "reject"]);

const WORK_STEP_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stateResult", "refs", "inputFingerprint"],
  properties: {
    stateResult: { type: "string", enum: ["succeeded", "committed", "unchanged", "created", "reused", "materialized", "already_materialized", "review_required", "rejected", "conflict", "blocked", "triggered", "already_deployed", "verified", "not_verified"] },
    refs: { type: "object", additionalProperties: false },
    inputFingerprint: { type: "string", minLength: 1 },
    outputFingerprint: { type: "string" },
    details: { type: "object" },
  },
};

const SESSION_BINDING = (path) => ({ source: "session", path });
const STEP_BINDING = (stepId, path) => ({ source: "step", stepId, path });

function agentTask(id, capability, permissions, maxWallTimeMs, maxAttempts, inputBindings = []) {
  return {
    kind: "task", id, goal: `${capability} application service`,
    contract: {
      workerKind: "agent",
      requiredCapabilities: [capability],
      requestedPermissions: permissions,
      retryPolicy: { maxAttempts, manualRetryAllowed: true, interventionOnExhaustion: "manual_retry" },
      budgets: { maxWallTimeMs },
      resultSchema: cloneJson(WORK_STEP_RESULT_SCHEMA),
    },
    inputBindings,
  };
}

function humanReview(id, goal, inputBindings = []) {
  return {
    kind: "task", id, goal,
    contract: {
      workerKind: "human",
      requiredCapabilities: [],
      requestedPermissions: [],
      retryPolicy: { maxAttempts: 1 },
      allowedOutcomes: [...HUMAN_REVIEW_OUTCOMES],
      resultSchema: cloneJson(WORK_STEP_RESULT_SCHEMA),
    },
    inputBindings,
  };
}

function sequence(id, children) { return { kind: "sequence", id, children }; }
function terminal(id) { return sequence(`${id}-terminal`, []); }
function choice(id, branches) { return { kind: "choice", id, branches }; }

function suffixStepTree(step, suffix) {
  const ids = new Set();
  const collect = (node) => {
    ids.add(node.id);
    if (node.kind === "sequence" || node.kind === "parallelAll") node.children.forEach(collect);
    if (node.kind === "choice") Object.values(node.branches).forEach(collect);
  };
  collect(step);
  const rewrite = (node) => {
    const copy = cloneJson(node);
    copy.id = `${node.id}-${suffix}`;
    if (Array.isArray(copy.inputBindings)) copy.inputBindings = copy.inputBindings.map((binding) => ({ ...binding, ...(binding.stepId && ids.has(binding.stepId) ? { stepId: `${binding.stepId}-${suffix}` } : {}) }));
    if (copy.kind === "sequence" || copy.kind === "parallelAll") copy.children = copy.children.map(rewrite);
    if (copy.kind === "choice") copy.branches = Object.fromEntries(Object.entries(copy.branches).map(([outcome, branch]) => [outcome, rewrite(branch)]));
    return copy;
  };
  return rewrite(step);
}

function deploymentContinuation() {
  const verifyAndRecord = (suffix = "") => {
    const verifyId = suffix ? `19-verify-deployment-${suffix}` : "19-verify-deployment";
    const recordId = suffix ? `20-record-deployment-state-${suffix}` : "20-record-deployment-state";
    return sequence(`deployment-verify-and-record${suffix ? `-${suffix}` : ""}`, [
      agentTask(verifyId, "deployment.verify", ["state:read", "deployment:verify"], 20000, 2, [STEP_BINDING("16-trigger-deployment", "/refs/releaseId")]),
      choice(`19-route-verification${suffix ? `-${suffix}` : ""}`, {
        continue: sequence(`deployment-record-continuation${suffix ? `-${suffix}` : ""}`, [agentTask(recordId, "deployment.record", ["state:read", "state:auto-decide", "state:commit"], 15000, 2, [STEP_BINDING(verifyId, "/refs")])]),
        rejected: terminal(`deployment-verification-rejected${suffix ? `-${suffix}` : ""}`),
        blocked: terminal(`deployment-verification-blocked${suffix ? `-${suffix}` : ""}`),
      }),
    ]);
  };
  const verifyAfterEvent = verifyAndRecord();
  const verifyWhenAlreadyServing = verifyAndRecord("already-serving");
  const trigger = agentTask("16-trigger-deployment", "deployment.trigger", ["state:read", "deployment:trigger"], 20000, 3, [STEP_BINDING("14-finalize-production-promotion", "/refs/releaseId")]);
  return sequence("deployment-continuation", [
    trigger,
    choice("16-route-deployment-trigger", {
      wait: sequence("deployment-wait-continuation", [
        { kind: "waitEvent", id: "18-wait-deployment-event", eventType: "deployment.completed", correlationKey: SESSION_BINDING("/target/deploymentTarget"), inputBindings: [STEP_BINDING("16-trigger-deployment", "/refs/deploymentRequestId")] },
        choice("18-route-deployment-event", {
          succeeded: verifyAfterEvent,
          failed: terminal("deployment-event-failed"),
          cancelled: terminal("deployment-event-cancelled"),
        }),
      ]),
      verify: verifyWhenAlreadyServing,
      blocked: terminal("deployment-trigger-blocked"),
    }),
  ]);
}

function releaseContinuation() {
  return sequence("release-promotion-deployment-continuation", [
    agentTask("11-build-release-bundle", "release.build", ["state:read", "release:build"], 20000, 2, [
      STEP_BINDING("02-update-corpus", "/refs/corpusVersionId"), STEP_BINDING("03-update-classification", "/refs/classificationVersionId"), STEP_BINDING("07-update-keyword-selection", "/refs/keywordSelectionVersionId"), SESSION_BINDING("/pinned/projectionDefinitionVersionId"),
    ]),
    agentTask("12-materialize-release", "release.materialize", ["release:build", "artifact:write"], 25000, 3, [STEP_BINDING("11-build-release-bundle", "/refs/releaseId")]),
    humanReview("13-review-production-promotion", "Review the materialized release for production promotion", [STEP_BINDING("12-materialize-release", "/refs/releaseId")]),
    choice("13-route-production-review", {
      accept: sequence("production-accept-continuation", [
        agentTask("14-finalize-production-promotion", "promotion.finalize", ["state:read", "state:commit"], 15000, 2, [STEP_BINDING("11-build-release-bundle", "/refs/releaseId"), STEP_BINDING("13-review-production-promotion", "/")]),
        choice("14-route-production-promotion", { continue: deploymentContinuation(), rejected: terminal("promotion-rejected"), superseded: terminal("promotion-superseded"), blocked: terminal("promotion-blocked") }),
      ]),
      reject: terminal("production-review-rejected"),
    }),
  ]);
}

function keywordContinuation() {
  const finalize = sequence("keyword-finalize-continuation", [
    humanReview("09-review-keyword-selection", "Review the proposed Keyword Selection state", [STEP_BINDING("07-update-keyword-selection", "/refs/proposalId")]),
    choice("09-route-keyword-review", {
      accept: sequence("keyword-review-accepted", [
        agentTask("10-finalize-keyword-selection", "keyword-selection.finalize", ["state:read", "state:commit"], 15000, 2, [STEP_BINDING("07-update-keyword-selection", "/refs/proposalId"), STEP_BINDING("09-review-keyword-selection", "/")]),
        choice("10-route-keyword-finalize", { continue: suffixStepTree(releaseContinuation(), "after-keyword-review"), rejected: terminal("keyword-finalize-rejected"), superseded: terminal("keyword-finalize-superseded"), blocked: terminal("keyword-finalize-blocked") }),
      ]),
      reject: terminal("keyword-review-rejected"),
    }),
  ]);
  return sequence("keyword-continuation", [
    agentTask("07-update-keyword-selection", "keyword-selection.assess", ["state:read", "state:propose"], 25000, 2, [STEP_BINDING("03-update-classification", "/refs/classificationVersionId"), STEP_BINDING("02-update-corpus", "/refs/corpusVersionId"), SESSION_BINDING("/pinned/keywordSelectionVersionId"), SESSION_BINDING("/pinned/keywordPolicyVersionId")]),
    choice("07-route-keyword-selection", { continue: releaseContinuation(), review_required: finalize, superseded: terminal("keyword-assessment-superseded"), blocked: terminal("keyword-assessment-blocked") }),
  ]);
}

function classificationContinuation() {
  const finalize = sequence("classification-finalize-continuation", [
    humanReview("05-review-classification", "Review the proposed Classification state", [STEP_BINDING("03-update-classification", "/refs/proposalId")]),
    choice("05-route-classification-review", {
      accept: sequence("classification-review-accepted", [
        agentTask("06-finalize-classification", "classification.finalize", ["state:read", "state:commit"], 15000, 2, [STEP_BINDING("03-update-classification", "/refs/proposalId"), STEP_BINDING("05-review-classification", "/")]),
        choice("06-route-classification-finalize", { continue: suffixStepTree(keywordContinuation(), "after-classification-review"), rejected: terminal("classification-finalize-rejected"), superseded: terminal("classification-finalize-superseded"), blocked: terminal("classification-finalize-blocked") }),
      ]),
      reject: terminal("classification-review-rejected"),
    }),
  ]);
  return sequence("classification-continuation", [
    agentTask("03-update-classification", "classification.assess", ["state:read", "state:propose"], 25000, 2, [STEP_BINDING("02-update-corpus", "/refs/corpusVersionId"), SESSION_BINDING("/pinned/classificationVersionId"), SESSION_BINDING("/pinned/classificationPolicyVersionId")]),
    choice("03-route-classification", { continue: keywordContinuation(), review_required: finalize, superseded: terminal("classification-assessment-superseded"), blocked: terminal("classification-assessment-blocked") }),
  ]);
}

export function buildCommentDataUpdateDefinition({ revision = WORK_DEFINITION_REVISION } = {}) {
  return {
    workDefinitionId: "comment-data-update", revision, schemaVersion: 1,
    root: sequence("comment-data-update-root", [
      agentTask("01-ingest-evidence", "evidence.ingest", ["evidence:write"], 20000, 3, [SESSION_BINDING("/updateRequestId"), SESSION_BINDING("/evidenceSource")]),
      agentTask("02-update-corpus", "corpus.update", ["state:read", "state:propose", "state:auto-decide", "state:commit"], 15000, 2, [STEP_BINDING("01-ingest-evidence", "/refs/evidenceIds"), SESSION_BINDING("/pinned/initialCorpusVersionId")]),
      classificationContinuation(),
    ]),
    limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 },
  };
}

export function buildDeployPromotedReleaseDefinition({ revision = WORK_DEFINITION_REVISION } = {}) {
  return {
    workDefinitionId: "deploy-promoted-release", revision, schemaVersion: 1,
    root: deploymentContinuation(),
    limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 },
  };
}

export function buildWorkDefinitions(options = {}) {
  return [buildCommentDataUpdateDefinition(options), buildDeployPromotedReleaseDefinition(options)];
}

function walkStep(step, visitor, seen = new Set()) {
  if (!step || typeof step !== "object") throw stateError("DEFINITION_INVALID", "step must be an object");
  if (typeof step.id !== "string" || step.id.length === 0) throw stateError("DEFINITION_INVALID", "every step requires a stable id");
  if (seen.has(step.id)) throw stateError("DEFINITION_INVALID", `duplicate step id: ${step.id}`);
  seen.add(step.id);
  visitor(step);
  if (step.kind === "sequence" || step.kind === "parallelAll") for (const child of step.children ?? []) walkStep(child, visitor, seen);
  if (step.kind === "choice") for (const [outcome, branch] of Object.entries(step.branches ?? {})) { if (!ROUTING_OUTCOMES.includes(outcome) && !HUMAN_REVIEW_OUTCOMES.includes(outcome) && !["succeeded", "failed", "cancelled"].includes(outcome)) throw stateError("DEFINITION_INVALID", `unsupported branch outcome: ${outcome}`); walkStep(branch, visitor, seen); }
}

export function definitionWithoutHash(definition) {
  const copy = cloneJson(definition);
  delete copy.definitionHash;
  return copy;
}

export function validateAndHashDefinition(definition) {
  if (!definition || typeof definition !== "object" || !/^[-a-z0-9]+$/.test(definition.workDefinitionId) || !Number.isSafeInteger(definition.revision) || definition.revision < 0 || definition.schemaVersion !== 1) throw stateError("DEFINITION_INVALID", "definition metadata is invalid");
  const taskIds = new Set();
  const allStepIds = new Set();
  walkStep(definition.root, (step) => {
    allStepIds.add(step.id);
    if (!["task", "sequence", "choice", "parallelAll", "waitEvent", "waitTimer", "dynamicExpand"].includes(step.kind)) throw stateError("DEFINITION_INVALID", `unsupported step kind: ${step.kind}`);
    if (step.kind === "task") {
      const contract = step.contract;
      if (!contract || !["human", "agent"].includes(contract.workerKind) || !Array.isArray(contract.requiredCapabilities) || !Array.isArray(contract.requestedPermissions) || !Number.isSafeInteger(contract.retryPolicy?.maxAttempts) || contract.retryPolicy.maxAttempts < 1) throw stateError("DEFINITION_INVALID", `invalid task contract: ${step.id}`);
      if (contract.workerKind === "human" && JSON.stringify(contract.allowedOutcomes) !== JSON.stringify([...HUMAN_REVIEW_OUTCOMES])) throw stateError("DEFINITION_INVALID", `human task ${step.id} must allow exactly accept/reject`);
      if (contract.workerKind === "agent" && (!contract.budgets || !Number.isSafeInteger(contract.budgets.maxWallTimeMs) || contract.budgets.maxWallTimeMs <= 0 || contract.requiredCapabilities.length !== 1)) throw stateError("DEFINITION_INVALID", `agent task ${step.id} requires capability and wall budget`);
      taskIds.add(step.id);
    }
    if (step.kind === "waitEvent" && (step.eventType !== "deployment.completed" || !step.correlationKey)) throw stateError("DEFINITION_INVALID", `deployment event wait ${step.id} is incomplete`);
    if (step.kind === "choice" && (!step.branches || Object.keys(step.branches).length === 0)) throw stateError("DEFINITION_INVALID", `choice ${step.id} has no branches`);
  });
  const requiredStepIds = definition.workDefinitionId === "comment-data-update"
    ? ["01-ingest-evidence", "02-update-corpus", "03-update-classification", "05-review-classification", "06-finalize-classification", "07-update-keyword-selection", "09-review-keyword-selection", "10-finalize-keyword-selection", "11-build-release-bundle", "12-materialize-release", "13-review-production-promotion", "14-finalize-production-promotion", "16-trigger-deployment", "18-wait-deployment-event", "19-verify-deployment", "20-record-deployment-state"]
    : definition.workDefinitionId === "deploy-promoted-release"
      ? ["16-trigger-deployment", "18-wait-deployment-event", "19-verify-deployment", "20-record-deployment-state"]
      : [];
  for (const requiredStepId of requiredStepIds) if (!allStepIds.has(requiredStepId)) throw stateError("DEFINITION_INVALID", `required stable step is missing: ${requiredStepId}`);
  const hash = semanticSha256(definitionWithoutHash(definition));
  return { ...cloneJson(definitionWithoutHash(definition)), definitionHash: hash };
}

export function definitionCanonicalJson(definition) { return JSON.stringify(canonicalize(definitionWithoutHash(definition))); }

export function assertDefinitionSnapshot(definition) {
  const validated = validateAndHashDefinition(definition);
  const expected = DEFINITION_SNAPSHOT_HASHES[`${validated.workDefinitionId}@${validated.revision}`];
  if (expected !== undefined && expected !== validated.definitionHash) throw stateError("DEFINITION_SNAPSHOT_MISMATCH", `definition snapshot changed for ${validated.workDefinitionId}@${validated.revision}; create a new revision`);
  return validated;
}

export function findStep(definition, stepId) {
  let found = null;
  walkStep(definition.root, (step) => { if (step.id === stepId) found = step; });
  return found;
}

export class InMemoryDefinitionRegistry {
  constructor() { this.definitions = new Map(); }
  registerDefinition(definition) {
    const validated = validateAndHashDefinition(definition);
    const key = `${validated.workDefinitionId}:${validated.revision}`;
    const existing = this.definitions.get(key);
    if (existing && existing.definitionHash !== validated.definitionHash) throw stateError("DEFINITION_IMMUTABLE", `registered definition ${key} cannot change`);
    this.definitions.set(key, validated);
    return cloneJson(existing ?? validated);
  }
  getDefinition(workDefinitionId, revision = WORK_DEFINITION_REVISION) { return cloneJson(this.definitions.get(`${workDefinitionId}:${revision}`) ?? null); }
}

export function registerDefinition(registry, definition) {
  if (!registry || typeof registry.registerDefinition !== "function") throw stateError("REGISTRY_UNAVAILABLE", "a public registry with registerDefinition is required");
  return registry.registerDefinition(validateAndHashDefinition(definition));
}

export function registerWorkDefinitions(registry, options = {}) {
  return buildWorkDefinitions(options).map((definition) => registerDefinition(registry, definition));
}

export { WORK_STEP_RESULT_SCHEMA };

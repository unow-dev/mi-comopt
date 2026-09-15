import { cloneJson, canonicalize, semanticSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

export const WORK_DEFINITION_REVISION = 2;
export const DEFINITION_SNAPSHOT_HASHES = Object.freeze({
  "comment-data-update@1": "46631dfcfe301faefb5cc2a861b3c15ad80d39851f46d623f99d55d438a02adb",
  "deploy-promoted-release@1": "5d2470412841db1334e77459fa969536a6829f2612ac241f39270daeace76579",
  "comment-data-update@2": "77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1",
  "deploy-promoted-release@2": "aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c",
});
export const ROUTING_OUTCOMES = Object.freeze(["continue", "review_required", "rejected", "superseded", "wait", "verify", "deployment_failed"]);
export const HUMAN_REVIEW_OUTCOMES = Object.freeze(["accept", "reject"]);

const WORK_STEP_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stateResult", "refs", "inputFingerprint"],
  properties: {
    stateResult: { type: "string", minLength: 1, enum: ["succeeded", "committed", "unchanged", "created", "reused", "materialized", "already_materialized", "review_required", "rejected", "conflict", "blocked", "triggered", "already_deployed", "verified", "not_verified", "deployment_failed"] },
    refs: {
      type: "object",
      additionalProperties: false,
      properties: {
        evidenceIds: { type: "array", items: { type: "string" } }, assessmentId: { type: "string" }, proposalId: { type: "string" }, decisionId: { type: "string" }, corpusVersionId: { type: "string" }, classificationVersionId: { type: "string" }, keywordSelectionVersionId: { type: "string" }, releaseId: { type: "string" }, promotionVersionId: { type: "string" }, deploymentVersionId: { type: "string" }, deploymentRequestId: { type: "string" }, verificationRef: { type: "string" },
      },
    },
    inputFingerprint: { type: "string", minLength: 1 },
    outputFingerprint: { type: "string", minLength: 1 },
    details: { type: "object" },
  },
};

const HUMAN_REVIEW_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { rationale: { type: "string", minLength: 1 } },
};

const SESSION_BINDING = (path) => ({ source: "session", path });
const STEP_BINDING = (stepId, path) => ({ source: "step", stepId, path });
const TASK_BINDING = (stepId, path) => ({ source: "task", stepId, path });
const NOOP = (id, marker) => ({ kind: "noop", id, result: marker });

const AGENT_OUTCOMES = {
  "01": ["continue"],
  "02": ["continue", "superseded"],
  "03": ["continue", "review_required", "superseded"],
  "06": ["continue", "rejected", "superseded"],
  "07": ["continue", "review_required", "superseded"],
  "10": ["continue", "rejected", "superseded"],
  "11": ["continue"],
  "12": ["continue"],
  "13": ["continue", "superseded"],
  "14": ["continue", "rejected", "superseded"],
  "16": ["wait", "verify", "superseded", "deployment_failed"],
  "19": ["continue", "rejected"],
  "20": ["continue", "superseded"],
};

function agentTask(id, capability, permissions, maxWallTimeMs, maxAttempts, inputBindings = {}, outcomeKey = id.slice(0, 2)) {
  return {
    kind: "task", id, goal: `${capability} application service`, inputBindings,
    contract: {
      workerKind: "agent",
      requiredCapabilities: [capability],
      requestedPermissions: permissions,
      retryPolicy: { maxAttempts, manualRetryAllowed: true, interventionOnExhaustion: true },
      budgets: { maxWallTimeMs },
      allowedOutcomes: [...(AGENT_OUTCOMES[outcomeKey] ?? ["continue"])],
      resultSchema: cloneJson(WORK_STEP_RESULT_SCHEMA),
    },
  };
}

function humanReview(id, goal, inputBindings = {}) {
  return {
    kind: "task", id, goal, inputBindings,
    contract: {
      workerKind: "human", requiredCapabilities: [], requestedPermissions: [], retryPolicy: { maxAttempts: 1 },
      allowedOutcomes: [...HUMAN_REVIEW_OUTCOMES], resultSchema: cloneJson(HUMAN_REVIEW_RESULT_SCHEMA),
    },
  };
}

function sequence(id, children) { return { kind: "sequence", id, children }; }
function choice(id, decision, branches) { return { kind: "choice", id, decision, branches }; }
function scoped(id, suffix = "") { return suffix ? `${id}-${suffix}` : id; }

function terminal(id, marker) { return NOOP(id, marker); }

function deploymentVerifyAndRecord({ suffix = "", releaseBinding, targetBinding, externalRunBinding = undefined }) {
  const verifyId = scoped("19-verify-deployment", suffix);
  const recordId = scoped("20-record-deployment-state", suffix);
  const verifyBindings = { releaseId: releaseBinding, target: targetBinding };
  if (externalRunBinding) verifyBindings.externalRunRef = externalRunBinding;
  return sequence(scoped("deployment-verify-and-record", suffix), [
    agentTask(verifyId, "deployment.verify", ["state:read", "deployment:verify"], 20000, 2, verifyBindings, "19"),
    choice(scoped("19-route-verification", suffix), TASK_BINDING(verifyId, "/outcome"), {
      rejected: terminal(scoped("deployment-verification-rejected", suffix), { terminalStatus: "deployment_failed" }),
      continue: sequence(scoped("deployment-record-continuation", suffix), [
        agentTask(recordId, "deployment.record", ["state:read", "state:propose", "state:auto-decide", "state:commit"], 15000, 2, {
          releaseId: releaseBinding, verificationRef: STEP_BINDING(verifyId, "/refs/verificationRef"), target: targetBinding,
        }, "20"),
        choice(scoped("20-route-deployment-record", suffix), TASK_BINDING(recordId, "/outcome"), {
          superseded: terminal(scoped("deployment-record-superseded", suffix), { terminalStatus: "superseded", conflictAt: "deployment" }),
          continue: terminal(scoped("deployment-record-completed", suffix), { terminalStatus: "deployed" }),
        }),
      ]),
    }),
  ]);
}

function deploymentContinuation({ promotionVersionBinding, releaseBinding, targetBinding, suffix = "" }) {
  const triggerId = scoped("16-trigger-deployment", suffix);
  const waitId = scoped("18-wait-deployment-event", suffix);
  const trigger = agentTask(triggerId, "deployment.trigger", ["state:read", "deployment:trigger"], 20000, 3, {
    promotionVersionId: promotionVersionBinding, releaseId: releaseBinding, target: targetBinding,
  }, "16");
  const verifyAfterEvent = deploymentVerifyAndRecord({
    releaseBinding: STEP_BINDING(triggerId, "/refs/releaseId"), targetBinding, externalRunBinding: STEP_BINDING(waitId, "/externalRunRef"), suffix,
  });
  const verifyAlreadyServing = deploymentVerifyAndRecord({
    suffix: scoped("already-serving", suffix), releaseBinding: STEP_BINDING(triggerId, "/refs/releaseId"), targetBinding,
  });
  return sequence(scoped("deployment-continuation", suffix), [
    trigger,
    choice(scoped("16-route-deployment-trigger", suffix), TASK_BINDING(triggerId, "/outcome"), {
      superseded: terminal(scoped("deployment-promotion-superseded", suffix), { terminalStatus: "superseded", conflictAt: "promotion" }),
      deployment_failed: terminal(scoped("deployment-trigger-failed", suffix), { terminalStatus: "deployment_failed" }),
      verify: verifyAlreadyServing,
      wait: sequence(scoped("deployment-wait-continuation", suffix), [
        { kind: "waitEvent", id: waitId, eventType: "deployment.completed", correlationKey: STEP_BINDING(triggerId, "/refs/deploymentRequestId") },
        choice(scoped("18-route-deployment-event", suffix), STEP_BINDING(waitId, "/status"), {
          failed: terminal(scoped("deployment-event-failed", suffix), { terminalStatus: "deployment_failed" }),
          cancelled: terminal(scoped("deployment-event-cancelled", suffix), { terminalStatus: "deployment_failed" }),
          succeeded: verifyAfterEvent,
        }),
      ]),
    }),
  ]);
}

function releaseContinuation({ classificationBinding, keywordBinding, targetBinding = SESSION_BINDING("/target/deploymentTarget"), suffix = "" }) {
  const materializeId = scoped("12-materialize-release", suffix);
  const proposalId = scoped("13-propose-production-promotion", suffix);
  const reviewId = scoped("13-review-production-promotion", suffix);
  const finalizeId = scoped("14-finalize-production-promotion", suffix);
  const promotion = agentTask(proposalId, "promotion.propose", ["state:read", "state:propose"], 15000, 2, {
    releaseId: STEP_BINDING(materializeId, "/refs/releaseId"), target: SESSION_BINDING("/target/promotionStream"),
  }, "13");
  const finalize = sequence(scoped("production-finalize-continuation", suffix), [
      humanReview(reviewId, "Review the materialized release for production promotion", { releaseId: STEP_BINDING(materializeId, "/refs/releaseId"), proposalId: STEP_BINDING(proposalId, "/refs/proposalId") }),
      agentTask(finalizeId, "promotion.finalize", ["state:read", "state:commit"], 15000, 2, {
        proposalId: STEP_BINDING(proposalId, "/refs/proposalId"), releaseId: STEP_BINDING(materializeId, "/refs/releaseId"), review: TASK_BINDING(reviewId, ""),
      }, "14"),
      choice(scoped("14-route-production-promotion", suffix), TASK_BINDING(finalizeId, "/outcome"), {
        rejected: terminal(scoped("production-not-promoted", suffix), { terminalStatus: "not_promoted" }),
        superseded: terminal(scoped("production-promotion-superseded", suffix), { terminalStatus: "superseded", conflictAt: "promotion" }),
        continue: deploymentContinuation({ promotionVersionBinding: STEP_BINDING(finalizeId, "/refs/promotionVersionId"), releaseBinding: STEP_BINDING(finalizeId, "/refs/releaseId"), targetBinding, suffix }),
      }),
    ]);
  return sequence(scoped("release-promotion-deployment-continuation", suffix), [
    agentTask(scoped("11-build-release-bundle", suffix), "release.build", ["state:read", "release:build"], 20000, 2, {
      corpusVersionId: STEP_BINDING("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: classificationBinding, keywordSelectionVersionId: keywordBinding,
      projectionDefinitionVersionId: SESSION_BINDING("/pinned/projectionDefinitionVersionId"), classificationPolicyVersionId: SESSION_BINDING("/pinned/classificationPolicyVersionId"), keywordPolicyVersionId: SESSION_BINDING("/pinned/keywordPolicyVersionId"), accountPolicyVersionId: SESSION_BINDING("/pinned/accountPolicyVersionId"),
    }, "11"),
    agentTask(materializeId, "release.materialize", ["release:build", "artifact:write"], 25000, 3, { releaseId: STEP_BINDING(scoped("11-build-release-bundle", suffix), "/refs/releaseId") }, "12"),
    promotion,
    choice(scoped("13-route-production-proposal", suffix), TASK_BINDING(proposalId, "/outcome"), {
      superseded: terminal(scoped("production-proposal-superseded", suffix), { terminalStatus: "superseded", conflictAt: "promotion" }),
      continue: finalize,
    }),
  ]);
}

function keywordContinuation({ classificationBinding, suffix = "" }) {
  const assessId = scoped("07-update-keyword-selection", suffix);
  const reviewId = scoped("09-review-keyword-selection", suffix);
  const finalizeId = scoped("10-finalize-keyword-selection", suffix);
  const assess = agentTask(assessId, "keyword-selection.assess", ["state:read", "state:propose", "state:auto-decide", "state:commit"], 25000, 2, {
    classificationVersionId: classificationBinding, corpusVersionId: STEP_BINDING("02-update-corpus", "/refs/corpusVersionId"), keywordSelectionVersionId: SESSION_BINDING("/pinned/keywordSelectionVersionId"), keywordPolicyVersionId: SESSION_BINDING("/pinned/keywordPolicyVersionId"),
  }, "07");
  const finalize = sequence(scoped("keyword-review-finalize-continuation", suffix), [
    humanReview(reviewId, "Review the proposed Keyword Selection state", { proposalId: STEP_BINDING(assessId, "/refs/proposalId"), assessmentId: STEP_BINDING(assessId, "/refs/assessmentId") }),
    agentTask(finalizeId, "keyword-selection.finalize", ["state:read", "state:commit"], 15000, 2, { proposalId: STEP_BINDING(assessId, "/refs/proposalId"), review: TASK_BINDING(reviewId, "") }, "10"),
    choice(scoped("10-route-keyword-finalize", suffix), TASK_BINDING(finalizeId, "/outcome"), {
      rejected: terminal(scoped("keyword-change-rejected", suffix), { terminalStatus: "change_rejected", stage: "keyword-selection" }),
      superseded: terminal(scoped("keyword-finalize-superseded", suffix), { terminalStatus: "superseded", conflictAt: "keyword-selection" }),
      continue: releaseContinuation({ classificationBinding, keywordBinding: STEP_BINDING(finalizeId, "/refs/keywordSelectionVersionId"), suffix: suffix ? `${suffix}-after-keyword-review` : "after-keyword-review" }),
    }),
  ]);
  return sequence(scoped("keyword-continuation", suffix), [assess, choice(scoped("07-route-keyword-selection", suffix), TASK_BINDING(assessId, "/outcome"), {
    superseded: terminal(scoped("keyword-assessment-superseded", suffix), { terminalStatus: "superseded", conflictAt: "keyword-selection" }),
    continue: releaseContinuation({ classificationBinding, keywordBinding: STEP_BINDING(assessId, "/refs/keywordSelectionVersionId"), suffix }), review_required: finalize,
  })]);
}

function classificationContinuation({ suffix = "" } = {}) {
  const assessId = scoped("03-update-classification", suffix);
  const reviewId = scoped("05-review-classification", suffix);
  const finalizeId = scoped("06-finalize-classification", suffix);
  const reviewed = sequence(scoped("classification-review-finalize-continuation", suffix), [
    humanReview(reviewId, "Review the proposed Classification state", { proposalId: STEP_BINDING(assessId, "/refs/proposalId"), assessmentId: STEP_BINDING(assessId, "/refs/assessmentId") }),
    agentTask(finalizeId, "classification.finalize", ["state:read", "state:commit"], 15000, 2, { proposalId: STEP_BINDING(assessId, "/refs/proposalId"), review: TASK_BINDING(reviewId, "") }, "06"),
    choice(scoped("06-route-classification-finalize", suffix), TASK_BINDING(finalizeId, "/outcome"), {
      rejected: terminal(scoped("classification-change-rejected", suffix), { terminalStatus: "change_rejected", stage: "classification" }),
      superseded: terminal(scoped("classification-finalize-superseded", suffix), { terminalStatus: "superseded", conflictAt: "classification" }),
      continue: keywordContinuation({ classificationBinding: STEP_BINDING(finalizeId, "/refs/classificationVersionId"), suffix: suffix ? `${suffix}-after-classification-review` : "after-classification-review" }),
    }),
  ]);
  const assess = agentTask(assessId, "classification.assess", ["state:read", "state:propose", "state:auto-decide", "state:commit"], 25000, 2, { corpusVersionId: STEP_BINDING("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: SESSION_BINDING("/pinned/classificationVersionId"), classificationPolicyVersionId: SESSION_BINDING("/pinned/classificationPolicyVersionId") }, "03");
  return sequence(scoped("classification-continuation", suffix), [assess, choice(scoped("03-route-classification", suffix), TASK_BINDING(assessId, "/outcome"), {
    superseded: terminal(scoped("classification-assessment-superseded", suffix), { terminalStatus: "superseded", conflictAt: "classification" }), continue: keywordContinuation({ classificationBinding: STEP_BINDING(assessId, "/refs/classificationVersionId"), suffix }), review_required: reviewed,
  })]);
}

export function buildCommentDataUpdateDefinition({ revision = WORK_DEFINITION_REVISION } = {}) {
  if (revision !== 2) throw stateError("DEFINITION_REVISION_INVALID", "the v2 builder only emits revision 2");
  const corpus = agentTask("02-update-corpus", "corpus.update", ["state:read", "state:propose", "state:auto-decide", "state:commit"], 15000, 2, { evidenceIds: STEP_BINDING("01-ingest-evidence", "/refs/evidenceIds"), initialCorpusVersionId: SESSION_BINDING("/pinned/initialCorpusVersionId"), corpusPolicyVersionId: SESSION_BINDING("/pinned/corpusPolicyVersionId") }, "02");
  return {
    workDefinitionId: "comment-data-update", revision: 2, schemaVersion: 2,
    root: sequence("comment-data-update-root", [
      agentTask("01-ingest-evidence", "evidence.ingest", ["evidence:write"], 20000, 3, { updateRequestId: SESSION_BINDING("/updateRequestId"), evidenceSource: SESSION_BINDING("/evidenceSource") }, "01"),
      corpus,
      choice("02-route-corpus", TASK_BINDING("02-update-corpus", "/outcome"), { superseded: terminal("corpus-superseded", { terminalStatus: "superseded", conflictAt: "corpus" }), continue: classificationContinuation() }),
    ]),
    limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 },
  };
}

export function buildDeployPromotedReleaseDefinition({ revision = WORK_DEFINITION_REVISION } = {}) {
  if (revision !== 2) throw stateError("DEFINITION_REVISION_INVALID", "the v2 builder only emits revision 2");
  return {
    workDefinitionId: "deploy-promoted-release", revision: 2, schemaVersion: 2,
    root: deploymentContinuation({ promotionVersionBinding: SESSION_BINDING("/promotionVersionId"), releaseBinding: SESSION_BINDING("/releaseId"), targetBinding: SESSION_BINDING("/target/deploymentTarget") }),
    limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 },
  };
}

export function buildWorkDefinitions(options = {}) { return [buildCommentDataUpdateDefinition(options), buildDeployPromotedReleaseDefinition(options)]; }

function walkStep(step, visitor, seen = new Set()) {
  if (!step || typeof step !== "object" || typeof step.id !== "string" || step.id.length === 0) throw stateError("DEFINITION_INVALID", "every step requires a stable id");
  if (seen.has(step.id)) throw stateError("DEFINITION_INVALID", `duplicate step id: ${step.id}`);
  seen.add(step.id); visitor(step);
  if (step.kind === "sequence") for (const child of step.children ?? []) walkStep(child, visitor, seen);
  if (step.kind === "parallelAll") for (const child of Object.values(step.branches ?? {})) walkStep(child, visitor, seen);
  if (step.kind === "choice") {
    if (step.decision?.kind === "task") { if (seen.has(step.decision.id)) throw stateError("DEFINITION_INVALID", `duplicate step id: ${step.decision.id}`); seen.add(step.decision.id); visitor(step.decision); }
    for (const branch of Object.values(step.branches ?? {})) walkStep(branch, visitor, seen);
  }
}

export function definitionWithoutHash(definition) { const copy = cloneJson(definition); delete copy.definitionHash; return copy; }

/** Consumer-side checks are limited to stable IDs and metadata; Provider owns structure. */
export function validateAndHashDefinition(definition) {
  if (!definition || typeof definition !== "object" || !/^[-a-z0-9]+$/.test(definition.workDefinitionId) || !Number.isSafeInteger(definition.revision) || definition.revision < 0 || ![1, 2].includes(definition.schemaVersion)) throw stateError("DEFINITION_INVALID", "definition metadata is invalid");
  const allStepIds = new Set();
  walkStep(definition.root, (step) => {
    allStepIds.add(step.id);
    if (definition.schemaVersion === 2 && step.kind === "task") {
      const expectedCapability = Object.entries(EXPECTED_CAPABILITIES).find(([id]) => step.id === id || step.id.startsWith(`${id}-`))?.[1];
      if (expectedCapability && (step.contract.workerKind !== "agent" || step.contract.requiredCapabilities?.length !== 1 || step.contract.requiredCapabilities[0] !== expectedCapability)) throw stateError("DEFINITION_INVALID", `${step.id} must use capability ${expectedCapability}`);
      if (step.contract.workerKind === "human" && step.contract.budgets !== undefined) throw stateError("DEFINITION_INVALID", `${step.id} must not define business budgets`);
    }
  });
  const requiredStepIds = definition.workDefinitionId === "comment-data-update"
    ? ["01-ingest-evidence", "02-update-corpus", "03-update-classification", "05-review-classification", "06-finalize-classification", "07-update-keyword-selection", "09-review-keyword-selection", "10-finalize-keyword-selection", "11-build-release-bundle", "12-materialize-release", "13-propose-production-promotion", "13-review-production-promotion", "14-finalize-production-promotion", "16-trigger-deployment", "18-wait-deployment-event", "19-verify-deployment", "20-record-deployment-state"]
    : definition.workDefinitionId === "deploy-promoted-release" ? ["16-trigger-deployment", "18-wait-deployment-event", "19-verify-deployment", "20-record-deployment-state"] : [];
  for (const id of requiredStepIds) if (!allStepIds.has(id)) throw stateError("DEFINITION_INVALID", `required stable step is missing: ${id}`);
  return { ...definitionWithoutHash(definition), definitionHash: semanticSha256(definitionWithoutHash(definition)) };
}

const EXPECTED_CAPABILITIES = Object.freeze({
  "01-ingest-evidence": "evidence.ingest", "02-update-corpus": "corpus.update", "03-update-classification": "classification.assess", "06-finalize-classification": "classification.finalize", "07-update-keyword-selection": "keyword-selection.assess", "10-finalize-keyword-selection": "keyword-selection.finalize", "11-build-release-bundle": "release.build", "12-materialize-release": "release.materialize", "13-propose-production-promotion": "promotion.propose", "14-finalize-production-promotion": "promotion.finalize", "16-trigger-deployment": "deployment.trigger", "19-verify-deployment": "deployment.verify", "20-record-deployment-state": "deployment.record",
});

export function definitionCanonicalJson(definition) { return JSON.stringify(canonicalize(definitionWithoutHash(definition))); }

export function assertDefinitionSnapshot(definition) {
  const validated = validateAndHashDefinition(definition);
  const expected = DEFINITION_SNAPSHOT_HASHES[`${validated.workDefinitionId}@${validated.revision}`];
  if (expected !== undefined && expected !== validated.definitionHash) throw stateError("DEFINITION_SNAPSHOT_MISMATCH", `definition snapshot changed for ${validated.workDefinitionId}@${validated.revision}; create a new revision`);
  return validated;
}

export function findStep(definition, stepId) {
  let found = null; walkStep(definition.root, (step) => { if (step.id === stepId) found = step; }); return found;
}

export class InMemoryDefinitionRegistry {
  constructor() { this.definitions = new Map(); }
  registerDefinition(definition) { const validated = validateAndHashDefinition(definition); const key = `${validated.workDefinitionId}:${validated.revision}`; const existing = this.definitions.get(key); if (existing && existing.definitionHash !== validated.definitionHash) throw stateError("DEFINITION_IMMUTABLE", `registered definition ${key} cannot change`); this.definitions.set(key, validated); return cloneJson(existing ?? validated); }
  getDefinition(workDefinitionId, revision = WORK_DEFINITION_REVISION) { return cloneJson(this.definitions.get(`${workDefinitionId}:${revision}`) ?? null); }
}

export function registerDefinition(registry, definition) { if (!registry || typeof registry.registerDefinition !== "function") throw stateError("REGISTRY_UNAVAILABLE", "a public registry with registerDefinition is required"); return registry.registerDefinition(validateAndHashDefinition(definition)); }
export function registerWorkDefinitions(registry, options = {}) { return buildWorkDefinitions(options).map((definition) => registerDefinition(registry, definition)); }
export { WORK_STEP_RESULT_SCHEMA };

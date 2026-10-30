import { cloneJson, semanticSha256 } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";
import { WORK_STEP_RESULT_V3_SCHEMA } from "./contracts.js";

export const V3_SCHEMA_VERSION = 2;
export const TARGET_REVISION_START = 3;
export const V3_REVISION = 4;

const SESSION = (path) => ({ source: "session", path });
const STEP = (stepId, path, optional = false) => ({ source: "step", stepId, path, ...(optional ? { optional: true } : {}) });
const TASK = (stepId, path, optional = false) => ({ source: "task", stepId, path, ...(optional ? { optional: true } : {}) });

const AGENT_OUTCOMES = Object.freeze({
  "01": ["continue"], "02": ["continue", "superseded"], "03a": ["reuse", "ready_without_handoff", "handoff_required", "superseded"], "03": ["continue", "review_required", "superseded"], "C03": ["review_required", "superseded"], "06": ["continue", "rejected", "superseded"],
  "07a": ["reuse", "handoff_required", "superseded"], "07": ["continue", "review_required", "superseded"], "10": ["continue", "rejected", "superseded"], "11": ["continue"], "12": ["continue"], "13": ["continue"], "14": ["continue", "rejected", "superseded"], "16": ["wait", "verify", "superseded", "deployment_failed"], "19": ["continue", "superseded", "deployment_failed"], "20": ["continue", "superseded"],
});

function agentTask(id, capability, permissions, bindings, key, maxWallTimeMs = 30000) {
  return { kind: "task", id, goal: `${capability} application service v3`, inputBindings: bindings, contract: { workerKind: "agent", requiredCapabilities: [capability], requestedPermissions: permissions, retryPolicy: { maxAttempts: 3, manualRetryAllowed: true, interventionOnExhaustion: true }, budgets: { maxWallTimeMs }, allowedOutcomes: AGENT_OUTCOMES[key] ?? ["continue"], resultSchema: cloneJson(WORK_STEP_RESULT_V3_SCHEMA) } };
}

function humanTask(id, goal, bindings = {}, outcomes = ["submitted"], resultSchema = undefined) {
  return { kind: "task", id, goal, inputBindings: bindings, contract: { workerKind: "human", requiredCapabilities: [], requestedPermissions: [], retryPolicy: { maxAttempts: 1 }, allowedOutcomes: outcomes, ...(resultSchema ? { resultSchema } : {}) } };
}

function sequence(id, children) { return { kind: "sequence", id, children }; }
function choice(id, decision, branches) { return { kind: "choice", id, decision, branches }; }
function noop(id, result = null) { return { kind: "noop", id, result }; }
function terminal(id, terminalStatus, extra = {}) { return noop(id, { terminalStatus, ...extra }); }

const HUMAN_ARTIFACT_RESULT = { type: "object", additionalProperties: false, required: ["executionId", "artifact"], properties: { executionId: { type: "string", minLength: 1 }, artifact: { type: "object", additionalProperties: false, required: ["artifactVersionId", "blobHash", "logicalPath", "size"], properties: { artifactVersionId: { type: "string", minLength: 1 }, blobHash: { type: "string", pattern: "^[0-9a-f]{64}$" }, logicalPath: { type: "string", minLength: 1 }, size: { type: "integer", minimum: 0 } } } } };

function classificationFlow({ safeBranches = false } = {}) {
  const prepare = agentTask("03a-prepare-classification-handoff", "classification.handoff.prepare", ["state:read", "artifact:write"], { corpusVersionId: STEP("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: SESSION("/pinned/classificationVersionId"), classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId") }, "03a");
  const receive = humanTask("03b-receive-classification-response", "Receive exactly one classification response.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT);
  if (safeBranches) {
    const classifyAndRoute = (branchId, responseTaskId = undefined) => {
      const assessId = `03-update-classification-${branchId}`;
      const reviewId = `05-review-classification-${branchId}`;
      const assess = agentTask(assessId, "classification.assess", ["state:read", "state:propose", "state:auto-decide", "state:commit"], {
        corpusVersionId: STEP("02-update-corpus", "/refs/corpusVersionId"),
        classificationVersionId: SESSION("/pinned/classificationVersionId"),
        classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId"),
        handoffPreparation: STEP("03a-prepare-classification-handoff", "", true),
        ...(responseTaskId ? { response: TASK(responseTaskId, "", true) } : {}),
      }, "03");
      const review = humanTask(reviewId, "Review the proposed Classification state", { proposal: STEP(assessId, "/refs/proposalId"), assessment: STEP(assessId, "/refs/assessmentId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
      const finalizeAndRoute = (reviewed) => {
        const finalizeId = `06-finalize-classification-${branchId}-${reviewed ? "reviewed" : "without-review"}`;
        const finalize = agentTask(finalizeId, "classification.finalize", ["state:read", "state:commit"], {
          proposalId: STEP(assessId, "/refs/proposalId", true),
          ...(reviewed ? { review: TASK(reviewId, "", true) } : {}),
          assessed: STEP(assessId, "", true),
        }, "06", 20000);
        const routeSuffix = `${branchId}-${reviewed ? "reviewed" : "without-review"}`;
        return sequence(`${routeSuffix}-finalize-classification`, [finalize, choice(`${routeSuffix}-route-classification-finalize`, TASK(finalizeId, "/outcome"), {
          continue: keywordFlow({ classification: STEP(finalizeId, "/refs/classificationVersionId"), safeBranches: true, safeSuffix: routeSuffix }),
          rejected: terminal(`${routeSuffix}-classification-rejected`, "change_rejected", { stage: "classification" }),
          superseded: conflictTerminal(finalizeId, "classification"),
        })]);
      };
      return sequence(`${branchId}-classification-assess-and-route`, [assess, choice(`${branchId}-route-classification-assessment`, TASK(assessId, "/outcome"), {
        continue: finalizeAndRoute(false),
        review_required: sequence(`${branchId}-classification-human-review`, [review, finalizeAndRoute(true)]),
        superseded: conflictTerminal(assessId, "classification"),
      })]);
    };
    const receiveId = "03b-receive-classification-response-classification-handoff";
    const handoffReceive = humanTask(receiveId, "Receive exactly one classification response.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT);
    return sequence("classification-v3-flow-safe", [prepare, choice("03a-route-classification-handoff-safe", TASK(prepare.id, "/outcome"), {
      reuse: keywordFlow({ classification: STEP(prepare.id, "/refs/classificationVersionId"), safeBranches: true, safeSuffix: "classification-reuse" }),
      ready_without_handoff: classifyAndRoute("classification-ready"),
      handoff_required: sequence("classification-handoff-safe", [handoffReceive, classifyAndRoute("classification-handoff", receiveId)]),
      superseded: terminal("classification-handoff-superseded", "superseded", { conflictAt: "classification" }),
    })]);
  }
  const assess = agentTask("03-update-classification", "classification.assess", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { corpusVersionId: STEP("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: SESSION("/pinned/classificationVersionId"), classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId"), handoffPreparation: STEP("03a-prepare-classification-handoff", "", true), response: TASK("03b-receive-classification-response", "", true) }, "03");
  const review = humanTask("05-review-classification", "Review the proposed Classification state", { proposal: STEP("03-update-classification", "/refs/proposalId"), assessment: STEP("03-update-classification", "/refs/assessmentId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = agentTask("06-finalize-classification", "classification.finalize", ["state:read", "state:commit"], { proposalId: STEP("03-update-classification", "/refs/proposalId", true), review: TASK("05-review-classification", "", true), assessed: STEP("03-update-classification", "", true) }, "06", 20000);
  return sequence("classification-v3-flow", [
    prepare,
    choice("03a-route-classification-handoff", TASK("03a-prepare-classification-handoff", "/outcome"), { reuse: noop("03a-reuse"), ready_without_handoff: noop("03a-ready-without-handoff"), handoff_required: sequence("03a-handoff", [receive]), superseded: noop("03a-upstream-superseded") }),
    assess,
    choice("03-route-classification-assessment", TASK("03-update-classification", "/outcome"), { continue: noop("03-no-review"), review_required: sequence("03-human-review", [review]), superseded: noop("03-assessment-superseded") }),
    finalize,
    choice("06-route-classification-finalize", TASK("06-finalize-classification", "/outcome"), { continue: keywordFlow({ classification: STEP("06-finalize-classification", "/refs/classificationVersionId") }), rejected: terminal("classification-rejected", "change_rejected", { stage: "classification" }), superseded: terminal("classification-superseded", "superseded", { conflictAt: "classification" }) }),
  ]);
}

function keywordFlow({ classification, corpus = STEP("02-update-corpus", "/refs/corpusVersionId"), safeBranches = false, safeSuffix = "correction" }) {
  const scopedId = (base) => safeBranches && safeSuffix !== "correction" ? `${base}-${safeSuffix}` : base;
  const prepareId = scopedId("07a-prepare-keyword-handoff");
  const receiveId = scopedId("07b-receive-keyword-proposal");
  const assessId = scopedId("07-update-keyword-selection");
  const reviewId = scopedId("09-review-keyword-selection");
  const prepare = agentTask(prepareId, "keyword-selection.handoff.prepare", ["state:read", "artifact:write"], { corpusVersionId: corpus, classificationVersionId: classification, keywordSelectionVersionId: SESSION("/pinned/keywordSelectionVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId") }, "07a");
  const receive = humanTask(receiveId, "Receive exactly one candidate_proposal.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT);
  const assess = agentTask(assessId, "keyword-selection.assess", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { corpusVersionId: corpus, classificationVersionId: classification, keywordSelectionVersionId: SESSION("/pinned/keywordSelectionVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId"), handoffPreparation: STEP(prepareId, "", true), proposal: TASK(receiveId, "", true) }, "07");
  const review = humanTask(reviewId, "Review the proposed Keyword Selection state", { proposal: STEP(assessId, "/refs/proposalId"), assessment: STEP(assessId, "/refs/assessmentId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = agentTask(scopedId("10-finalize-keyword-selection"), "keyword-selection.finalize", ["state:read", "state:commit"], { proposalId: STEP(assessId, "/refs/proposalId", true), review: TASK(reviewId, "", true), assessed: STEP(assessId, "", true) }, "10", 20000);
  if (!safeBranches) return sequence("keyword-v3-flow", [prepare, choice("07a-route-keyword-handoff", TASK(prepareId, "/outcome"), { reuse: noop("07a-reuse"), handoff_required: sequence("07a-handoff", [receive]), superseded: noop("07a-superseded") }), assess, choice("07-route-keyword-assessment", TASK(assessId, "/outcome"), { continue: noop("07-no-review"), review_required: sequence("07-human-review", [review]), superseded: noop("07-assessment-superseded") }), finalize, choice("10-route-keyword-finalize", TASK(finalize.id, "/outcome"), { continue: releaseFlow({ classification, keyword: STEP(finalize.id, "/refs/keywordSelectionVersionId") }), rejected: terminal("keyword-rejected", "change_rejected", { stage: "keyword-selection" }), superseded: terminal("keyword-superseded", "superseded", { conflictAt: "keyword-selection" }) })]);
  const finalizeAndRoute = (branchId, reviewed) => {
    const finalizeStepId = scopedId(`10-finalize-keyword-selection-${branchId}`);
    const finalizeStep = agentTask(finalizeStepId, "keyword-selection.finalize", ["state:read", "state:commit"], {
      proposalId: STEP(assessId, "/refs/proposalId", true),
      ...(reviewed ? { review: TASK(reviewId, "", true) } : {}),
      assessed: STEP(assessId, "", true),
    }, "10", 20000);
    const releaseSuffix = safeSuffix === "correction" ? branchId : `${safeSuffix}-${branchId}`;
    return sequence(scopedId(`${branchId}-finalize-keyword`), [finalizeStep, choice(scopedId(`${branchId}-route-finalize`), TASK(finalizeStepId, "/outcome"), {
    continue: releaseFlow({ corpus, classification, keyword: STEP(finalizeStepId, "/refs/keywordSelectionVersionId"), safeBranches: true, safeSuffix: releaseSuffix }),
    rejected: terminal(scopedId(`${branchId}-rejected`), "change_rejected", { stage: "keyword-selection" }),
    superseded: terminal(scopedId(`${branchId}-superseded`), "superseded", { conflictAt: "keyword-selection" }),
  })]);
  };
  const assessAndRoute = sequence(scopedId("07-assess-keyword-selection"), [assess, choice(scopedId("07-route-keyword-assessment"), TASK(assessId, "/outcome"), {
    continue: finalizeAndRoute("07-accepted-without-review", false),
    review_required: sequence(scopedId("07-human-review"), [review, finalizeAndRoute("07-reviewed", true)]),
    superseded: terminal(scopedId("07-assessment-superseded"), "superseded", { conflictAt: "keyword-selection" }),
  })]);
  return sequence(scopedId("keyword-v3-flow"), [prepare, choice(scopedId("07a-route-keyword-handoff"), TASK(prepareId, "/outcome"), {
    reuse: releaseFlow({ corpus, classification, keyword: STEP(prepareId, "/refs/keywordSelectionVersionId"), safeBranches: true, safeSuffix: safeSuffix === "correction" ? "reuse" : `${safeSuffix}-reuse` }),
    handoff_required: sequence(scopedId("07a-handoff"), [receive, assessAndRoute]),
    superseded: terminal(scopedId("07a-superseded"), "superseded", { conflictAt: "keyword-selection" }),
  })]);
}

function releaseFlow({ classification, keyword, corpus = STEP("02-update-corpus", "/refs/corpusVersionId"), safeBranches = false, safeSuffix = "correction" }) {
  const build = agentTask("11-build-release-bundle", "release.build", ["state:read", "release:build"], { corpusVersionId: corpus, classificationVersionId: classification, keywordSelectionVersionId: keyword, corpusPolicyVersionId: SESSION("/pinned/corpusPolicyVersionId"), classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId"), accountPolicyVersionId: SESSION("/pinned/accountPolicyVersionId"), projectionDefinitionVersionId: SESSION("/pinned/projectionDefinitionVersionId") }, "11");
  const materialize = agentTask("12-materialize-release", "release.materialize", ["release:build", "artifact:write"], { releaseId: STEP("11-build-release-bundle", "/refs/releaseId") }, "12");
  const propose = agentTask("13-propose-production-promotion", "promotion.propose", ["state:read", "state:propose"], { releaseId: STEP("12-materialize-release", "/refs/releaseId"), promotionStream: SESSION("/target/promotionStream") }, "13");
  const review = humanTask("13-review-production-promotion", "Review the exact verified release for production promotion", { releaseId: STEP("12-materialize-release", "/refs/releaseId"), proposalId: STEP("13-propose-production-promotion", "/refs/proposalId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = agentTask("14-finalize-production-promotion", "promotion.finalize", ["state:read", "state:commit"], { proposalId: STEP("13-propose-production-promotion", "/refs/proposalId"), releaseId: STEP("12-materialize-release", "/refs/releaseId"), review: TASK("13-review-production-promotion", "", true) }, "14", 20000);
  const trigger = agentTask("16-trigger-deployment", "deployment.trigger", ["state:read", "deployment:trigger"], { acceptedPromotionDecisionId: STEP("14-finalize-production-promotion", "/refs/decisionId"), promotionVersionId: STEP("14-finalize-production-promotion", "/refs/promotionVersionId"), releaseId: STEP("14-finalize-production-promotion", "/refs/releaseId"), target: SESSION("/target/deploymentTarget") }, "16");
  const wait = { kind: "waitEvent", id: "18-wait-deployment-event", eventType: "deployment.completed", correlationKey: STEP("16-trigger-deployment", "/refs/deploymentRequestId") };
  const verify = agentTask("19-verify-deployment", "deployment.verify", ["state:read", "deployment:verify"], { deploymentRequestId: STEP("16-trigger-deployment", "/refs/deploymentRequestId"), releaseId: STEP("16-trigger-deployment", "/refs/releaseId"), promotionVersionId: STEP("16-trigger-deployment", "/refs/promotionVersionId"), target: SESSION("/target/deploymentTarget"), event: STEP("18-wait-deployment-event", "", true) }, "19", 20000);
  const record = agentTask("20-record-deployment-state", "deployment.record", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { deploymentRequestId: STEP("16-trigger-deployment", "/refs/deploymentRequestId"), releaseId: STEP("16-trigger-deployment", "/refs/releaseId"), promotionVersionId: STEP("16-trigger-deployment", "/refs/promotionVersionId"), verificationRef: STEP("19-verify-deployment", "/refs/verificationRef") }, "20", 20000);
  if (safeBranches) {
    const safeId = (base) => `${base}-${safeSuffix}`;
    const safeBuild = agentTask(safeId("11-build-release-bundle"), "release.build", ["state:read", "release:build"], { corpusVersionId: corpus, classificationVersionId: classification, keywordSelectionVersionId: keyword, corpusPolicyVersionId: SESSION("/pinned/corpusPolicyVersionId"), classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId"), accountPolicyVersionId: SESSION("/pinned/accountPolicyVersionId"), projectionDefinitionVersionId: SESSION("/pinned/projectionDefinitionVersionId") }, "11");
    const safeMaterialize = agentTask(safeId("12-materialize-release"), "release.materialize", ["release:build", "artifact:write"], { releaseId: STEP(safeBuild.id, "/refs/releaseId") }, "12");
    const safePropose = agentTask(safeId("13-propose-production-promotion"), "promotion.propose", ["state:read", "state:propose"], { releaseId: STEP(safeMaterialize.id, "/refs/releaseId"), promotionStream: SESSION("/target/promotionStream") }, "13");
    const safeReview = humanTask(safeId("13-review-production-promotion"), "Review the exact verified release for production promotion", { releaseId: STEP(safeMaterialize.id, "/refs/releaseId"), proposalId: STEP(safePropose.id, "/refs/proposalId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
    const safeFinalize = agentTask(safeId("14-finalize-production-promotion"), "promotion.finalize", ["state:read", "state:commit"], { proposalId: STEP(safePropose.id, "/refs/proposalId"), releaseId: STEP(safeMaterialize.id, "/refs/releaseId"), review: TASK(safeReview.id, "") }, "14", 20000);
    const safeTrigger = agentTask(safeId("16-trigger-deployment"), "deployment.trigger", ["state:read", "deployment:trigger"], { acceptedPromotionDecisionId: STEP(safeFinalize.id, "/refs/decisionId"), promotionVersionId: STEP(safeFinalize.id, "/refs/promotionVersionId"), releaseId: STEP(safeFinalize.id, "/refs/releaseId"), target: SESSION("/target/deploymentTarget") }, "16");
    const safeWait = { kind: "waitEvent", id: safeId("18-wait-deployment-event"), eventType: "deployment.completed", correlationKey: STEP(safeTrigger.id, "/refs/deploymentRequestId") };
    const safeVerifyAndRecord = (branchSuffix, withEvent) => {
      const verifyStep = agentTask(safeId(`19-verify-deployment-${branchSuffix}`), "deployment.verify", ["state:read", "deployment:verify"], { deploymentRequestId: STEP(safeTrigger.id, "/refs/deploymentRequestId"), releaseId: STEP(safeTrigger.id, "/refs/releaseId"), promotionVersionId: STEP(safeTrigger.id, "/refs/promotionVersionId"), target: SESSION("/target/deploymentTarget"), ...(withEvent ? { event: STEP(safeWait.id, "", true) } : {}) }, "19", 20000);
      const recordStep = agentTask(safeId(`20-record-deployment-state-${branchSuffix}`), "deployment.record", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { deploymentRequestId: STEP(safeTrigger.id, "/refs/deploymentRequestId"), releaseId: STEP(safeTrigger.id, "/refs/releaseId"), promotionVersionId: STEP(safeTrigger.id, "/refs/promotionVersionId"), verificationRef: STEP(verifyStep.id, "/refs/verificationRef") }, "20", 20000);
      return sequence(safeId(`deployment-verify-record-${branchSuffix}`), [verifyStep, choice(safeId(`19-route-verification-${branchSuffix}`), TASK(verifyStep.id, "/outcome"), {
        continue: sequence(safeId(`deployment-record-${branchSuffix}`), [recordStep, choice(safeId(`20-route-record-${branchSuffix}`), TASK(recordStep.id, "/outcome"), {
          continue: terminal(safeId(`deployed-${branchSuffix}`), "deployed"),
          superseded: terminal(safeId(`deployment-record-superseded-${branchSuffix}`), "superseded", { conflictAt: "deployment" }),
        })]),
        superseded: terminal(safeId(`deployment-verification-superseded-${branchSuffix}`), "superseded", { conflictAt: "deployment" }),
        deployment_failed: terminal(safeId(`deployment-verification-failed-${branchSuffix}`), "deployment_failed"),
      })]);
    };
    const safeDeployment = sequence(safeId("deployment-triggered-flow"), [safeTrigger, choice(safeId("16-route-deployment"), TASK(safeTrigger.id, "/outcome"), {
      wait: sequence(safeId("deployment-wait-and-verify"), [safeWait, safeVerifyAndRecord("after-wait", true)]),
      verify: safeVerifyAndRecord("already-serving", false),
      superseded: terminal(safeId("deployment-promotion-stale"), "superseded", { conflictAt: "deployment" }),
      deployment_failed: terminal(safeId("deployment-trigger-failed"), "deployment_failed"),
    })]);
    return sequence(safeId("release-deployment-v3-flow"), [safeBuild, safeMaterialize, safePropose, safeReview, safeFinalize, choice(safeId("14-route-promotion-finalize"), TASK(safeFinalize.id, "/outcome"), {
      continue: safeDeployment,
      rejected: terminal(safeId("promotion-rejected"), "not_promoted"),
      superseded: terminal(safeId("promotion-superseded"), "superseded", { conflictAt: "promotion" }),
    })]);
  }
  const deployment = sequence("deployment-v3-flow", [
    trigger,
    choice("16-route-deployment", TASK("16-trigger-deployment", "/outcome"), {
      wait: sequence("deployment-wait", [wait, noop("deployment-event-received")]),
      verify: noop("deployment-already-serving"),
      superseded: noop("deployment-promotion-stale"),
      deployment_failed: noop("deployment-trigger-failed"),
    }),
    verify,
    choice("19-route-deployment-verification", TASK("19-verify-deployment", "/outcome"), {
      continue: sequence("deployment-record-flow", [record, choice("20-route-deployment-record", TASK("20-record-deployment-state", "/outcome"), { continue: terminal("deployed", "deployed"), superseded: terminal("deployment-record-superseded", "superseded", { conflictAt: "deployment" }) })]),
      superseded: terminal("deployment-verification-superseded", "superseded", { conflictAt: "deployment" }),
      deployment_failed: terminal("deployment-verification-failed", "deployment_failed"),
    }),
  ]);
  return sequence("release-deployment-v3-flow", [build, materialize, propose, review, finalize, choice("14-route-promotion-finalize", TASK("14-finalize-production-promotion", "/outcome"), { continue: deployment, rejected: terminal("promotion-rejected", "not_promoted"), superseded: terminal("promotion-superseded", "superseded", { conflictAt: "promotion" }) })]);
}

function conflictTerminal(stepId, conflictAt) {
  return choice(`${stepId}-route-conflict`, STEP(stepId, "/details/conflictAt"), {
    classification: terminal(`${stepId}-classification-conflict`, "superseded", { conflictAt: "classification" }),
    corpus: terminal(`${stepId}-corpus-conflict`, "superseded", { conflictAt: "corpus" }),
  });
}

export function buildClassificationCorrectionDefinitionV3({ revision = 1 } = {}) {
  if (revision === 2) return buildClassificationCorrectionBatchDefinitionV3();
  if (!Number.isSafeInteger(revision) || revision < 1) throw stateError("DEFINITION_REVISION_INVALID", "classification-correction revision must be a positive integer");
  const propose = agentTask("03-correction-propose", "classification.correction.propose", ["state:read", "state:propose"], {
    corpusVersionId: SESSION("/pinned/corpusVersionId"),
    classificationVersionId: SESSION("/pinned/classificationVersionId"),
    classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId"),
    correction: SESSION("/correction"),
    requestedBy: SESSION("/requestedBy"),
  }, "C03");
  const review = humanTask("05-review-classification", "Review the exact comment group, label change, reason and requester", {
    proposal: STEP("03-correction-propose", "/refs/proposalId"),
    assessment: STEP("03-correction-propose", "/refs/assessmentId"),
  }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = agentTask("06-finalize-classification", "classification.finalize", ["state:read", "state:commit"], {
    proposalId: STEP("03-correction-propose", "/refs/proposalId"),
    review: TASK("05-review-classification", ""),
  }, "06", 20000);
  const finalizeAndRoute = sequence("06-finalize-correction", [finalize, choice("06-route-correction-finalize", TASK("06-finalize-classification", "/outcome"), {
    continue: keywordFlow({
      corpus: SESSION("/pinned/corpusVersionId"),
      classification: STEP("06-finalize-classification", "/refs/classificationVersionId"),
      safeBranches: true,
    }),
    rejected: terminal("classification-correction-rejected", "change_rejected", { stage: "classification" }),
    superseded: conflictTerminal("06-finalize-classification", "classification"),
  })]);
  return {
    workDefinitionId: "classification-correction",
    revision,
    schemaVersion: V3_SCHEMA_VERSION,
    root: sequence("classification-correction-v3-root", [propose, choice("03-route-correction-proposal", TASK("03-correction-propose", "/outcome"), {
      review_required: sequence("03-human-review-and-finalize", [review, finalizeAndRoute]),
      superseded: conflictTerminal("03-correction-propose", "classification"),
    })]),
    limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 },
  };
}

export function validateClassificationCorrectionDefinitionV3(definition) {
  if (!definition || definition.schemaVersion !== V3_SCHEMA_VERSION || definition.workDefinitionId !== "classification-correction" || !Number.isSafeInteger(definition.revision) || definition.revision < 1) {
    throw stateError("DEFINITION_INVALID", "invalid classification-correction definition metadata");
  }
  return { ...cloneJson(definition), definitionHash: semanticSha256({ ...cloneJson(definition), definitionHash: undefined }) };
}

export function registerClassificationCorrectionDefinitionV3({ registry, publicApi, revision = 1 } = {}) {
  if (!registry || typeof registry.registerDefinition !== "function") throw stateError("REGISTRY_UNAVAILABLE", "a definition registry is required");
  const definition = buildClassificationCorrectionDefinitionV3({ revision });
  const validated = publicApi?.validateAndHashDefinition ? publicApi.validateAndHashDefinition(cloneJson(definition)) : definition;
  if (validated.definitionHash !== validateClassificationCorrectionDefinitionV3(definition).definitionHash) throw stateError("DEFINITION_HASH_MISMATCH", "provider and consumer correction definition hashes differ");
  registry.registerDefinition(validated);
  return validated;
}

export function buildCommentDataUpdateDefinitionV3({ revision = V3_REVISION } = {}) {
  if (!Number.isSafeInteger(revision) || revision < TARGET_REVISION_START) throw stateError("DEFINITION_REVISION_INVALID", "v3 revision must start at 3");
  const definition = { workDefinitionId: "comment-data-update", revision, schemaVersion: V3_SCHEMA_VERSION, root: sequence("comment-data-update-v3-root", [
    humanTask("00-receive-update-artifact", "Receive exactly one comment-batch.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT),
    agentTask("01-ingest-evidence", "evidence.ingest", ["evidence:write"], { inputArtifact: TASK("00-receive-update-artifact", "", true) }, "01"),
    agentTask("02-update-corpus", "corpus.update", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { evidence: STEP("01-ingest-evidence", "/refs/evidenceIds"), initialCorpusVersionId: SESSION("/pinned/initialCorpusVersionId"), corpusPolicyVersionId: SESSION("/pinned/corpusPolicyVersionId") }, "02"),
    choice("02-route-corpus", TASK("02-update-corpus", "/outcome"), { continue: classificationFlow({ safeBranches: revision >= 4 }), superseded: terminal("corpus-superseded", "superseded", { conflictAt: "corpus" }) }),
  ]), limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 } };
  return definition;
}

export function buildDeployPromotedReleaseDefinitionV3() {
  throw stateError("DEFINITION_REVISION_UNSUPPORTED", "deploy-promoted-release remains revision 2");
}

export function validateV3Definition(definition) {
  if (!definition || definition.schemaVersion !== V3_SCHEMA_VERSION || definition.workDefinitionId !== "comment-data-update" || definition.revision < TARGET_REVISION_START) throw stateError("DEFINITION_INVALID", "invalid v3 comment-data-update definition metadata");
  return { ...cloneJson(definition), definitionHash: semanticSha256({ ...cloneJson(definition), definitionHash: undefined }) };
}

export function resolveTargetRevision({ registry, publicApi, start = V3_REVISION } = {}) {
  if (!registry || typeof registry.getDefinition !== "function") return start;
  for (let revision = start; revision < start + 1000; revision += 1) {
    const candidate = validateV3Definition(buildCommentDataUpdateDefinitionV3({ revision }));
    const existing = registry.getDefinition("comment-data-update", revision);
    if (!existing) return revision;
    const existingHash = existing.definitionHash ?? publicApi?.validateAndHashDefinition?.(existing)?.definitionHash;
    if (existingHash === candidate.definitionHash) return revision;
  }
  throw stateError("DEFINITION_REVISION_INVALID", "could not resolve an immutable TARGET_REVISION");
}

/** Register v3 only when the caller explicitly selects the side-by-side
 * revision. The existing production registration remains v2-only. */
export function registerCommentDataUpdateDefinitionV3({ registry, publicApi, revision = V3_REVISION } = {}) {
  if (!registry || typeof registry.registerDefinition !== "function") throw stateError("REGISTRY_UNAVAILABLE", "a definition registry is required");
  const definition = buildCommentDataUpdateDefinitionV3({ revision });
  const validated = publicApi?.validateAndHashDefinition ? publicApi.validateAndHashDefinition(cloneJson(definition)) : definition;
  if (validated.definitionHash !== validateV3Definition(definition).definitionHash) throw stateError("DEFINITION_HASH_MISMATCH", "provider and consumer v3 definition hashes differ");
  registry.registerDefinition(validated);
  return validated;
}

export { HUMAN_ARTIFACT_RESULT };


export function buildClassificationCorrectionBatchDefinitionV3() {
  const task = (id, action, bindings, permissions) => {
    const value = agentTask(id, `classification-correction.batch.${action}`, permissions, bindings, "batch", 120000);
    value.contract.allowedOutcomes = action === "finalize" ? ["continue", "rejected", "superseded"] : [action === "propose" ? "review_required" : "continue", "invalid", "superseded"];
    return value;
  };
  const batchConflict = (id) => choice(`${id}-batch-conflict`, STEP(id, "/details/conflictAt"), Object.fromEntries(["classification", "corpus", "policy"].map((conflictAt) => [conflictAt, terminal(`${id}-${conflictAt}-superseded`, "superseded", { conflictAt })])));
  const op = SESSION("/correctionOperationId");
  const validateId = "01-validate-correction-batch", resolveId = "02-resolve-correction-batch", proposeId = "03-propose-correction-batch", finalizeId = "06-finalize-correction-batch";
  const fingerprint = STEP(validateId, "/details/requestFingerprint");
  const hash = STEP(resolveId, "/details/changeSetHash");
  const review = humanTask("05-review-classification", "全修正の本文・差分・件数・理由・根拠を確認し、バッチ全体を承認または却下する", {
    proposal: STEP(proposeId, "/refs/proposalId"), assessment: STEP(proposeId, "/refs/assessmentId"), changeSetHash: hash,
  }, ["accept", "reject"], { type: "object", additionalProperties: false, required: ["rationale"], properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = task(finalizeId, "finalize", { correctionOperationId: op, proposalId: STEP(proposeId, "/refs/proposalId"), assessmentId: STEP(proposeId, "/refs/assessmentId"), approvedChangeSetHash: hash, review: TASK(review.id, "") }, ["state:read", "state:commit"]);
  const finalized = sequence("batch-finalize", [finalize, choice("batch-route-finalization", TASK(finalizeId, "/outcome"), {
    continue: keywordFlow({ corpus: SESSION("/pinned/corpusVersionId"), classification: STEP(finalizeId, "/refs/classificationVersionId"), safeBranches: true }),
    rejected: terminal("batch-rejected", "change_rejected", { stage: "classification" }),
    superseded: batchConflict(finalizeId),
  })]);
  const guarded = (step, success, continuation) => sequence(`${step.id}-and-route`, [step, choice(`${step.id}-route`, TASK(step.id, "/outcome"), {
    [success]: continuation,
    invalid: terminal(`${step.id}-invalid`, "invalid_request"),
    superseded: batchConflict(step.id),
  })]);
  const propose = task(proposeId, "propose", { correctionOperationId: op, requestFingerprint: fingerprint, changeSetId: STEP(resolveId, "/details/changeSetId"), changeSetHash: hash }, ["state:read", "state:propose"]);
  const resolve = task(resolveId, "resolve", { batch: SESSION(""), requestFingerprint: fingerprint }, ["state:read", "state:propose"]);
  const validate = task(validateId, "validate", { batch: SESSION("") }, ["state:read"]);
  return { workDefinitionId: "classification-correction", revision: 2, schemaVersion: V3_SCHEMA_VERSION,
    root: guarded(validate, "continue", guarded(resolve, "continue", guarded(propose, "review_required", sequence("batch-review-finalize", [review, finalized])))),
    limits: { maxBufferedExternalEvents: 50, maxDynamicTasksPerSession: 0 } };
}

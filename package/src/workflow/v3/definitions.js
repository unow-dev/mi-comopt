import { cloneJson, semanticSha256 } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";
import { WORK_STEP_RESULT_V3_SCHEMA } from "./contracts.js";

export const V3_SCHEMA_VERSION = 2;
export const TARGET_REVISION_START = 3;
export const V3_REVISION = TARGET_REVISION_START;

const SESSION = (path) => ({ source: "session", path });
const STEP = (stepId, path, optional = false) => ({ source: "step", stepId, path, ...(optional ? { optional: true } : {}) });
const TASK = (stepId, path, optional = false) => ({ source: "task", stepId, path, ...(optional ? { optional: true } : {}) });

const AGENT_OUTCOMES = Object.freeze({
  "01": ["continue"], "02": ["continue", "superseded"], "03a": ["reuse", "ready_without_handoff", "handoff_required", "superseded"], "03": ["continue", "review_required", "superseded"], "06": ["continue", "rejected", "superseded"],
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

function classificationFlow() {
  const prepare = agentTask("03a-prepare-classification-handoff", "classification.handoff.prepare", ["state:read", "artifact:write"], { corpus: STEP("02-update-corpus", "/refs/corpusVersionId"), classification: SESSION("/pinned/classificationVersionId"), policy: SESSION("/pinned/classificationPolicyVersionId") }, "03a");
  const receive = humanTask("03b-receive-classification-response", "Receive exactly one classification response.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT);
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

function keywordFlow({ classification }) {
  const prepare = agentTask("07a-prepare-keyword-handoff", "keyword-selection.handoff.prepare", ["state:read", "artifact:write"], { corpusVersionId: STEP("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: classification, keywordSelectionVersionId: SESSION("/pinned/keywordSelectionVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId") }, "07a");
  const receive = humanTask("07b-receive-keyword-proposal", "Receive exactly one candidate_proposal.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT);
  const assess = agentTask("07-update-keyword-selection", "keyword-selection.assess", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { corpusVersionId: STEP("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: classification, keywordSelectionVersionId: SESSION("/pinned/keywordSelectionVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId"), handoffPreparation: STEP("07a-prepare-keyword-handoff", "", true), proposal: TASK("07b-receive-keyword-proposal", "", true) }, "07");
  const review = humanTask("09-review-keyword-selection", "Review the proposed Keyword Selection state", { proposal: STEP("07-update-keyword-selection", "/refs/proposalId"), assessment: STEP("07-update-keyword-selection", "/refs/assessmentId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = agentTask("10-finalize-keyword-selection", "keyword-selection.finalize", ["state:read", "state:commit"], { proposalId: STEP("07-update-keyword-selection", "/refs/proposalId", true), review: TASK("09-review-keyword-selection", "", true), assessed: STEP("07-update-keyword-selection", "", true) }, "10", 20000);
  return sequence("keyword-v3-flow", [prepare, choice("07a-route-keyword-handoff", TASK("07a-prepare-keyword-handoff", "/outcome"), { reuse: noop("07a-reuse"), handoff_required: sequence("07a-handoff", [receive]), superseded: noop("07a-superseded") }), assess, choice("07-route-keyword-assessment", TASK("07-update-keyword-selection", "/outcome"), { continue: noop("07-no-review"), review_required: sequence("07-human-review", [review]), superseded: noop("07-assessment-superseded") }), finalize, choice("10-route-keyword-finalize", TASK("10-finalize-keyword-selection", "/outcome"), { continue: releaseFlow({ classification, keyword: STEP("10-finalize-keyword-selection", "/refs/keywordSelectionVersionId") }), rejected: terminal("keyword-rejected", "change_rejected", { stage: "keyword-selection" }), superseded: terminal("keyword-superseded", "superseded", { conflictAt: "keyword-selection" }) })]);
}

function releaseFlow({ classification, keyword }) {
  const build = agentTask("11-build-release-bundle", "release.build", ["state:read", "release:build"], { corpusVersionId: STEP("02-update-corpus", "/refs/corpusVersionId"), classificationVersionId: classification, keywordSelectionVersionId: keyword, corpusPolicyVersionId: SESSION("/pinned/corpusPolicyVersionId"), classificationPolicyVersionId: SESSION("/pinned/classificationPolicyVersionId"), keywordPolicyVersionId: SESSION("/pinned/keywordPolicyVersionId"), accountPolicyVersionId: SESSION("/pinned/accountPolicyVersionId"), projectionDefinitionVersionId: SESSION("/pinned/projectionDefinitionVersionId") }, "11");
  const materialize = agentTask("12-materialize-release", "release.materialize", ["release:build", "artifact:write"], { releaseId: STEP("11-build-release-bundle", "/refs/releaseId") }, "12");
  const propose = agentTask("13-propose-production-promotion", "promotion.propose", ["state:read", "state:propose"], { releaseId: STEP("12-materialize-release", "/refs/releaseId"), promotionStream: SESSION("/target/promotionStream") }, "13");
  const review = humanTask("13-review-production-promotion", "Review the exact verified release for production promotion", { releaseId: STEP("12-materialize-release", "/refs/releaseId"), proposalId: STEP("13-propose-production-promotion", "/refs/proposalId") }, ["accept", "reject"], { type: "object", additionalProperties: false, properties: { rationale: { type: "string", minLength: 1 } } });
  const finalize = agentTask("14-finalize-production-promotion", "promotion.finalize", ["state:read", "state:commit"], { proposalId: STEP("13-propose-production-promotion", "/refs/proposalId"), releaseId: STEP("12-materialize-release", "/refs/releaseId"), review: TASK("13-review-production-promotion", "", true) }, "14", 20000);
  const trigger = agentTask("16-trigger-deployment", "deployment.trigger", ["state:read", "deployment:trigger"], { promotionVersionId: STEP("14-finalize-production-promotion", "/refs/promotionVersionId"), releaseId: STEP("14-finalize-production-promotion", "/refs/releaseId"), target: SESSION("/target/deploymentTarget") }, "16");
  const wait = { kind: "waitEvent", id: "18-wait-deployment-event", eventType: "deployment.completed", correlationKey: STEP("16-trigger-deployment", "/refs/deploymentRequestId") };
  const verify = agentTask("19-verify-deployment", "deployment.verify", ["state:read", "deployment:verify"], { deploymentRequestId: STEP("16-trigger-deployment", "/refs/deploymentRequestId"), releaseId: STEP("16-trigger-deployment", "/refs/releaseId"), promotionVersionId: STEP("16-trigger-deployment", "/refs/promotionVersionId"), target: SESSION("/target/deploymentTarget"), event: STEP("18-wait-deployment-event", "", true) }, "19", 20000);
  const record = agentTask("20-record-deployment-state", "deployment.record", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { deploymentRequestId: STEP("16-trigger-deployment", "/refs/deploymentRequestId"), releaseId: STEP("16-trigger-deployment", "/refs/releaseId"), promotionVersionId: STEP("16-trigger-deployment", "/refs/promotionVersionId"), verificationRef: STEP("19-verify-deployment", "/refs/verificationRef") }, "20", 20000);
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

export function buildCommentDataUpdateDefinitionV3({ revision = V3_REVISION } = {}) {
  if (!Number.isSafeInteger(revision) || revision < TARGET_REVISION_START) throw stateError("DEFINITION_REVISION_INVALID", "v3 revision must start at 3");
  const definition = { workDefinitionId: "comment-data-update", revision, schemaVersion: V3_SCHEMA_VERSION, root: sequence("comment-data-update-v3-root", [
    humanTask("00-receive-update-artifact", "Receive exactly one comment-batch.json", {}, ["submitted"], HUMAN_ARTIFACT_RESULT),
    agentTask("01-ingest-evidence", "evidence.ingest", ["evidence:write"], { inputArtifact: TASK("00-receive-update-artifact", "", true) }, "01"),
    agentTask("02-update-corpus", "corpus.update", ["state:read", "state:propose", "state:auto-decide", "state:commit"], { evidence: STEP("01-ingest-evidence", "/refs/evidenceIds"), initialCorpusVersionId: SESSION("/pinned/initialCorpusVersionId"), corpusPolicyVersionId: SESSION("/pinned/corpusPolicyVersionId") }, "02"),
    choice("02-route-corpus", TASK("02-update-corpus", "/outcome"), { continue: classificationFlow(), superseded: terminal("corpus-superseded", "superseded", { conflictAt: "corpus" }) }),
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

export function resolveTargetRevision({ registry, publicApi, start = TARGET_REVISION_START } = {}) {
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
  return registry.registerDefinition(validated);
}

export { HUMAN_ARTIFACT_RESULT };

import assert from "node:assert/strict";
import test from "node:test";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { STREAM_KEYS } from "../src/application/services.js";
import { createV3OperationContext, runV3Idempotent, serviceRequestHashV3 } from "../src/application/v3/context.js";
import { validateV3WorkStepResult } from "../src/workflow/v3/result-rules.js";
import { buildCommentDataUpdateDefinitionV3, validateV3Definition } from "../src/workflow/v3/definitions.js";
import { validateAndHashDefinition } from "work-orchestrator";
import { validateCommentDataUpdateOutcomeSchema, validateHumanArtifactSubmissionResultSchema } from "../src/workflow/v3/contracts.js";
import { externalEventCommandId } from "../src/application/v3/deployment-services.js";
import { assertV3CutoverPreconditions, advanceV3Cutover } from "../src/migration/v3-cutover.js";
import { ReleaseApplicationServiceV3 } from "../src/application/v3/release-services.js";
import { MemoryReleaseArtifactStore } from "../src/release/artifact-store.js";

async function makeControlPlane() {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  return { db, controlPlane: new StateControlPlane(db) };
}

function genesis(controlPlane, stream, versionId, state) {
  const streamId = controlPlane.ensureStream(stream).stream_id;
  return controlPlane.createGenesis({ streamId, versionId, payload: { schema_version: 1, state } });
}

test("v3 definition is side-by-side and provider canonical hash matches", () => {
  const local = validateV3Definition(buildCommentDataUpdateDefinitionV3());
  const provider = validateAndHashDefinition(local);
  assert.equal(local.revision, 3);
  assert.equal(provider.definitionHash, local.definitionHash);
  assert.equal(local.definitionHash, "fc91e79126f5055c64b01194586955242fc2846efae97133c6b068de388bbb48");
});

test("v3 WorkStepResult and terminal outcomes reject authoritative extras", () => {
  assert.deepEqual(validateV3WorkStepResult({ stepId: "03-update-classification", routingOutcome: "review_required", result: { stateResult: "review_required", refs: { assessmentId: "a", proposalId: "p" } } }), { stateResult: "review_required", refs: { assessmentId: "a", proposalId: "p" } });
  assert.throws(() => validateV3WorkStepResult({ stepId: "03-update-classification", routingOutcome: "review_required", result: { stateResult: "review_required", refs: { assessmentId: "a", proposalId: "p", decisionId: "unexpected" } } }), /WORK_STEP_RESULT_INVALID/);
  assert.deepEqual(validateCommentDataUpdateOutcomeSchema({ terminalStatus: "superseded", conflictAt: "promotion" }), { terminalStatus: "superseded", conflictAt: "promotion" });
  assert.throws(() => validateCommentDataUpdateOutcomeSchema({ terminalStatus: "deployed", conflictAt: "promotion" }), /OUTCOME_INVALID/);
  assert.deepEqual(validateHumanArtifactSubmissionResultSchema({ executionId: "e", artifact: { artifactVersionId: "a", blobHash: "a".repeat(64), logicalPath: "response.json", size: 1 } }).executionId, "e");
});

test("v3 operation identity/hash omit retry and transport metadata", () => {
  const first = serviceRequestHashV3({ b: 2, a: 1, operationId: "ignored", executionId: "e1", runtime: { runId: "r1" } });
  const second = serviceRequestHashV3({ a: 1, b: 2, operationId: "other", executionId: "e2", runtime: { runId: "r2" } });
  assert.equal(first, second);
});

test("v3 state bootstrap is additive and application idempotency uses session/step", async () => {
  const { db, controlPlane } = await makeControlPlane();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'v3_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["v3_deployment_event_outbox", "v3_deployment_requests", "v3_deployment_target_sequences", "v3_release_artifacts", "v3_release_bundles"]);
  const ctx = createV3OperationContext({ sessionId: "session", stepId: "01-ingest-evidence" });
  let calls = 0;
  assert.deepEqual(runV3Idempotent(controlPlane, ctx, "test.v3", { value: 1, executionId: "ephemeral" }, () => { calls += 1; return { stateResult: "succeeded", refs: {} }; }), { stateResult: "succeeded", refs: {} });
  assert.deepEqual(runV3Idempotent(controlPlane, ctx, "test.v3", { executionId: "different", value: 1 }, () => { calls += 1; return { stateResult: "succeeded", refs: {} }; }), { stateResult: "succeeded", refs: {} });
  assert.equal(calls, 1);
  assert.throws(() => runV3Idempotent(controlPlane, ctx, "test.v3", { value: 2 }, () => ({ stateResult: "succeeded", refs: {} })), /IDEMPOTENCY_CONFLICT/);
  db.close();
});

test("release identity uses exact pins and materialization is deterministic", async () => {
  const { db, controlPlane } = await makeControlPlane();
  for (const [stream, id] of [[STREAM_KEYS.corpus, "corpus"], [STREAM_KEYS.classification, "classification"], [STREAM_KEYS.keywordSelection, "keyword"], [STREAM_KEYS.projectionDefinition, "projection"]]) genesis(controlPlane, stream, id, {});
  for (const [stream, id, kind] of [[STREAM_KEYS.corpusPolicy, "corpus-policy", "corpus"], [STREAM_KEYS.classificationPolicy, "classification-policy", "classification"], [STREAM_KEYS.keywordPolicy, "keyword-policy", "keyword-selection"], [STREAM_KEYS.accountPolicy, "account-policy", "account-candidate"]]) genesis(controlPlane, stream, id, { policy_kind: kind });
  const service = new ReleaseApplicationServiceV3(controlPlane, { artifactStore: new MemoryReleaseArtifactStore(), artifactBuilder: () => ({ "release.json": Buffer.from("stable") }) });
  const buildRequest = { corpusVersionId: "corpus", classificationVersionId: "classification", keywordSelectionVersionId: "keyword", corpusPolicyVersionId: "corpus-policy", classificationPolicyVersionId: "classification-policy", keywordPolicyVersionId: "keyword-policy", accountPolicyVersionId: "account-policy", projectionDefinitionVersionId: "projection" };
  const build = service.build(createV3OperationContext({ sessionId: "release-session", stepId: "11-build-release-bundle", permissions: ["state:read", "release:build"] }), buildRequest);
  const materialized = service.materialize(createV3OperationContext({ sessionId: "release-session", stepId: "12-materialize-release", permissions: ["release:build", "artifact:write"] }), { releaseId: build.refs.releaseId });
  assert.equal(materialized.stateResult, "materialized");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM v3_release_bundles").get().count, 1);
  db.close();
});

test("external event IDs and cutover order are fix-forward only", () => {
  assert.equal(externalEventCommandId("abc"), "event:abc");
  assertV3CutoverPreconditions({ mandatoryVerificationPassed: true, providerCompatible: true, v2HashesUnchanged: true, targetRevision: 3 });
  const frozen = advanceV3Cutover("v2_open", "freeze_v2", { newV2Starts: 0 });
  assert.equal(frozen.state, "v2_frozen");
  assert.throws(() => advanceV3Cutover("v2_frozen", "enable_v3"), /CUTOVER_ORDER_INVALID/);
  const failed = advanceV3Cutover("v3_enabled", "smoke_failed");
  assert.equal(failed.newV3StartsFrozen, true);
  assert.equal(failed.legacyWriterEnabled, false);
});

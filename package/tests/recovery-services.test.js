import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecoveryClassificationPlan,
  buildRecoveryPlan,
  RecoveryApplicationServiceV3,
  verifyRecoveryArtifacts,
} from "../src/application/v3/recovery-services.js";
import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInputIntoDatabase, openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { canonicalJson, semanticSha256 } from "../src/state/canonical.js";
import { STREAM_KEYS, typedCorpusHandler } from "../src/application/services.js";
import { advancePersistedV3Cutover, initializeV3Cutover } from "../src/migration/v3-cutover.js";

const ref = (letter, snapshotIndex = 0) => ({ payloadSha256: letter.repeat(64), snapshotIndex });
const observation = (observationId, commentText, username = `user-${observationId}`) => ({
  observationId,
  sourceIndex: Number(observationId),
  username,
  handle: `handle-${observationId}`,
  commentText,
  postedAt: `2026-09-22T00:00:${String(observationId).padStart(2, "0")}Z`,
  postedDate: "2026-09-22",
});
const version = (versionId, versionNo, snapshotRefs) => ({
  versionId,
  versionNo,
  streamId: "corpus/comments",
  payload: { state: { schema_version: 2, snapshot_refs: snapshotRefs } },
});

test("recovery plan uses the explicit range and canonical count equation", () => {
  const plan = buildRecoveryPlan({
    baseCorpusVersionId: "base",
    brokenHeadCorpusVersionId: "broken",
    committedVersions: [
      version("base", 1, [ref("a")]),
      version("broken", 2, [ref("a"), ref("b")]),
    ],
    snapshotBundles: [
      { snapshot: ref("a"), observations: [observation(1, "old")] },
      { snapshot: ref("b"), observations: [observation(2, "new"), { ...observation(3, "old", "user-1"), handle: "handle-1", postedAt: "2026-09-22T00:00:01Z" }, observation(4, "new-2")] },
    ],
  });

  assert.deepEqual(plan.snapshot_refs, [ref("a"), ref("b")]);
  assert.equal(plan.baseLogicalRecordCount, 1);
  assert.equal(plan.appendedRawObservationCount, 3);
  assert.equal(plan.duplicateObservationCount, 1);
  assert.equal(plan.expectedLogicalRecordCount, 3);
  assert.equal(plan.projection.survivors.length, plan.expectedLogicalRecordCount);
  assert.match(plan.recoveryPlanSha256, /^sha256:[0-9a-f]{64}$/);
});

test("recovery classification searches only exact-dedupe group members and derives same-comment inheritance from survivors", () => {
  const survivors = [observation("1", "same"), observation("2", "unresolved"), observation("4", "same")];
  const key = (row) => JSON.stringify([row.username, row.handle, row.commentText, row.postedAt, row.postedDate]);
  const dedupeGroups = [
    { key: key(survivors[0]), survivor: survivors[0], observations: [survivors[0], { ...survivors[0], observationId: "3" }] },
    { key: key(survivors[1]), survivor: survivors[1], observations: [survivors[1]] },
    { key: key(survivors[2]), survivor: survivors[2], observations: [survivors[2]] },
  ];

  const handoff = buildRecoveryClassificationPlan({ survivors, dedupeGroups, classificationHistory: [
    { versionId: "classification-old", versionNo: 1, labels: [{ observationId: "3", label: "normal" }] },
    { versionId: "classification-new", versionNo: 2, labels: [
      { observationId: "3", label: "reactive" },
      { observationId: "1", label: "direct_nuisance" },
      { observationId: "outside", label: "direct_nuisance" },
    ] },
  ] });

  assert.deepEqual(handoff.identityResolvedSurvivors, [{
    observationId: "1",
    groupIndex: 0,
    label: "direct_nuisance",
    versionId: "classification-new",
    versionNo: 2,
  }]);
  assert.deepEqual(handoff.handoffItems, [{ id: "I1", observationId: "2", commentText: "unresolved" }]);
  assert.deepEqual(handoff.labels, [
    { observationId: "1", label: "direct_nuisance" },
    { observationId: "4", label: "direct_nuisance" },
  ]);

  const complete = buildRecoveryClassificationPlan({
    survivors,
    dedupeGroups,
    classificationHistory: [
      { versionId: "classification-new", versionNo: 2, labels: [{ observationId: "3", label: "reactive" }, { observationId: "1", label: "direct_nuisance" }] },
    ],
    humanDecisions: { I1: "normal" },
  });
  assert.deepEqual(complete.labels, [
    { observationId: "1", label: "direct_nuisance" },
    { observationId: "2", label: "normal" },
    { observationId: "4", label: "direct_nuisance" },
  ]);
  assert.equal(complete.previouslyResolvedItemCount, 0);
});

test("recovery artifact verification fails closed on release identity, bytes, count, and prior-resolved evidence", () => {
  const sourceDatasetBytes = Buffer.from('{"source":"recovered"}\n');
  const overviewBytes = Buffer.from('{"overview":true}\n');
  const accountBytes = Buffer.from('{"account":true}\n');
  const keywordBytes = Buffer.from('{"keywords":true}\n');
  const recoveryPlan = {
    expectedLogicalRecordCount: 1,
    projection: { survivors: [observation("1", "only")] },
  };
  const valid = {
    recoveryPlan,
    classificationLabels: [{ observationId: "1", label: "normal" }],
    sourceDatasetBytes,
    materializedCommentsBytes: sourceDatasetBytes,
    servedCommentsBytes: sourceDatasetBytes,
    generatedOverviewBytes: overviewBytes,
    materializedOverviewBytes: overviewBytes,
    servedOverviewBytes: overviewBytes,
    generatedAccountBytes: accountBytes,
    materializedAccountBytes: accountBytes,
    servedAccountBytes: accountBytes,
    generatedKeywordBytes: keywordBytes,
    materializedKeywordBytes: keywordBytes,
    servedKeywordBytes: keywordBytes,
    servedReleaseId: "release-corrected",
    correctedReleaseId: "release-corrected",
  };
  assert.deepEqual(verifyRecoveryArtifacts(valid), {
    verificationPassed: true,
    deploymentVerified: true,
    previouslyResolvedItemCount: 0,
    logicalRecordCount: 1,
  });
  assert.throws(() => verifyRecoveryArtifacts({ ...valid, servedReleaseId: "release-old" }), /RECOVERY_DEPLOYMENT_MISMATCH/);
  assert.throws(() => verifyRecoveryArtifacts({ ...valid, servedKeywordBytes: Buffer.from("changed") }), /RECOVERY_ARTIFACT_MISMATCH/);
  assert.throws(() => verifyRecoveryArtifacts({ ...valid, previouslyResolvedItemCount: 1 }), /RECOVERY_PREVIOUSLY_RESOLVED_ITEM/);
});

test("RecoveryApplicationServiceV3 persists the corrected corpus, handoff, classification, and Source Dataset receipts idempotently", async () => {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  try {
    const first = importRawInputIntoDatabase(db, adaptCommentBatchBytes(Buffer.from(JSON.stringify([
      { username: "u1", handle: "h1", comment: "old", postedAt: "t1", postedDate: "2026-09-21" },
    ]))));
    const second = importRawInputIntoDatabase(db, adaptCommentBatchBytes(Buffer.from(JSON.stringify([
      { username: "u2", handle: "h2", comment: "new", postedAt: "t2", postedDate: "2026-09-22" },
    ]))));
    const corpusPolicy = controlPlane.ensureStream(STREAM_KEYS.corpusPolicy);
    const classificationPolicy = controlPlane.ensureStream(STREAM_KEYS.classificationPolicy);
    controlPlane.createGenesis({ streamId: corpusPolicy.stream_id, versionId: "recovery-corpus-policy", payload: { schema_version: 1, state: { auto_commit: true } } });
    controlPlane.createGenesis({ streamId: classificationPolicy.stream_id, versionId: "recovery-classification-policy", payload: { schema_version: 1, state: { auto_commit: true } } });
    const corpus = controlPlane.ensureStream(STREAM_KEYS.corpus);
    const a = { payloadSha256: first.payloadSha256, snapshotIndex: 0 };
    const b = { payloadSha256: second.payloadSha256, snapshotIndex: 0 };
    controlPlane.createGenesis({
      streamId: corpus.stream_id,
      versionId: "recovery-base",
      payload: { schema_version: 1, state: { schema_version: 2, snapshot_refs: [a] } },
      dependencies: [{ role: "policy", versionId: "recovery-corpus-policy" }],
    });
    const brokenState = { schema_version: 2, snapshot_refs: [b] };
    const proposal = controlPlane.createProposal({
      proposalId: "recovery-broken-proposal",
      streamId: corpus.stream_id,
      expectedHeadVersionId: "recovery-base",
      proposedSemanticSha256: semanticSha256(brokenState),
      payload: { schema_version: 1, state: brokenState },
      dependencies: [{ role: "policy", versionId: "recovery-corpus-policy" }],
      operationId: "recovery-broken-proposal-operation",
    });
    const decision = controlPlane.createDecision({
      decisionId: "recovery-broken-decision",
      proposalId: proposal.proposalId,
      outcome: "accepted",
      authorityKind: "system_policy",
      authorityRef: "test",
      transitionPolicyVersionId: "recovery-corpus-policy",
      operationId: "recovery-broken-decision-operation",
    });
    const broken = controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: "recovery-broken-commit", domainHandler: typedCorpusHandler() });

    initializeV3Cutover(controlPlane, {
      targetRevision: 3,
      targetDefinitionHash: "9".repeat(64),
      mandatoryVerificationPassed: true,
      providerCompatible: true,
      v2HashesUnchanged: true,
      v2Hashes: {},
    });
    advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "drain_complete", { nonterminalV2Sessions: 0 });
    advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: false });
    advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "smoke_passed", {
      smokeSessionId: "recovery-smoke",
      authoritativeStateVerified: true,
      reviewedReleaseVerified: true,
      promotionVerified: true,
      deploymentVerified: true,
      evidenceLedgerWritten: true,
    });

    const service = new RecoveryApplicationServiceV3(controlPlane);
    service.freeze({ actorId: "test", nonterminalV3Sessions: 0 });
    const plan = service.plan({ baseCorpusVersionId: "recovery-base", brokenHeadCorpusVersionId: broken.versionId, nonterminalV3Sessions: 0 });
    const started = service.start({
      baseCorpusVersionId: "recovery-base",
      brokenHeadCorpusVersionId: broken.versionId,
      expectedPlanSha256: plan.recoveryPlanSha256,
      nonterminalV3Sessions: 0,
      actorId: "test",
    });
    assert.equal(started.stateResult, "handoff_required");
    assert.equal(started.classificationPlan.previouslyResolvedItemCount, 0);
    assert.equal(service.classificationOpen({ recoveryId: started.recoveryId, actorId: "test" }).itemCount, 2);
    const completed = service.classificationComplete({ recoveryId: started.recoveryId, response: { decisions: { I1: "normal", I2: "reactive" } }, actorId: "test" });
    assert.equal(completed.stateResult, "classification_committed");
    assert.equal(controlPlane.readReceipt(`recovery:${started.recoveryId}:source-dataset`).result.recordCount, 2);
    assert.deepEqual(service.resume({ recoveryId: started.recoveryId }).stateResult, "resumed");
    assert.equal(canonicalJson(service.status({ recoveryId: started.recoveryId }).stages["source-dataset"].result.snapshot_refs), canonicalJson([
      { payload_sha256: first.payloadSha256, snapshot_index: 0 },
      { payload_sha256: second.payloadSha256, snapshot_index: 0 },
    ]));
  } finally {
    db.close();
  }
});

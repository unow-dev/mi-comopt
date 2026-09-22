import assert from "node:assert/strict";
import test from "node:test";

import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInputIntoDatabase, openCommentDatabase } from "../src/database/comment-database.js";
import { readSelectedSnapshotsInReferenceOrder } from "../src/database/raw-snapshot-repository.js";
import { CorpusApplicationServiceV3, STREAM_KEYS, createV3OperationContext } from "../src/application/index.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { projectCumulativeCorpus } from "../src/processing/analysis-input/raw-snapshot-projection.js";
import {
  buildCumulativeSourceDataset,
  serializeCumulativeSourceDataset,
  validateSourceDatasetV2,
} from "../src/processing/optimicom-ui-release/source-dataset.js";
import {
  assertClassificationHandoffSafe,
  assertCompleteClassificationState,
  planCumulativeClassification,
} from "../src/three-class/cumulative-classification-plan.js";
import { assertV3CorpusPreflight } from "../src/migration/v3-cutover.js";

const sha = (value) => value;

function ref(value, index = 0) {
  return { payloadSha256: value.repeat(64), snapshotIndex: index };
}

function observation(username, handle, comment, postedAt, postedDate) {
  return { username, handle, commentText: comment, postedAt, postedDate };
}

test("cumulative projection preserves reference order and uses exact five-field first-wins dedupe", () => {
  const result = projectCumulativeCorpus([
    { snapshot: { payloadSha256: sha("a"), snapshotIndex: 0 }, observations: [
      { observationId: 1, sourceIndex: 1, ...observation("u", "h", "same", "t", "d") },
      { observationId: 2, sourceIndex: 0, ...observation("u", "h", "first", "t", "d") },
    ] },
    { snapshot: { payloadSha256: sha("b"), snapshotIndex: 0 }, observations: [
      { observationId: 3, sourceIndex: 0, ...observation("u", "h", "same", "t", "d") },
      { observationId: 4, sourceIndex: 1, ...observation("u", "h", "same", "t ", "d") },
      { observationId: 5, sourceIndex: 2, ...observation("U", "h", "same", "t", "d") },
    ] },
  ]);

  assert.deepEqual(result.survivors.map((row) => row.observationId), ["2", "1", "4", "5"]);
  assert.equal(result.survivors[1].commentText, "same");
  assert.equal(result.survivors[2].postedAt, "t ");
  assert.equal(result.survivors[3].username, "U");
});

test("ordered database reader exposes observation identity and follows corpus reference order", async () => {
  const db = await openCommentDatabase(":memory:");
  try {
    const first = importRawInputIntoDatabase(db, adaptCommentBatchBytes(Buffer.from(JSON.stringify([
      { username: "first", handle: "h1", comment: "A", postedAt: "p1", postedDate: "d1" },
    ]))));
    const second = importRawInputIntoDatabase(db, adaptCommentBatchBytes(Buffer.from(JSON.stringify([
      { username: "second", handle: "h2", comment: "B", postedAt: "p2", postedDate: "d2" },
    ]))));
    const bundles = readSelectedSnapshotsInReferenceOrder(db, [
      { payloadSha256: second.payloadSha256, snapshotIndex: 0 },
      { payloadSha256: first.payloadSha256, snapshotIndex: 0 },
    ]);
    assert.deepEqual(bundles.map((bundle) => bundle.observations[0].username), ["second", "first"]);
    assert.equal(typeof bundles[0].observations[0].observationId, "number");
  } finally {
    db.close();
  }
});

test("classification planner inherits exact observation then comment text and only hands off unresolved comments", () => {
  const survivors = [
    { observationId: "1", commentText: "A", username: "u1", handle: "h1", postedAt: "t1", postedDate: "d1" },
    { observationId: "2", commentText: "B", username: "u2", handle: "h2", postedAt: "t2", postedDate: "d2" },
    { observationId: "3", commentText: "B", username: "u3", handle: "h3", postedAt: "t3", postedDate: "d3" },
    { observationId: "4", commentText: "C", username: "u4", handle: "h4", postedAt: "t4", postedDate: "d4" },
  ];
  const plan = planCumulativeClassification({
    survivors,
    priorLabels: [
      { observationId: "1", commentText: "A", label: "normal" },
      { observationId: "old", commentText: "B", label: "reactive" },
    ],
    decisions: { I1: "direct_nuisance" },
  });
  assert.deepEqual(plan.labels, [
    { observationId: "1", label: "normal" },
    { observationId: "2", label: "reactive" },
    { observationId: "3", label: "reactive" },
    { observationId: "4", label: "direct_nuisance" },
  ]);
  assert.deepEqual(plan.handoffItems, []);
  assert.equal(plan.derivedOnly, false);
  assertCompleteClassificationState(survivors, plan.labels);
  assert.throws(() => assertClassificationHandoffSafe({
    items: [{ observationId: "1", commentText: "A" }],
    priorExactByObservationId: plan.priorExactByObservationId,
    priorCommentLabels: plan.priorCommentLabels,
  }), /CLASSIFICATION_WORKSET_CONTAINS_PREVIOUSLY_RESOLVED_ITEM/);
});

test("Source Dataset v2 binds cumulative identity and rejects missing or extra classification labels", () => {
  const survivors = [
    { observationId: "1", username: "u1", handle: "h1", commentText: "A", postedAt: "t1", postedDate: "d1" },
    { observationId: "2", username: "u2", handle: "h2", commentText: "B", postedAt: "t2", postedDate: "d2" },
  ];
  const source = buildCumulativeSourceDataset({
    corpusVersionId: "corpus-v2",
    classificationVersionId: "classification-v2",
    snapshotRefs: [{ payloadSha256: "a".repeat(64), snapshotIndex: 0 }, { payloadSha256: "b".repeat(64), snapshotIndex: 0 }],
    survivors,
    labelRows: [{ observationId: "1", label: "normal" }, { observationId: "2", label: "reactive" }],
  });
  assert.equal(source.schema_version, 2);
  assert.deepEqual(source.source.snapshot_refs.map((ref) => ref.payload_sha256), ["a".repeat(64), "b".repeat(64)]);
  assert.deepEqual(source.records.map((record) => record.source_index), [0, 1]);
  validateSourceDatasetV2(source);
  assert.ok(serializeCumulativeSourceDataset(source).includes(Buffer.from('"schema_version": 2')));
  assert.throws(() => buildCumulativeSourceDataset({
    corpusVersionId: "corpus-v2",
    classificationVersionId: "classification-v2",
    snapshotRefs: [{ payloadSha256: "a".repeat(64), snapshotIndex: 0 }],
    survivors,
    labelRows: [{ observationId: "1", label: "normal" }],
  }), /SOURCE_DATASET_CLASSIFICATION_COVERAGE_MISMATCH/);
});

test("Corpus v3 persists ordered v2 refs, deduplicates reinsertion, and rejects populated v1 heads", async () => {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  const policyStream = controlPlane.ensureStream(STREAM_KEYS.corpusPolicy);
  controlPlane.createGenesis({ streamId: policyStream.stream_id, versionId: "corpus-policy", payload: { schema_version: 1, state: { auto_commit: true } } });
  const corpusStream = controlPlane.ensureStream(STREAM_KEYS.corpus);
  controlPlane.createGenesis({
    streamId: corpusStream.stream_id,
    versionId: "corpus-v2",
    payload: { schema_version: 1, state: { schema_version: 2, snapshot_refs: [ref("a")] } },
  });
  const service = new CorpusApplicationServiceV3(controlPlane);
  const contextFor = (operationId) => createV3OperationContext({
    sessionId: operationId,
    stepId: "02-update-corpus",
    actor: { actorId: "system", actorType: "system" },
    permissions: ["state:read", "state:propose", "state:auto-decide", "state:commit"],
  });
  try {
    const updated = service.update(contextFor("corpus-cumulative"), {
      initialCorpusVersionId: "corpus-v2",
      corpusPolicyVersionId: "corpus-policy",
      snapshotRefs: [ref("b"), ref("a")],
    });
    assert.equal(updated.stateResult, "committed");
    assert.deepEqual(controlPlane.readVersion(updated.refs.corpusVersionId).payload.state.snapshot_refs, [ref("a"), ref("b")]);
    const noOp = service.update(contextFor("corpus-no-op"), {
      initialCorpusVersionId: updated.refs.corpusVersionId,
      corpusPolicyVersionId: "corpus-policy",
      snapshotRefs: [ref("a"), ref("b")],
    });
    assert.equal(noOp.stateResult, "unchanged");

    const v1Db = await openCommentDatabase(":memory:", { stateControlPlane: true });
    const v1ControlPlane = new StateControlPlane(v1Db);
    const v1Stream = v1ControlPlane.ensureStream(STREAM_KEYS.corpus);
    const v1PolicyStream = v1ControlPlane.ensureStream(STREAM_KEYS.corpusPolicy);
    v1ControlPlane.createGenesis({ streamId: v1PolicyStream.stream_id, versionId: "corpus-policy-v1", payload: { schema_version: 1, state: { auto_commit: true } } });
    v1ControlPlane.createGenesis({
      streamId: v1Stream.stream_id,
      versionId: "corpus-v1",
      payload: { schema_version: 1, state: { schema_version: 1, snapshot_refs: [ref("a")] } },
    });
    assert.throws(() => assertV3CorpusPreflight(v1ControlPlane), /CORPUS_BOOTSTRAP_REQUIRED/);
    assert.throws(() => new CorpusApplicationServiceV3(v1ControlPlane).update(contextFor("corpus-v1-reject"), {
      initialCorpusVersionId: "corpus-v1",
      corpusPolicyVersionId: "corpus-policy-v1",
      snapshotRefs: [ref("b")],
    }), /CORPUS_BOOTSTRAP_REQUIRED/);
    v1Db.close();
  } finally {
    db.close();
  }
});

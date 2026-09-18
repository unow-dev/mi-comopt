import assert from "node:assert/strict";
import test from "node:test";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { assertLegacyCurrentMarkerReaderAllowed, assertLegacyWriterAllowed } from "../src/migration/legacy-boundary.js";
import {
  advancePersistedV3Cutover,
  assertV2StartAllowed,
  assertV3StartAllowed,
  initializeV3Cutover,
  listV3CutoverEvents,
  readV3CutoverControl,
  resolveCommentDataUpdateRevision,
} from "../src/migration/v3-cutover.js";

const TARGET_HASH = "9598f503ba9a8e8753e0b1d9d1e4af2f1a80a4d10b718aba5ab250840438a726";

async function fixture() {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  return { db, controlPlane: new StateControlPlane(db) };
}

function initialize(controlPlane, operationId = "cutover-init") {
  return initializeV3Cutover(controlPlane, {
    targetRevision: 3,
    targetDefinitionHash: TARGET_HASH,
    mandatoryVerificationPassed: true,
    providerCompatible: true,
    v2HashesUnchanged: true,
    v2Hashes: { commentDataUpdate: "77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1" },
    evidence: { candidateCommit: "candidate", providerCommit: "provider" },
    operationId,
  });
}

function smokeEvidence() {
  return {
    smokeSessionId: "smoke-v3-001",
    authoritativeStateVerified: true,
    reviewedReleaseVerified: true,
    promotionVerified: true,
    deploymentVerified: true,
    evidenceLedgerWritten: true,
  };
}

test("[V3-CUT01][V3-CUT02][V3-CUT03][V3-CUT04] persistent cutover control enforces the ordered no-overlap sequence and pins normal starts", async () => {
  const { db, controlPlane } = await fixture();
  try {
    assert.equal(resolveCommentDataUpdateRevision(controlPlane), 2);
    initialize(controlPlane);
    assert.equal(readV3CutoverControl(controlPlane).state, "v2_open");

    const frozen = advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 }, { operationId: "cutover-freeze" });
    assert.equal(frozen.state, "v2_frozen");
    assert.throws(() => assertV2StartAllowed(controlPlane, 2), /V2_START_FROZEN/);
    const drained = advancePersistedV3Cutover(controlPlane, "drain_complete", { nonterminalV2Sessions: 0 }, { operationId: "cutover-drain" });
    assert.equal(drained.state, "v2_drained");
    assert.throws(() => advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 }), /CUTOVER_ORDER_INVALID/);
    assert.throws(() => advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: true }), /CUTOVER_GATE_FAILED/);
    advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: false }, { operationId: "cutover-disable-legacy" });
    const enabled = advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 }, { operationId: "cutover-enable-v3" });
    assert.equal(enabled.state, "v3_enabled");
    assert.equal(resolveCommentDataUpdateRevision(controlPlane), 3);
    assert.equal(assertV3StartAllowed(controlPlane, 3), true);
    assert.throws(() => assertLegacyWriterAllowed(controlPlane.db, { domain: "classification", streamKey: "comments" }), /LEGACY_WRITER_RETIRED/);
    assert.throws(() => assertLegacyCurrentMarkerReaderAllowed(controlPlane.db, { domain: "classification", streamKey: "comments" }), /LEGACY_READER_RETIRED/);
    assert.throws(() => assertV3StartAllowed(controlPlane, 2), /CUTOVER_REVISION_MISMATCH/);
    assert.throws(() => assertV2StartAllowed(controlPlane, 2), /V2_START_FROZEN/);

    const smoke = advancePersistedV3Cutover(controlPlane, "smoke_passed", smokeEvidence(), { operationId: "cutover-smoke" });
    assert.equal(smoke.state, "smoke_verified");
    assert.equal(smoke.v3StartsEnabled, true);
    const events = listV3CutoverEvents(controlPlane);
    assert.deepEqual(events.map((event) => `${event.fromState}->${event.toState}`), [
      "v2_open->v2_frozen",
      "v2_frozen->v2_drained",
      "v2_drained->legacy_disabled",
      "legacy_disabled->v3_enabled",
      "v3_enabled->smoke_verified",
    ]);
  } finally {
    db.close();
  }
});

test("cutover initialization fails closed when mandatory evidence is not complete", async () => {
  const { db, controlPlane } = await fixture();
  try {
    assert.throws(() => initializeV3Cutover(controlPlane, {
      targetRevision: 3,
      targetDefinitionHash: TARGET_HASH,
      mandatoryVerificationPassed: false,
      providerCompatible: true,
      v2HashesUnchanged: true,
    }), /CUTOVER_PRECONDITION_FAILED/);
    assert.equal(readV3CutoverControl(controlPlane), null);
  } finally {
    db.close();
  }
});

test("[V3-CUT05][V3-CUT07] smoke failure freezes v3 and remains fix-forward only", async () => {
  const { db, controlPlane } = await fixture();
  try {
    initialize(controlPlane, "cutover-init-failure");
    advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "drain_complete", { nonterminalV2Sessions: 0 });
    advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: false });
    advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 });
    const frozen = advancePersistedV3Cutover(controlPlane, "smoke_failed", { failureRef: "smoke://failed" });
    assert.equal(frozen.state, "v3_frozen");
    assert.equal(frozen.v3StartsEnabled, false);
    assert.throws(() => resolveCommentDataUpdateRevision(controlPlane), /CUTOVER_START_FROZEN/);
    assert.throws(() => advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 }), /CUTOVER_ORDER_INVALID/);
    const resumed = advancePersistedV3Cutover(controlPlane, "fix_forward_v3", { legacyWriterEnabled: false, newV2Starts: 0, fixForwardRef: "fix://classification-finalize" });
    assert.equal(resumed.state, "v3_enabled");
    assert.equal(resumed.legacyWriterEnabled, false);
    assert.equal(resumed.v2StartsEnabled, false);
    assert.equal(resumed.v3StartsEnabled, true);
  } finally {
    db.close();
  }
});

test("cutover transition is idempotent by operation and event receipt", async () => {
  const { db, controlPlane } = await fixture();
  try {
    initialize(controlPlane, "cutover-init-idempotent");
    const first = advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 }, { operationId: "cutover-freeze-idempotent", eventId: "cutover-event-idempotent" });
    const second = advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 }, { operationId: "cutover-freeze-idempotent", eventId: "cutover-event-idempotent" });
    assert.deepEqual(second, first);
    assert.equal(listV3CutoverEvents(controlPlane).length, 1);
  } finally {
    db.close();
  }
});

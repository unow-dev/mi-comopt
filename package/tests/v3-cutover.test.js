import assert from "node:assert/strict";
import test from "node:test";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { ensureStateControlPlane } from "../src/state/schema.js";
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

test("planned recovery has a dedicated freeze state and only verified completion can release it", async () => {
  const { db, controlPlane } = await fixture();
  try {
    initialize(controlPlane, "cutover-recovery-init");
    advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "drain_complete", { nonterminalV2Sessions: 0 });
    advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: false });
    advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "smoke_passed", smokeEvidence());

    const frozen = advancePersistedV3Cutover(controlPlane, "recovery_freeze", { newV3Starts: 0 }, { operationId: "cutover-recovery-freeze" });
    assert.equal(frozen.state, "recovery_frozen");
    assert.equal(frozen.v3StartsEnabled, false);
    assert.throws(() => advancePersistedV3Cutover(controlPlane, "fix_forward_v3", { legacyWriterEnabled: false, newV2Starts: 0, fixForwardRef: "fix://forbidden" }), /CUTOVER_ORDER_INVALID/);
    assert.throws(() => advancePersistedV3Cutover(controlPlane, "recovery_completed", { verificationPassed: false, recoveryId: "recovery-1", verificationReceiptOperationId: "recovery:recovery-1:verify" }), /RECOVERY_VERIFICATION_REQUIRED/);

    const completed = advancePersistedV3Cutover(controlPlane, "recovery_completed", {
      recoveryId: "recovery-1",
      verificationPassed: true,
      verificationReceiptOperationId: "recovery:recovery-1:verify",
    }, { operationId: "cutover-recovery-complete" });
    assert.equal(completed.state, "smoke_verified");
    assert.equal(completed.v3StartsEnabled, true);
  } finally {
    db.close();
  }
});

test("recovery cancellation is allowed only before a mutating stage", async () => {
  const { db, controlPlane } = await fixture();
  try {
    initialize(controlPlane, "cutover-recovery-cancel-init");
    advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "drain_complete", { nonterminalV2Sessions: 0 });
    advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: false });
    advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: 0 });
    advancePersistedV3Cutover(controlPlane, "smoke_passed", smokeEvidence());
    advancePersistedV3Cutover(controlPlane, "recovery_freeze", { newV3Starts: 0 });
    const cancelled = advancePersistedV3Cutover(controlPlane, "recovery_cancelled", { mutatingRecoveryStageCompleted: false, actorId: "operator" });
    assert.equal(cancelled.state, "smoke_verified");
    assert.throws(() => advancePersistedV3Cutover(controlPlane, "recovery_completed", { verificationPassed: true, recoveryId: "recovery-2", verificationReceiptOperationId: "recovery:recovery-2:verify" }), /CUTOVER_ORDER_INVALID/);
  } finally {
    db.close();
  }
});

test("existing v3 cutover tables are upgraded to permit recovery_frozen without losing receipts", async () => {
  const { db } = await fixture();
  try {
    db.exec("DROP TABLE v3_cutover_events");
    db.exec("DROP TABLE v3_cutover_control");
    db.exec(`
      CREATE TABLE v3_cutover_control (
        control_id TEXT PRIMARY KEY CHECK (control_id = 'comment-data-update'),
        state TEXT NOT NULL CHECK (state IN ('v2_open', 'v2_frozen', 'v2_drained', 'legacy_disabled', 'v3_enabled', 'smoke_verified', 'v3_frozen')),
        target_revision INTEGER NOT NULL CHECK (target_revision >= 3),
        target_definition_hash TEXT NOT NULL,
        provider_compatible INTEGER NOT NULL CHECK (provider_compatible IN (0, 1)),
        mandatory_verification_passed INTEGER NOT NULL CHECK (mandatory_verification_passed IN (0, 1)),
        v2_hashes_unchanged INTEGER NOT NULL CHECK (v2_hashes_unchanged IN (0, 1)),
        v2_hashes_json TEXT NOT NULL,
        legacy_writer_enabled INTEGER NOT NULL CHECK (legacy_writer_enabled IN (0, 1)),
        v2_starts_enabled INTEGER NOT NULL CHECK (v2_starts_enabled IN (0, 1)),
        v3_starts_enabled INTEGER NOT NULL CHECK (v3_starts_enabled IN (0, 1)),
        evidence_json TEXT NOT NULL,
        last_event_id TEXT,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE v3_cutover_events (
        event_id TEXT PRIMARY KEY,
        control_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        event_name TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (control_id) REFERENCES v3_cutover_control(control_id)
      )
    `);
    db.prepare(`INSERT INTO v3_cutover_control
      (control_id, state, target_revision, target_definition_hash, provider_compatible,
       mandatory_verification_passed, v2_hashes_unchanged, v2_hashes_json,
       legacy_writer_enabled, v2_starts_enabled, v3_starts_enabled, evidence_json,
       last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("comment-data-update", "smoke_verified", 3, TARGET_HASH, 1, 1, 1, "{}", 0, 0, 1, "{}", "event-existing", "2026-09-22T00:00:00.000Z");
    db.prepare(`INSERT INTO v3_cutover_events
      (event_id, control_id, from_state, to_state, event_name, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("event-existing", "comment-data-update", "v3_enabled", "smoke_verified", "smoke_passed", "{}", "2026-09-22T00:00:00.000Z");

    ensureStateControlPlane(db);
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'v3_cutover_control'").get().sql;
    assert.match(sql, /recovery_frozen/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM v3_cutover_events").get().count, 1);
    const controlPlane = new StateControlPlane(db);
    const frozen = advancePersistedV3Cutover(controlPlane, "recovery_freeze", { newV3Starts: 0 });
    assert.equal(frozen.state, "recovery_frozen");
  } finally {
    db.close();
  }
});

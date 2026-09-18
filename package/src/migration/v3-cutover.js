import { canonicalJson, deterministicId, semanticSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

export const V3_CUTOVER_CONTROL_ID = "comment-data-update";
export const V3_CUTOVER_STATES = Object.freeze(["v2_open", "v2_frozen", "v2_drained", "legacy_disabled", "v3_enabled", "smoke_verified", "v3_frozen"]);
const V3_START_STATES = new Set(["v3_enabled", "smoke_verified"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SMOKE_EVIDENCE_KEYS = Object.freeze([
  "authoritativeStateVerified",
  "reviewedReleaseVerified",
  "promotionVerified",
  "deploymentVerified",
  "evidenceLedgerWritten",
]);

function requireControlPlane(controlPlane) {
  if (!controlPlane?.db || typeof controlPlane.db.prepare !== "function") throw stateError("CONFIGURATION_ERROR", "a StateControlPlane is required");
  return controlPlane;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw stateError("VALIDATION_ERROR", `${name} is required`);
  return value;
}

function readJson(value, name) {
  try { return JSON.parse(value); } catch (error) { throw stateError("DATABASE_INTEGRITY_ERROR", `${name} is invalid JSON: ${error.message}`); }
}

function bool(value) { return Number(value) === 1; }

function controlRow(controlPlane) {
  return requireControlPlane(controlPlane).db.prepare("SELECT * FROM v3_cutover_control WHERE control_id = ?").get(V3_CUTOVER_CONTROL_ID) ?? null;
}

function controlFromRow(row) {
  if (!row) return null;
  return {
    controlId: row.control_id,
    state: row.state,
    targetRevision: Number(row.target_revision),
    targetDefinitionHash: row.target_definition_hash,
    providerCompatible: bool(row.provider_compatible),
    mandatoryVerificationPassed: bool(row.mandatory_verification_passed),
    v2HashesUnchanged: bool(row.v2_hashes_unchanged),
    v2Hashes: readJson(row.v2_hashes_json, "v3_cutover_control.v2_hashes_json"),
    legacyWriterEnabled: bool(row.legacy_writer_enabled),
    v2StartsEnabled: bool(row.v2_starts_enabled),
    v3StartsEnabled: bool(row.v3_starts_enabled),
    evidence: readJson(row.evidence_json, "v3_cutover_control.evidence_json"),
    lastEventId: row.last_event_id,
    updatedAt: row.updated_at,
  };
}

export function readV3CutoverControl(controlPlane) {
  return controlFromRow(controlRow(controlPlane));
}

export function assertV3CutoverPreconditions({ mandatoryVerificationPassed, providerCompatible, v2HashesUnchanged, targetRevision } = {}) {
  if (mandatoryVerificationPassed !== true || providerCompatible !== true || v2HashesUnchanged !== true || !Number.isSafeInteger(targetRevision) || targetRevision < 3) throw stateError("CUTOVER_PRECONDITION_FAILED", "mandatory v3 verification, provider compatibility, frozen v2 hashes, and target revision are required");
  return true;
}

export function advanceV3Cutover(state, event, evidence = {}) {
  const current = state ?? "v2_open";
  if (!V3_CUTOVER_STATES.includes(current)) throw stateError("CUTOVER_STATE_INVALID", `unknown cutover state ${current}`);
  const transitions = {
    v2_open: { freeze_v2: "v2_frozen" },
    v2_frozen: { drain_complete: "v2_drained" },
    v2_drained: { legacy_disabled: "legacy_disabled" },
    legacy_disabled: { enable_v3: "v3_enabled" },
    v3_enabled: { smoke_passed: "smoke_verified", smoke_failed: "v3_frozen" },
    smoke_verified: { smoke_failed: "v3_frozen" },
    v3_frozen: {},
  };
  const next = transitions[current][event];
  if (!next) throw stateError("CUTOVER_ORDER_INVALID", `${event} cannot advance cutover from ${current}`);
  if (event === "freeze_v2" && evidence.newV2Starts !== 0) throw stateError("CUTOVER_GATE_FAILED", "v2 starts must be frozen before drain");
  if (event === "drain_complete" && evidence.nonterminalV2Sessions !== 0) throw stateError("CUTOVER_GATE_FAILED", "nonterminal v2 sessions must be zero");
  if (event === "enable_v3" && evidence.legacyWriterEnabled === true) throw stateError("CUTOVER_DUAL_AUTHORITY", "legacy authority must be disabled before v3 enablement");
  if (event === "smoke_failed") return { state: next, newV3StartsFrozen: true, legacyWriterEnabled: false, fixForwardOnly: true };
  return { state: next, newV3StartsFrozen: next === "v2_frozen" || next === "v3_frozen", legacyWriterEnabled: next !== "legacy_disabled" && next !== "v3_enabled" && next !== "smoke_verified", fixForwardOnly: true };
}

function assertPersistentEventEvidence(event, evidence) {
  if (event === "legacy_disabled" && evidence.legacyWriterEnabled !== false) throw stateError("CUTOVER_GATE_FAILED", "legacy authority must be explicitly disabled before v3 enablement");
  if (event === "enable_v3" && (evidence.legacyWriterEnabled !== false || evidence.newV2Starts !== 0)) throw stateError("CUTOVER_DUAL_AUTHORITY", "v3 enablement requires disabled legacy authority and zero new v2 starts");
  if (event === "smoke_passed") {
    const missing = SMOKE_EVIDENCE_KEYS.filter((key) => evidence[key] !== true);
    if (missing.length > 0) throw stateError("CUTOVER_GATE_FAILED", `controlled smoke evidence is incomplete: ${missing.join(", ")}`);
    requiredString(evidence.smokeSessionId, "smokeSessionId");
  }
  if (event === "smoke_failed") requiredString(evidence.failureRef, "failureRef");
}

function assertTargetMetadata({ targetRevision, targetDefinitionHash }) {
  if (!Number.isSafeInteger(targetRevision) || targetRevision < 3) throw stateError("VALIDATION_ERROR", "targetRevision must be an integer >= 3");
  if (!SHA256_PATTERN.test(targetDefinitionHash)) throw stateError("VALIDATION_ERROR", "targetDefinitionHash must be a lowercase SHA-256 hash");
}

export function initializeV3Cutover(controlPlane, {
  targetRevision,
  targetDefinitionHash,
  mandatoryVerificationPassed,
  providerCompatible,
  v2HashesUnchanged,
  v2Hashes = {},
  evidence = {},
  operationId = deterministicId("v3-cutover-init", `${targetRevision}:${targetDefinitionHash}`),
} = {}) {
  requireControlPlane(controlPlane);
  assertTargetMetadata({ targetRevision, targetDefinitionHash });
  assertV3CutoverPreconditions({ mandatoryVerificationPassed, providerCompatible, v2HashesUnchanged, targetRevision });
  if (!v2Hashes || typeof v2Hashes !== "object" || Array.isArray(v2Hashes)) throw stateError("VALIDATION_ERROR", "v2Hashes must be an object");
  const request = { targetRevision, targetDefinitionHash, mandatoryVerificationPassed, providerCompatible, v2HashesUnchanged, v2Hashes, evidence };
  return controlPlane.runIdempotent({ operationId, operationKind: "v3.cutover.initialize", request }, (db) => {
    const existing = db.prepare("SELECT * FROM v3_cutover_control WHERE control_id = ?").get(V3_CUTOVER_CONTROL_ID);
    if (existing) {
      const current = controlFromRow(existing);
      if (semanticSha256({ targetRevision: current.targetRevision, targetDefinitionHash: current.targetDefinitionHash, mandatoryVerificationPassed: current.mandatoryVerificationPassed, providerCompatible: current.providerCompatible, v2HashesUnchanged: current.v2HashesUnchanged, v2Hashes: current.v2Hashes }) !== semanticSha256({ targetRevision, targetDefinitionHash, mandatoryVerificationPassed, providerCompatible, v2HashesUnchanged, v2Hashes })) throw stateError("CUTOVER_METADATA_CONFLICT", "v3 cutover control was initialized with different immutable metadata");
      return current;
    }
    const now = controlPlane.now();
    db.prepare(
      `INSERT INTO v3_cutover_control
        (control_id, state, target_revision, target_definition_hash, provider_compatible,
         mandatory_verification_passed, v2_hashes_unchanged, v2_hashes_json,
         legacy_writer_enabled, v2_starts_enabled, v3_starts_enabled, evidence_json,
         last_event_id, updated_at)
       VALUES (?, 'v2_open', ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, NULL, ?)`,
    ).run(V3_CUTOVER_CONTROL_ID, targetRevision, targetDefinitionHash, providerCompatible ? 1 : 0, mandatoryVerificationPassed ? 1 : 0, v2HashesUnchanged ? 1 : 0, canonicalJson(v2Hashes), canonicalJson(evidence), now);
    return controlFromRow(db.prepare("SELECT * FROM v3_cutover_control WHERE control_id = ?").get(V3_CUTOVER_CONTROL_ID));
  });
}

export function advancePersistedV3Cutover(controlPlane, event, evidence = {}, { operationId = undefined, eventId = undefined } = {}) {
  requireControlPlane(controlPlane);
  requiredString(event, "event");
  assertPersistentEventEvidence(event, evidence);
  const current = readV3CutoverControl(controlPlane);
  if (!current) throw stateError("CUTOVER_NOT_INITIALIZED", "v3 cutover control must be initialized before advancing");
  const resolvedEventId = eventId ?? deterministicId("v3-cutover-event", `${current.state}:${event}:${semanticSha256(evidence)}`);
  const resolvedOperationId = operationId ?? `v3-cutover:${resolvedEventId}`;
  const request = { event, eventId: resolvedEventId, evidence };
  return controlPlane.runIdempotent({ operationId: resolvedOperationId, operationKind: "v3.cutover.advance", request }, (db) => {
    const row = db.prepare("SELECT * FROM v3_cutover_control WHERE control_id = ?").get(V3_CUTOVER_CONTROL_ID);
    const before = controlFromRow(row);
    if (!before) throw stateError("CUTOVER_NOT_INITIALIZED", "v3 cutover control must be initialized before advancing");
    const transition = advanceV3Cutover(before.state, event, evidence);
    const existingEvent = db.prepare("SELECT * FROM v3_cutover_events WHERE event_id = ?").get(resolvedEventId);
    if (existingEvent) {
      if (existingEvent.from_state !== before.state || existingEvent.to_state !== transition.state || existingEvent.event_name !== event || existingEvent.evidence_json !== canonicalJson(evidence)) throw stateError("CUTOVER_EVENT_CONFLICT", `cutover event ${resolvedEventId} has different content`);
      return { ...before, eventId: resolvedEventId };
    }
    const now = controlPlane.now();
    db.prepare("INSERT INTO v3_cutover_events (event_id, control_id, from_state, to_state, event_name, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(resolvedEventId, V3_CUTOVER_CONTROL_ID, before.state, transition.state, event, canonicalJson(evidence), now);
    const combinedEvidence = { ...before.evidence, [event]: evidence };
    db.prepare(
      `UPDATE v3_cutover_control
          SET state = ?, legacy_writer_enabled = ?, v2_starts_enabled = ?, v3_starts_enabled = ?,
              evidence_json = ?, last_event_id = ?, updated_at = ?
        WHERE control_id = ?`,
    ).run(transition.state, transition.legacyWriterEnabled ? 1 : 0, transition.state === "v2_open" ? 1 : 0, V3_START_STATES.has(transition.state) ? 1 : 0, canonicalJson(combinedEvidence), resolvedEventId, now, V3_CUTOVER_CONTROL_ID);
    return { ...controlFromRow(db.prepare("SELECT * FROM v3_cutover_control WHERE control_id = ?").get(V3_CUTOVER_CONTROL_ID)), eventId: resolvedEventId };
  });
}

export function listV3CutoverEvents(controlPlane) {
  requireControlPlane(controlPlane);
  return controlPlane.db.prepare("SELECT event_id AS eventId, control_id AS controlId, from_state AS fromState, to_state AS toState, event_name AS eventName, evidence_json AS evidenceJson, created_at AS createdAt FROM v3_cutover_events WHERE control_id = ? ORDER BY rowid").all(V3_CUTOVER_CONTROL_ID).map((row) => ({ ...row, evidence: readJson(row.evidenceJson, "v3_cutover_events.evidence_json") }));
}

export function assertV3StartAllowed(controlPlane, revision) {
  const control = readV3CutoverControl(controlPlane);
  if (!control) return true;
  if (!V3_START_STATES.has(control.state) || !control.v3StartsEnabled) throw stateError("V3_START_FROZEN", `v3 starts are not enabled in cutover state ${control.state}`);
  if (revision !== control.targetRevision) throw stateError("CUTOVER_REVISION_MISMATCH", `requested revision ${revision} does not match cutover target ${control.targetRevision}`);
  return true;
}

export function assertV2StartAllowed(controlPlane, revision = 2) {
  const control = readV3CutoverControl(controlPlane);
  if (!control) return true;
  if (!control.v2StartsEnabled || control.state !== "v2_open") throw stateError("V2_START_FROZEN", `v2 starts are frozen in cutover state ${control.state}`);
  if (revision !== 2) throw stateError("CUTOVER_REVISION_MISMATCH", `requested v2 revision ${revision} is not supported`);
  return true;
}

export function resolveCommentDataUpdateRevision(controlPlane, { requestedRevision = undefined } = {}) {
  const control = readV3CutoverControl(controlPlane);
  if (!control) return requestedRevision ?? 2;
  if (control.state === "v2_open") {
    assertV2StartAllowed(controlPlane, requestedRevision ?? 2);
    return 2;
  }
  if (V3_START_STATES.has(control.state)) {
    assertV3StartAllowed(controlPlane, requestedRevision ?? control.targetRevision);
    return control.targetRevision;
  }
  throw stateError("CUTOVER_START_FROZEN", `normal starts are frozen in cutover state ${control.state}`);
}

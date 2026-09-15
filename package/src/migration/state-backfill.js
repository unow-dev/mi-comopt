import { canonicalJson, deterministicId, semanticSha256 } from "../state/canonical.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { STREAM_KEYS, normalizeLabels, normalizeKeywordEntries } from "../application/services.js";

function stream(controlPlane, key) { return controlPlane.ensureStream(STREAM_KEYS[key]); }

export const MIGRATION_STATUSES = Object.freeze(["backfilled", "verified", "cutover", "legacy_read_compatibility", "retired"]);

const MIGRATION_STATUS_INDEX = new Map(MIGRATION_STATUSES.map((status, index) => [status, index]));
const CUTOVER_GATE_KEYS = Object.freeze([
  "semanticEquivalenceVerified",
  "commitPathExclusive",
  "legacyWriterDisabled",
  "legacyOutputRegenerable",
  "legacyCurrentMarkerNotAuthoritative",
  "rollbackNoDualAuthority",
]);

function readCutoverRow(controlPlane, streamId) {
  const row = controlPlane.db.prepare("SELECT * FROM state_cutovers WHERE stream_id = ?").get(streamId);
  if (!row) return null;
  let notes;
  try { notes = JSON.parse(row.notes_json); } catch (error) { throw stateError("DATABASE_INTEGRITY_ERROR", `cutover notes for ${streamId} are invalid JSON: ${error.message}`); }
  return { streamId: row.stream_id, status: row.status, legacyWriterEnabled: Boolean(row.legacy_writer_enabled), recordedAt: row.recorded_at, notes };
}

function assertMigrationStatus(status) {
  if (!MIGRATION_STATUS_INDEX.has(status)) throw stateError("MIGRATION_STATUS_INVALID", `unsupported migration status: ${status}`);
}

function assertCutoverGates({ status, legacyWriterEnabled, notes }) {
  if (status === "backfilled") return;
  if (status === "verified" && notes?.semanticEquivalenceVerified !== true) throw stateError("MIGRATION_GATE_FAILED", "verified requires semanticEquivalenceVerified=true");
  if (status !== "cutover") {
    if (status === "legacy_read_compatibility" || status === "retired") {
      if (legacyWriterEnabled) throw stateError("MIGRATION_GATE_FAILED", `${status} requires legacyWriterEnabled=false`);
    }
    return;
  }
  if (legacyWriterEnabled) throw stateError("MIGRATION_GATE_FAILED", "cutover requires legacyWriterEnabled=false");
  const gates = notes?.gates ?? notes;
  const missing = CUTOVER_GATE_KEYS.filter((key) => gates?.[key] !== true);
  if (missing.length > 0) throw stateError("MIGRATION_GATE_FAILED", `cutover gates are incomplete: ${missing.join(", ")}`);
}

function persistClassification({ db, versionId, payload }) {
  const state = normalizeLabels(payload);
  db.prepare("INSERT INTO classification_states (version_id, state_json) VALUES (?, ?)").run(versionId, canonicalJson(state));
  const insert = db.prepare("INSERT INTO classification_state_labels (version_id, observation_id, label) VALUES (?, ?, ?)");
  for (const item of state.labels) insert.run(versionId, item.observationId, item.label);
}

function persistKeywordSelection({ db, versionId, payload }) {
  const state = normalizeKeywordEntries(payload);
  db.prepare("INSERT INTO keyword_selection_states (version_id, state_json) VALUES (?, ?)").run(versionId, canonicalJson(state));
  const insert = db.prepare("INSERT INTO keyword_selection_entries (version_id, keyword, selection_state, entry_json) VALUES (?, ?, ?, ?)");
  for (const item of state.entries) insert.run(versionId, item.keyword, item.selection_state, canonicalJson(item));
}

export function backfillClassificationGenesis(controlPlane, { labels, corpusVersionId = undefined, policyVersionId = undefined, legacyRef = undefined, versionId = undefined, operationId = deterministicId("migration", "classification-genesis") } = {}) {
  const state = normalizeLabels({ schema_version: 1, labels });
  const target = stream(controlPlane, "classification");
  const result = controlPlane.createGenesis({
    streamId: target.stream_id,
    versionId: versionId ?? deterministicId("classification", semanticSha256(state)),
    payload: { schema_version: 1, state, migration: { legacyRef: legacyRef ?? null, unverifiableHistory: true } },
    dependencies: [corpusVersionId ? { role: "corpus", versionId: corpusVersionId } : null, policyVersionId ? { role: "policy", versionId: policyVersionId } : null].filter(Boolean),
    operationId,
    domainHandler: { persist: ({ db, versionId: id, payload }) => persistClassification({ db, versionId: id, payload: payload.state }) },
  });
  return { ...result, originKind: "genesis_migration", legacyRef: legacyRef ?? null };
}

export function backfillKeywordSelectionGenesis(controlPlane, { entries, corpusVersionId = undefined, classificationVersionId = undefined, policyVersionId = undefined, legacyRef = undefined, versionId = undefined, operationId = deterministicId("migration", "keyword-selection-genesis") } = {}) {
  const state = normalizeKeywordEntries({ schema_version: 1, entries });
  const target = stream(controlPlane, "keywordSelection");
  const result = controlPlane.createGenesis({
    streamId: target.stream_id,
    versionId: versionId ?? deterministicId("keyword-selection", semanticSha256(state)),
    payload: { schema_version: 1, state, migration: { legacyRef: legacyRef ?? null, unverifiableHistory: true } },
    dependencies: [corpusVersionId ? { role: "corpus", versionId: corpusVersionId } : null, classificationVersionId ? { role: "classification", versionId: classificationVersionId } : null, policyVersionId ? { role: "policy", versionId: policyVersionId } : null].filter(Boolean),
    operationId,
    domainHandler: { persist: ({ db, versionId: id, payload }) => persistKeywordSelection({ db, versionId: id, payload: payload.state }) },
  });
  return { ...result, originKind: "genesis_migration", legacyRef: legacyRef ?? null };
}

export function verifyGenesisSemanticEquivalence(controlPlane, versionId, expectedState) {
  const version = controlPlane.readVersion(versionId);
  if (!version) throw stateError("VERSION_NOT_FOUND", `version ${versionId} does not exist`);
  const actual = version.payload?.state ?? version.payload;
  return { equivalent: semanticSha256(actual) === semanticSha256(expectedState), expectedFingerprint: semanticSha256(expectedState), actualFingerprint: semanticSha256(actual), originKind: version.originKind };
}

export function assertLegacyWriterAllowed(controlPlane, streamId) {
  const row = readCutoverRow(controlPlane, streamId);
  if (row && !row.legacyWriterEnabled && ["cutover", "legacy_read_compatibility", "retired"].includes(row.status)) throw stateError("LEGACY_WRITER_RETIRED", `legacy authoritative writer is disabled for ${streamId}`);
  return true;
}

export function readCutover(controlPlane, streamId) {
  return readCutoverRow(controlPlane, streamId);
}

export function recordCutover(controlPlane, { streamId, status, legacyWriterEnabled = false, notes = {}, operationId = deterministicId("cutover", `${streamId}:${status}`) }) {
  assertMigrationStatus(status);
  const streamRecord = controlPlane.getStream(streamId);
  if (!streamRecord) throw stateError("STREAM_NOT_FOUND", `stream ${streamId} does not exist`);
  const previous = readCutoverRow(controlPlane, streamId);
  const previousIndex = previous ? MIGRATION_STATUS_INDEX.get(previous.status) : -1;
  const nextIndex = MIGRATION_STATUS_INDEX.get(status);
  if ((!previous && nextIndex !== 0) || (previous && nextIndex !== previousIndex + 1 && nextIndex !== previousIndex)) {
    throw stateError("MIGRATION_STATUS_ORDER", `migration status cannot advance from ${previous?.status ?? "not_started"} to ${status}`);
  }
  if (status === "backfilled" && !controlPlane.resolveHead(streamId)) throw stateError("MIGRATION_BACKFILL_REQUIRED", `stream ${streamId} must have a Genesis or committed head before backfilled`);
  assertCutoverGates({ status, legacyWriterEnabled, notes });
  return controlPlane.recordCutover({ streamId, status, legacyWriterEnabled, notes, operationId });
}

export function projectLegacyClassification(controlPlane, versionId) {
  const version = controlPlane.readVersion(versionId);
  if (!version || version.domain !== "classification") throw stateError("VERSION_NOT_FOUND", `classification version ${versionId} does not exist`);
  return (version.payload?.state?.labels ?? []).map((item) => ({ observation_id: item.observationId, label: item.label }));
}

export function projectLegacyKeywordSelection(controlPlane, versionId) {
  const version = controlPlane.readVersion(versionId);
  if (!version || version.domain !== "keyword-selection") throw stateError("VERSION_NOT_FOUND", `keyword selection version ${versionId} does not exist`);
  return version.payload?.state?.entries ?? [];
}

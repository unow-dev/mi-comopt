import { canonicalJson, deterministicId, semanticSha256 } from "../state/canonical.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { STREAM_KEYS, normalizeLabels, normalizeKeywordEntries } from "../application/services.js";

function stream(controlPlane, key) { return controlPlane.ensureStream(STREAM_KEYS[key]); }

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
  const row = controlPlane.db.prepare("SELECT * FROM state_cutovers WHERE stream_id = ?").get(streamId);
  if (row && Number(row.legacy_writer_enabled) === 0 && ["cutover", "legacy_read_compatibility", "retired"].includes(row.status)) throw stateError("LEGACY_WRITER_RETIRED", `legacy authoritative writer is disabled for ${streamId}`);
  return true;
}

export function recordCutover(controlPlane, { streamId, status, legacyWriterEnabled = false, notes = {}, operationId = deterministicId("cutover", `${streamId}:${status}`) }) {
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

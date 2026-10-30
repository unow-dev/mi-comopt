import { canonicalJson, cloneJson, semanticSha256 } from "../state/canonical.js";
import { stateError } from "../state/errors.js";

const LABELS = ["normal", "direct_nuisance", "reactive"];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (code, message) => { throw stateError(code, message); };

/** Corrections are an unordered set; text, string IDs, reasons and provenance
 * retain their exact bytes. Duplicate requests are rejected before hashing. */
export function canonicalBatchRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("BATCH_INPUT_INVALID", "batch request must be an object");
  const request = cloneJson(input);
  if (!Array.isArray(request.corrections) || !request.corrections.length) fail("BATCH_INPUT_INVALID", "corrections must be non-empty");
  const ids = new Set();
  for (const item of request.corrections) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("BATCH_INPUT_INVALID", "each correction must be an object");
    if (typeof item.targetObservationId !== "string" || !item.targetObservationId.length || item.targetObservationId.trim() !== item.targetObservationId) fail("BATCH_INPUT_INVALID", "targetObservationId must be an exact string ID");
    if (ids.has(item.targetObservationId)) fail("DUPLICATE_GROUP", "duplicate representative observation");
    ids.add(item.targetObservationId);
    if (!LABELS.includes(item.expectedLabel) || !LABELS.includes(item.replacementLabel)) fail("INVALID_LABEL", "unknown classification label");
    if (item.expectedLabel === item.replacementLabel) fail("UNCHANGED_CORRECTION", "replacement must differ from expected label");
    if (typeof item.reason !== "string" || !item.reason.trim()) fail("CORRECTION_REASON_REQUIRED", "reason must contain text");
  }
  request.corrections.sort((a, b) => compare(a.targetObservationId, b.targetObservationId));
  return request;
}

export function batchRequestFingerprint(input) { return semanticSha256(canonicalBatchRequest(input)); }

export function classificationSemanticHash(state) {
  return semanticSha256({ ...state, labels: state.labels.slice().sort((a, b) => (a.observationId.localeCompare(b.observationId) || compare(a.observationId, b.observationId))) });
}

export function correctionChangeSetHash({ changeSetHash, ...value }) { return semanticSha256(value); }

/** O(survivors + labels + affected observations), plus deterministic sorting.
 * No reads or writes, and never applies a partial correction. */
export function buildBatchCorrectionChangeSet({ request, survivors, baseLabels, schemaVersion = 1 }) {
  request = canonicalBatchRequest(request);
  if (!Array.isArray(survivors) || !Array.isArray(baseLabels) || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) fail("BATCH_INPUT_INVALID", "snapshot arrays and a valid schema version are required");
  const byId = new Map();
  const groups = new Map();
  for (const row of survivors) {
    const id = String(row.observationId);
    if (byId.has(id) || typeof row.commentText !== "string") fail("INVALID_SURVIVOR", "duplicate ID or invalid survivor text");
    byId.set(id, row.commentText);
    if (!groups.has(row.commentText)) groups.set(row.commentText, []);
    groups.get(row.commentText).push(id);
  }
  const labels = new Map();
  const beforeDistribution = Object.fromEntries(LABELS.map((label) => [label, 0]));
  for (const row of baseLabels) {
    const id = String(row.observationId);
    if (!byId.has(id) || labels.has(id) || !LABELS.includes(row.label)) fail("INCOMPLETE_CLASSIFICATION", "labels must exactly cover the pinned survivors");
    labels.set(id, row.label);
    beforeDistribution[row.label]++;
  }
  if (byId.size !== labels.size) fail("INCOMPLETE_CLASSIFICATION", "labels must exactly cover the pinned survivors");
  const touchedTexts = new Set();
  const resolvedGroups = [];
  const changes = [];
  for (const item of request.corrections) {
    if (!byId.has(item.targetObservationId)) fail("TARGET_NOT_FOUND", "representative is not a pinned survivor");
    const commentText = byId.get(item.targetObservationId);
    if (touchedTexts.has(commentText)) fail("DUPLICATE_GROUP", "the same exact-text group was specified twice");
    touchedTexts.add(commentText);
    const observationIds = groups.get(commentText).slice().sort(compare);
    for (const observationId of observationIds) {
      if (labels.get(observationId) !== item.expectedLabel) fail("EXPECTED_LABEL_MISMATCH", "every member of a group must match the expected label");
      changes.push({ observationId, before: item.expectedLabel, after: item.replacementLabel });
    }
    resolvedGroups.push({ ...item, commentText, observationIds, affectedObservationCount: observationIds.length,
      beforeDistribution: { [item.expectedLabel]: observationIds.length }, afterDistribution: { [item.replacementLabel]: observationIds.length } });
  }
  const afterDistribution = { ...beforeDistribution };
  for (const change of changes) {
    labels.set(change.observationId, change.after);
    afterDistribution[change.before]--;
    afterDistribution[change.after]++;
  }
  const state = { schema_version: schemaVersion, labels: [...labels].map(([observationId, label]) => ({ observationId, label })).sort((a, b) => (a.observationId.localeCompare(b.observationId) || compare(a.observationId, b.observationId))) };
  const value = { schemaVersion: 2, request, requestFingerprint: batchRequestFingerprint(request),
    groups: resolvedGroups, changes: changes.sort((a, b) => compare(a.observationId, b.observationId)),
    groupCount: resolvedGroups.length, observationCount: changes.length, totalObservationCount: labels.size,
    beforeDistribution, afterDistribution, proposedStateSemanticSha256: classificationSemanticHash(state), state };
  return { ...value, changeSetHash: correctionChangeSetHash(value) };
}

export function assertSameChangeSet(expected, actual) {
  if (correctionChangeSetHash(actual) !== actual.changeSetHash || canonicalJson(expected) !== canonicalJson(actual)) fail("BATCH_INTEGRITY_ERROR", "saved change set differs from the recomputed correction");
}

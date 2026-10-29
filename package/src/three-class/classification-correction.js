import { stateError } from "../state/errors.js";

const LABELS = new Set(["normal", "reactive", "direct_nuisance"]);

function fail(code, message, details = {}) {
  throw stateError(code, message, details);
}

function observationId(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_OBSERVATION_ID", "observationId must be a safe integer or non-empty string");
    return String(value);
  }
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail("INVALID_OBSERVATION_ID", "observationId must be a safe integer or non-empty, unpadded string");
  }
  return value;
}

function label(value, field) {
  if (!LABELS.has(value)) fail("INVALID_LABEL", `${field} must be a three-class label`);
  return value;
}

function ensureArray(value, field) {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${field} must be an array`);
  return value;
}

/**
 * Build a complete corrected Classification state without mutating its inputs.
 * Matching is JavaScript string equality over the pinned corpus survivor text.
 */
export function buildCorrectedClassificationState({ survivors, baseLabels, correction, schemaVersion = 1 } = {}) {
  if (!correction || typeof correction !== "object" || Array.isArray(correction)) fail("INVALID_INPUT", "correction is required");
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) fail("CLASSIFICATION_STATE_INVALID", "classification state schema version is invalid");
  const targetId = observationId(correction.observationId);
  const expectedLabel = label(correction.expectedLabel, "expectedLabel");
  const newLabel = label(correction.newLabel, "newLabel");
  if (expectedLabel === newLabel) fail("UNCHANGED_CORRECTION", "newLabel must differ from expectedLabel");
  if (correction.reason !== undefined && (typeof correction.reason !== "string" || correction.reason.trim().length === 0)) {
    fail("CORRECTION_REASON_REQUIRED", "reason must contain non-whitespace text");
  }

  const survivorTextById = new Map();
  for (const survivor of ensureArray(survivors, "survivors")) {
    if (!survivor || typeof survivor !== "object" || Array.isArray(survivor)) fail("INVALID_SURVIVOR", "survivor must be an object");
    const id = observationId(survivor.observationId ?? survivor.observation_id);
    if (typeof survivor.commentText !== "string") fail("INVALID_COMMENT_TEXT", "survivor commentText must be a string");
    if (survivorTextById.has(id)) fail("DUPLICATE_SURVIVOR", `duplicate survivor observation ${id}`);
    survivorTextById.set(id, survivor.commentText);
  }

  const labelById = new Map();
  for (const item of ensureArray(baseLabels, "baseLabels")) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("INVALID_BASE_LABEL", "base label must be an object");
    const id = observationId(item.observationId ?? item.observation_id);
    if (labelById.has(id)) fail("DUPLICATE_BASE_LABEL", `duplicate base label observation ${id}`);
    labelById.set(id, label(item.label, "base label"));
  }
  if (survivorTextById.size !== labelById.size || [...survivorTextById.keys()].some((id) => !labelById.has(id))) {
    fail("INCOMPLETE_CLASSIFICATION", "base labels must cover every survivor exactly once, with no extras");
  }
  if (!survivorTextById.has(targetId)) fail("TARGET_NOT_FOUND", "requested observation is not a pinned corpus survivor");
  if (labelById.get(targetId) !== expectedLabel) fail("EXPECTED_LABEL_MISMATCH", "target base label differs from expectedLabel");

  const targetText = survivorTextById.get(targetId);
  const previousCounts = new Map();
  let affectedObservationCount = 0;
  let changedObservationCount = 0;
  const labels = [];
  for (const [id, oldLabel] of labelById) {
    const inGroup = survivorTextById.get(id) === targetText;
    const nextLabel = inGroup ? newLabel : oldLabel;
    labels.push({ observationId: id, label: nextLabel });
    if (inGroup) {
      affectedObservationCount += 1;
      previousCounts.set(oldLabel, (previousCounts.get(oldLabel) ?? 0) + 1);
      if (oldLabel !== nextLabel) changedObservationCount += 1;
    }
  }
  if (changedObservationCount === 0) fail("UNCHANGED_CORRECTION", "correction does not change any observation");
  labels.sort((left, right) => left.observationId.localeCompare(right.observationId));
  const previousLabels = [...previousCounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([previousLabel, count]) => ({ label: previousLabel, count }));
  return {
    state: { schema_version: schemaVersion, labels },
    change: { commentText: targetText, affectedObservationCount, changedObservationCount, previousLabels, newLabel },
  };
}

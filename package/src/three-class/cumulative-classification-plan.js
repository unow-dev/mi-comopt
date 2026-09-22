import { worseThreeClassLabel } from "./label-resolution.js";

export const CUMULATIVE_CLASSIFICATION_ERROR = "CLASSIFICATION_WORKSET_CONTAINS_PREVIOUSLY_RESOLVED_ITEM";

function planError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function asObservationId(value) {
  return String(value?.observationId ?? value?.observation_id ?? value);
}

function addCommentLabel(map, commentText, label) {
  if (typeof commentText !== "string" || typeof label !== "string") return;
  map.set(commentText, worseThreeClassLabel(map.get(commentText), label));
}

function decisionFor(decisions, item, itemId) {
  if (!decisions || typeof decisions !== "object") return undefined;
  return decisions[itemId]
    ?? decisions[item.observationId]
    ?? decisions[item.commentText];
}

/**
 * Resolve a cumulative classification state without consulting legacy label
 * tables.  `priorLabels` must come from the single pinned ClassificationVersion.
 */
export function planCumulativeClassification({ survivors = [], priorLabels = [], humanDecisions = {}, decisions = humanDecisions } = {}) {
  if (!Array.isArray(survivors)) throw new TypeError("survivors must be an array");
  const exactByObservationId = new Map();
  const commentByObservationId = new Map();
  const commentLabels = new Map();
  for (const row of priorLabels ?? []) {
    const observationId = asObservationId(row);
    exactByObservationId.set(observationId, row.label);
    if (typeof row.commentText === "string") {
      commentByObservationId.set(observationId, row.commentText);
      addCommentLabel(commentLabels, row.commentText, row.label);
    }
  }

  const labels = [];
  const unresolved = [];
  const resolution = [];
  const seenSurvivors = new Set();
  const unresolvedByComment = new Map();
  for (const survivor of survivors) {
    const observationId = asObservationId(survivor);
    if (seenSurvivors.has(observationId)) throw planError("CLASSIFICATION_STATE_INVALID", `duplicate survivor observation ${observationId}`);
    seenSurvivors.add(observationId);
    const exactLabel = exactByObservationId.get(observationId);
    const inheritedLabel = exactLabel === undefined ? commentLabels.get(survivor.commentText) : undefined;
    const label = exactLabel ?? inheritedLabel;
    if (label === undefined) {
      let item = unresolvedByComment.get(survivor.commentText);
      if (!item) {
        item = { id: `I${unresolvedByComment.size + 1}`, observationId, commentText: survivor.commentText };
        unresolvedByComment.set(survivor.commentText, item);
        unresolved.push(item);
      }
      const humanLabel = item.humanLabel ?? decisionFor(decisions, survivor, item.id);
      if (humanLabel !== undefined) item.humanLabel = humanLabel;
      if (humanLabel !== undefined) {
        labels.push({ observationId, label: humanLabel });
        resolution.push({ observationId, resolved: true, label: humanLabel, resolutionSource: "human_decision" });
      } else {
        resolution.push({ observationId, resolved: false, resolutionSource: "unresolved" });
      }
    } else {
      labels.push({ observationId, label });
      resolution.push({
        observationId,
        resolved: true,
        label,
        resolutionSource: exactLabel !== undefined
          ? "exact_observation"
          : inheritedLabel !== undefined
            ? "existing_comment_text"
            : "human_decision",
      });
    }
  }

  // Human decisions are only accepted for items that were actually unresolved.
  // A caller that injects a previously resolved item into a workset therefore
  // fails closed before an artifact can be produced.
  const unresolvedAfterHuman = unresolved.filter((item) => item.humanLabel === undefined);
  const handoffItems = unresolvedAfterHuman.map(({ id, observationId, commentText }) => ({ id, observationId, commentText }));

  return {
    labels,
    unresolved: unresolvedAfterHuman,
    handoffItems,
    resolution,
    priorExactByObservationId: exactByObservationId,
    priorCommentLabels: commentLabels,
    humanDecisionCount: Object.keys(decisions ?? {}).length,
    derivedOnly: unresolved.length === 0 && Object.keys(decisions ?? {}).length === 0,
  };
}

export function assertClassificationHandoffSafe({ items = [], priorExactByObservationId = new Map(), priorCommentLabels = new Map() } = {}) {
  for (const item of items) {
    const observationId = asObservationId(item);
    if (priorExactByObservationId.has(observationId)) {
      throw planError(CUMULATIVE_CLASSIFICATION_ERROR, "handoff contains an exact-resolved observation", {
        observationId,
        resolutionSource: "exact_observation",
      });
    }
    if (priorCommentLabels.has(item.commentText)) {
      throw planError(CUMULATIVE_CLASSIFICATION_ERROR, "handoff contains an existing-comment-resolved item", {
        observationId,
        resolutionSource: "existing_comment_text",
      });
    }
  }
  return true;
}

export function assertCompleteClassificationState(survivors, labels) {
  const survivorIds = new Set((survivors ?? []).map(asObservationId));
  const labelRows = labels ?? [];
  const labelIds = new Set(labelRows.map(asObservationId));
  if (labelIds.size !== labelRows.length) {
    throw planError("CLASSIFICATION_STATE_COVERAGE_MISMATCH", "classification contains duplicate observation labels", {
      duplicateCount: labelRows.length - labelIds.size,
    });
  }
  const missing = [...survivorIds].filter((id) => !labelIds.has(id));
  const extra = [...labelIds].filter((id) => !survivorIds.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw planError("CLASSIFICATION_STATE_COVERAGE_MISMATCH", "classification must cover exactly all cumulative survivors", { missing, extra });
  }
  return true;
}

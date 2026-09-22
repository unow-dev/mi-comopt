import { deterministicId } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";
import { projectCumulativeCorpus } from "../../processing/analysis-input/raw-snapshot-projection.js";
import { worseThreeClassLabel } from "../../three-class/label-resolution.js";
import { planCumulativeClassification, assertCompleteClassificationState } from "../../three-class/cumulative-classification-plan.js";

function normalizeReference(reference) {
  if (typeof reference === "string") {
    const match = /^([0-9a-f]{64}):(\d+)$/.exec(reference);
    if (!match) throw stateError("RECOVERY_INPUT_INVALID", `invalid snapshot reference: ${reference}`);
    return { payloadSha256: match[1], snapshotIndex: Number(match[2]) };
  }
  if (!reference || typeof reference !== "object" || Array.isArray(reference)
    || typeof reference.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(reference.payloadSha256)
    || !Number.isSafeInteger(reference.snapshotIndex) || reference.snapshotIndex < 0) {
    throw stateError("RECOVERY_INPUT_INVALID", "snapshot reference must be { payloadSha256, snapshotIndex }");
  }
  return { payloadSha256: reference.payloadSha256, snapshotIndex: reference.snapshotIndex };
}

function uniqueReferences(references) {
  const result = [];
  const seen = new Set();
  for (const reference of references ?? []) {
    const normalized = normalizeReference(reference);
    const key = `${normalized.payloadSha256}:${normalized.snapshotIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function versionState(version) {
  return version?.payload?.state ?? version?.state ?? {};
}

/**
 * Reconstruct an explicit recovery range. No database-wide history scan is
 * performed: callers must provide the committed versions between the named
 * base and broken head.
 */
export function buildRecoveryCorpusV2({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions = [] } = {}) {
  if (typeof baseCorpusVersionId !== "string" || typeof brokenHeadCorpusVersionId !== "string") {
    throw stateError("RECOVERY_INPUT_REQUIRED", "baseCorpusVersionId and brokenHeadCorpusVersionId are required");
  }
  const versions = [...committedVersions].sort((left, right) => Number(left.versionNo ?? left.version_no ?? 0) - Number(right.versionNo ?? right.version_no ?? 0));
  const baseIndex = versions.findIndex((version) => (version.versionId ?? version.version_id) === baseCorpusVersionId);
  const headIndex = versions.findIndex((version) => (version.versionId ?? version.version_id) === brokenHeadCorpusVersionId);
  if (baseIndex < 0 || headIndex < baseIndex) throw stateError("RECOVERY_RANGE_INVALID", "base and broken head must identify an ordered committed range");
  const selected = versions.slice(baseIndex, headIndex + 1);
  const references = uniqueReferences(selected.flatMap((version) => {
    const state = versionState(version);
    const refs = state.snapshot_refs ?? state.snapshotRefs ?? [];
    // v1 state is read only for recovery. Its historical order is the legacy
    // SHA/index order; v2 retains the order stored in state.
    return (state.schema_version ?? state.schemaVersion) === 2
      ? refs
      : [...refs].map(normalizeReference).sort((left, right) => `${left.payloadSha256}:${left.snapshotIndex}`.localeCompare(`${right.payloadSha256}:${right.snapshotIndex}`));
  }));
  return {
    recoveryId: deterministicId("recovery", `${baseCorpusVersionId}:${brokenHeadCorpusVersionId}`),
    baseCorpusVersionId,
    brokenHeadCorpusVersionId,
    schema_version: 2,
    snapshot_refs: references,
  };
}

/** Recover labels from the explicit historical range, then delegate unresolved handling to the shared planner. */
export function buildRecoveryClassificationPlan({ survivors = [], classificationHistory = [], humanDecisions = {} } = {}) {
  const exact = new Map();
  const comments = new Map();
  const orderedHistory = [...classificationHistory].sort((left, right) => Number(right.versionNo ?? right.version_no ?? 0) - Number(left.versionNo ?? left.version_no ?? 0));
  for (const version of orderedHistory) {
    for (const row of version.labels ?? version.payload?.state?.labels ?? []) {
      const observationId = String(row.observationId ?? row.observation_id);
      if (!exact.has(observationId)) exact.set(observationId, { observationId, commentText: row.commentText, label: row.label });
      if (typeof row.commentText === "string") comments.set(row.commentText, worseThreeClassLabel(comments.get(row.commentText), row.label));
    }
  }
  const plan = planCumulativeClassification({ survivors, priorLabels: [...exact.values(), ...[...comments.entries()].map(([commentText, label]) => ({ observationId: `comment:${commentText}`, commentText, label }))], decisions: humanDecisions });
  if (plan.unresolved.length === 0) assertCompleteClassificationState(survivors, plan.labels);
  return { ...plan, recoveryId: deterministicId("recovery-classification", JSON.stringify({ survivors, classificationHistory })) };
}

export class RecoveryApplicationServiceV3 {
  constructor() { this.requests = new Map(); }

  bootstrap(request = {}) {
    const corpus = buildRecoveryCorpusV2(request);
    const existing = this.requests.get(corpus.recoveryId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(corpus)) throw stateError("RECOVERY_IDEMPOTENCY_CONFLICT", "recovery inputs differ for the same recovery identity");
    this.requests.set(corpus.recoveryId, corpus);
    return corpus;
  }
}

import { canonicalJson, deterministicId, prefixedSha256, semanticSha256 } from "../../state/canonical.js";
import { stateError } from "../../state/errors.js";
import { STREAM_KEYS, typedClassificationHandler, typedCorpusHandler } from "../services.js";
import { readSelectedSnapshotsInReferenceOrder } from "../../database/raw-snapshot-repository.js";
import { readHistoricalClassificationGroupLabels } from "../../database/three-class-label-repository.js";
import { projectCumulativeCorpus } from "../../processing/analysis-input/raw-snapshot-projection.js";
import { buildCumulativeSourceDataset, serializeCumulativeSourceDataset } from "../../processing/optimicom-ui-release/source-dataset.js";
import { worseThreeClassLabel } from "../../three-class/label-resolution.js";
import {
  assertClassificationHandoffSafe,
  assertCompleteClassificationState,
  planCumulativeClassification,
} from "../../three-class/cumulative-classification-plan.js";
import { advancePersistedV3Cutover, readV3CutoverControl } from "../../migration/v3-cutover.js";

export const RECOVERY_CONTRACT = "cumulative-corpus-recovery/v1";
const RECOVERY_LABELS = new Set(["direct_nuisance", "reactive", "normal"]);

function versionIdOf(version) { return version?.versionId ?? version?.version_id; }
function versionNoOf(version) { return Number(version?.versionNo ?? version?.version_no ?? 0); }
function versionState(version) { return version?.payload?.state ?? version?.state ?? version?.payload ?? {}; }

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

function referenceKey(reference) { return `${reference.payloadSha256}:${reference.snapshotIndex}`; }

function uniqueReferences(references) {
  const result = [];
  const seen = new Set();
  for (const value of references ?? []) {
    const reference = normalizeReference(value);
    if (seen.has(referenceKey(reference))) continue;
    seen.add(referenceKey(reference));
    result.push(reference);
  }
  return result;
}

function orderedVersionReferences(version) {
  const state = versionState(version);
  const refs = state.snapshot_refs ?? state.snapshotRefs ?? [];
  const schemaVersion = state.schema_version ?? state.schemaVersion ?? 1;
  if (schemaVersion === 2) return refs.map(normalizeReference);
  return refs.map(normalizeReference).sort((left, right) => referenceKey(left).localeCompare(referenceKey(right)));
}

function selectRecoveryVersions({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions = [] } = {}) {
  if (typeof baseCorpusVersionId !== "string" || typeof brokenHeadCorpusVersionId !== "string") {
    throw stateError("RECOVERY_INPUT_REQUIRED", "baseCorpusVersionId and brokenHeadCorpusVersionId are required");
  }
  const versions = [...committedVersions].sort((left, right) => versionNoOf(left) - versionNoOf(right));
  const baseIndex = versions.findIndex((version) => versionIdOf(version) === baseCorpusVersionId);
  const headIndex = versions.findIndex((version) => versionIdOf(version) === brokenHeadCorpusVersionId);
  if (baseIndex < 0 || headIndex < baseIndex) throw stateError("RECOVERY_RANGE_INVALID", "base and broken head must identify an ordered committed range");
  const base = versions[baseIndex];
  const head = versions[headIndex];
  if (base.streamId !== undefined && head.streamId !== undefined && base.streamId !== head.streamId) {
    throw stateError("RECOVERY_RANGE_INVALID", "base and broken head belong to different corpus streams");
  }
  const selected = versions.slice(baseIndex, headIndex + 1);
  for (let index = 1; index < selected.length; index += 1) {
    if (versionNoOf(selected[index]) !== versionNoOf(selected[index - 1]) + 1) {
      throw stateError("RECOVERY_RANGE_INVALID", "recovery range is not a continuous committed ancestry");
    }
  }
  return { selected, base, head };
}

/** Reconstruct only the explicitly supplied base-to-head range. */
export function buildRecoveryCorpusV2({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions = [] } = {}) {
  const { selected } = selectRecoveryVersions({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions });
  const baseSnapshotRefs = orderedVersionReferences(selected[0]);
  const snapshotRefs = uniqueReferences(selected.flatMap(orderedVersionReferences));
  return {
    recoveryContract: RECOVERY_CONTRACT,
    recoveryId: deterministicId("recovery", `${RECOVERY_CONTRACT}:${baseCorpusVersionId}:${brokenHeadCorpusVersionId}`),
    baseCorpusVersionId,
    brokenHeadCorpusVersionId,
    recoveryRangeVersionIds: selected.map(versionIdOf),
    baseSnapshotRefs: uniqueReferences(baseSnapshotRefs),
    schema_version: 2,
    snapshot_refs: snapshotRefs,
  };
}

function bundleMap(snapshotBundles = []) {
  if (snapshotBundles instanceof Map) return snapshotBundles;
  return new Map((snapshotBundles ?? []).map((bundle) => [referenceKey(bundle.snapshot), bundle]));
}

function bundlesForRefs(refs, bundles) {
  const map = bundleMap(bundles);
  return refs.map((reference) => {
    const bundle = map.get(referenceKey(reference));
    if (!bundle) throw stateError("RECOVERY_SNAPSHOT_DATA_UNAVAILABLE", `snapshot ${referenceKey(reference)} is unavailable for recovery`);
    return bundle;
  });
}

/** Build the non-mutating, canonical recovery plan and count equation. */
export function buildRecoveryPlan({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions = [], snapshotBundles = [] } = {}) {
  const corpus = buildRecoveryCorpusV2({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions });
  const baseSnapshotRefs = corpus.baseSnapshotRefs;
  const baseReferenceKeys = new Set(baseSnapshotRefs.map(referenceKey));
  const appendedSnapshotRefs = corpus.snapshot_refs.filter((reference) => !baseReferenceKeys.has(referenceKey(reference)));
  const baseBundles = bundlesForRefs(baseSnapshotRefs, snapshotBundles);
  const allBundles = bundlesForRefs(corpus.snapshot_refs, snapshotBundles);
  const appendedBundles = bundlesForRefs(appendedSnapshotRefs, snapshotBundles);
  const baseProjection = projectCumulativeCorpus(baseBundles);
  const projection = projectCumulativeCorpus(allBundles);
  const appendedRawObservationCount = appendedBundles.reduce((total, bundle) => total + (bundle.observations?.length ?? 0), 0);
  const logicalGrowth = projection.survivors.length - baseProjection.survivors.length;
  const duplicateObservationCount = appendedRawObservationCount - logicalGrowth;
  if (duplicateObservationCount < 0 || duplicateObservationCount > appendedRawObservationCount) {
    throw stateError("RECOVERY_COUNT_INVALID", "recovery count equation produced an invalid duplicate count");
  }
  const canonicalPlan = {
    recoveryContract: RECOVERY_CONTRACT,
    recoveryId: corpus.recoveryId,
    baseCorpusVersionId,
    brokenHeadCorpusVersionId,
    recoveryRangeVersionIds: corpus.recoveryRangeVersionIds,
    snapshot_refs: corpus.snapshot_refs,
    baseLogicalRecordCount: baseProjection.survivors.length,
    appendedRawObservationCount,
    duplicateObservationCount,
    expectedLogicalRecordCount: baseProjection.survivors.length + appendedRawObservationCount - duplicateObservationCount,
  };
  return {
    ...corpus,
    appendedSnapshotRefs,
    projection,
    baseProjection,
    baseLogicalRecordCount: canonicalPlan.baseLogicalRecordCount,
    appendedRawObservationCount,
    duplicateObservationCount,
    expectedLogicalRecordCount: canonicalPlan.expectedLogicalRecordCount,
    recoveryPlanSha256: prefixedSha256(canonicalPlan),
    canonicalPlan,
  };
}

function groupsForClassification(survivors, dedupeGroups = undefined) {
  if (Array.isArray(dedupeGroups) && dedupeGroups.length > 0) return dedupeGroups;
  return (survivors ?? []).map((survivor) => ({ key: exactDedupeKey(survivor), survivor, observations: [survivor] }));
}

function exactDedupeKey(observation) {
  return canonicalJson([
    observation?.username,
    observation?.handle,
    observation?.commentText ?? observation?.comment,
    observation?.postedAt,
    observation?.postedDate,
  ]);
}

function normalizeHistoryVersions(classificationHistory = []) {
  return (classificationHistory ?? []).map((entry) => ({
    versionId: entry.versionId ?? entry.version_id,
    versionNo: versionNoOf(entry),
    labels: Array.isArray(entry?.labels) ? entry.labels : [entry],
  })).sort((left, right) => right.versionNo - left.versionNo || String(right.versionId ?? "").localeCompare(String(left.versionId ?? "")));
}

/**
 * Recovery classification is scoped to exact-dedupe group members. A label
 * found only on a loser is eligible for the first-win survivor, while an
 * unrelated historical comment with the same text is not eligible.
 */
export function buildRecoveryClassificationPlan({ survivors = [], dedupeGroups = undefined, classificationHistory = [], humanDecisions = {}, decisions = humanDecisions } = {}) {
  const groups = groupsForClassification(survivors, dedupeGroups);
  const survivorIds = new Set((survivors ?? []).map((row) => String(row.observationId ?? row.observation_id)));
  const groupByObservationId = new Map();
  groups.forEach((group, groupIndex) => {
    const members = group.observations ?? [];
    const survivorId = String(group.survivor?.observationId ?? group.survivor?.observation_id);
    if (!group.survivor || members.length === 0 || !survivorIds.has(survivorId) || String(members[0]?.observationId ?? members[0]?.observation_id) !== survivorId) {
      throw stateError("RECOVERY_DEDUPE_GROUP_INVALID", "every recovery dedupe group must have a first-win survivor from the survivor set");
    }
    const expectedKey = exactDedupeKey(group.survivor);
    if (group.key !== expectedKey || members.some((observation) => exactDedupeKey(observation) !== expectedKey)) {
      throw stateError("RECOVERY_DEDUPE_GROUP_INVALID", "recovery dedupe groups must use the exact five-field identity");
    }
    for (const observation of members) {
      const observationId = String(observation.observationId ?? observation.observation_id);
      if (groupByObservationId.has(observationId)) throw stateError("RECOVERY_DEDUPE_GROUP_INVALID", `observation ${observationId} belongs to multiple recovery dedupe groups`);
      groupByObservationId.set(observationId, groupIndex);
    }
  });
  if (new Set(groups.map((group) => String(group.survivor.observationId ?? group.survivor.observation_id))).size !== survivorIds.size) throw stateError("RECOVERY_DEDUPE_GROUP_INVALID", "recovery dedupe groups must cover every survivor exactly once");
  const identityLabels = new Map();
  for (const version of normalizeHistoryVersions(classificationHistory)) {
    const labelsForVersion = new Map();
    for (const row of version.labels ?? []) {
      const groupIndex = groupByObservationId.get(String(row.observationId ?? row.observation_id));
      if (groupIndex === undefined || typeof row.label !== "string") continue;
      labelsForVersion.set(groupIndex, worseThreeClassLabel(labelsForVersion.get(groupIndex), row.label));
    }
    for (const [groupIndex, label] of labelsForVersion) {
      if (!identityLabels.has(groupIndex)) identityLabels.set(groupIndex, { versionId: version.versionId, versionNo: version.versionNo, label });
    }
  }
  const priorLabels = [];
  const identityResolvedSurvivors = [];
  for (const [groupIndex, identity] of identityLabels) {
    const survivor = groups[groupIndex].survivor;
    priorLabels.push({ observationId: String(survivor.observationId), commentText: survivor.commentText, label: identity.label });
    identityResolvedSurvivors.push({ observationId: String(survivor.observationId), groupIndex, label: identity.label, versionId: identity.versionId, versionNo: identity.versionNo });
  }
  const plan = planCumulativeClassification({ survivors, priorLabels, decisions });
  assertClassificationHandoffSafe({ items: plan.handoffItems, priorExactByObservationId: plan.priorExactByObservationId, priorCommentLabels: plan.priorCommentLabels });
  if (plan.unresolved.length === 0) assertCompleteClassificationState(survivors, plan.labels);
  return {
    ...plan,
    recoveryId: deterministicId("recovery-classification", canonicalJson({ survivors, dedupeGroups: groups, classificationHistory })),
    identityResolvedSurvivors,
    groupIdentityLabels: [...identityLabels.entries()].map(([groupIndex, value]) => ({ groupIndex, ...value })),
    previouslyResolvedItemCount: 0,
  };
}

export function verifyRecoveryArtifacts({
  recoveryPlan,
  classificationLabels = [],
  sourceDatasetBytes,
  materializedCommentsBytes,
  servedCommentsBytes,
  generatedOverviewBytes,
  materializedOverviewBytes,
  servedOverviewBytes,
  generatedAccountBytes,
  materializedAccountBytes,
  servedAccountBytes,
  generatedKeywordBytes,
  materializedKeywordBytes,
  servedKeywordBytes,
  servedReleaseId,
  correctedReleaseId,
  previouslyResolvedItemCount = 0,
} = {}) {
  if (servedReleaseId !== correctedReleaseId) throw stateError("RECOVERY_DEPLOYMENT_MISMATCH", "served release does not match corrected release");
  if (previouslyResolvedItemCount !== 0) throw stateError("RECOVERY_PREVIOUSLY_RESOLVED_ITEM", "recovery classification handoff contained a previously resolved item");
  assertCompleteClassificationState(recoveryPlan?.projection?.survivors ?? [], classificationLabels);
  if (recoveryPlan?.expectedLogicalRecordCount !== recoveryPlan?.projection?.survivors?.length) throw stateError("RECOVERY_COUNT_MISMATCH", "recovery logical count does not match the rebuilt corpus projection");
  const compareBytes = (left, right, name) => {
    if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || !left.equals(right)) throw stateError("RECOVERY_ARTIFACT_MISMATCH", `${name} bytes do not match the deterministic rebuild`);
  };
  compareBytes(materializedCommentsBytes, sourceDatasetBytes, "materialized comments");
  compareBytes(servedCommentsBytes, sourceDatasetBytes, "served comments");
  for (const [name, generated, materialized, served] of [
    ["overview", generatedOverviewBytes, materializedOverviewBytes, servedOverviewBytes],
    ["account", generatedAccountBytes, materializedAccountBytes, servedAccountBytes],
    ["keyword", generatedKeywordBytes, materializedKeywordBytes, servedKeywordBytes],
  ]) {
    compareBytes(materialized, generated, `materialized ${name}`);
    compareBytes(served, generated, `served ${name}`);
  }
  return { verificationPassed: true, deploymentVerified: true, previouslyResolvedItemCount, logicalRecordCount: recoveryPlan.projection.survivors.length };
}

function committedCorpusVersions(controlPlane) {
  const stream = controlPlane.ensureStream(STREAM_KEYS.corpus);
  return controlPlane.db.prepare("SELECT version_id FROM state_versions WHERE stream_id = ? ORDER BY version_no ASC").all(stream.stream_id).map((row) => controlPlane.readVersion(row.version_id));
}

function assertControlPlaneAncestry(controlPlane, baseCorpusVersionId, brokenHeadCorpusVersionId, streamId) {
  const base = controlPlane.readVersion(baseCorpusVersionId);
  const head = controlPlane.readVersion(brokenHeadCorpusVersionId);
  if (!base || !head || base.streamId !== streamId || head.streamId !== streamId) {
    throw stateError("RECOVERY_RANGE_INVALID", "base and broken head must belong to the corpus stream");
  }
  if (versionNoOf(base) > versionNoOf(head)) throw stateError("RECOVERY_RANGE_INVALID", "base version must not be newer than broken head");
  const visited = new Set();
  let cursor = brokenHeadCorpusVersionId;
  while (cursor !== baseCorpusVersionId) {
    if (visited.has(cursor)) throw stateError("RECOVERY_RANGE_INVALID", "corpus ancestry contains a cycle");
    visited.add(cursor);
    const transition = controlPlane.db.prepare(
      "SELECT from_version_id FROM state_transitions WHERE stream_id = ? AND to_version_id = ?",
    ).get(streamId, cursor);
    if (!transition?.from_version_id) throw stateError("RECOVERY_RANGE_INVALID", "base version is not an ancestor of broken head");
    cursor = transition.from_version_id;
  }
  return true;
}

function corpusPolicyVersion(controlPlane, corpusVersionId) {
  const dependency = controlPlane.readDependencies(corpusVersionId).find((item) => item.role === "policy");
  if (dependency) return dependency.versionId;
  const policyStream = controlPlane.ensureStream(STREAM_KEYS.corpusPolicy);
  return controlPlane.resolveHead(policyStream.stream_id)?.versionId ?? null;
}

function readRecoveryReceipt(controlPlane, recoveryId, stage) { return controlPlane.readReceipt(`recovery:${recoveryId}:${stage}`); }

function recordRecoveryReceipt(controlPlane, recoveryId, stage, request, result) {
  const operationId = `recovery:${recoveryId}:${stage}`;
  return controlPlane.runIdempotent({ operationId, operationKind: `comment-data-update.v3.recovery.${stage}`, request }, () => result);
}

function assertRecoveryFrozen(controlPlane) {
  const control = readV3CutoverControl(controlPlane);
  if (control && control.state !== "recovery_frozen") throw stateError("RECOVERY_STATE_INVALID", `recovery requires recovery_frozen, got ${control.state}`);
  return control;
}

function deterministicWorksetId(recoveryId) {
  const hex = semanticSha256(`recovery-workset:${recoveryId}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readClassificationRows(controlPlane, classificationVersionId) {
  return controlPlane.db.prepare(
    `SELECT CAST(observation_id AS TEXT) AS observation_id, label
       FROM classification_state_labels
      WHERE version_id = ?
      ORDER BY CAST(observation_id AS INTEGER), observation_id`,
  ).all(classificationVersionId).map((row) => ({ observationId: String(row.observation_id), label: row.label }));
}

export class RecoveryApplicationServiceV3 {
  constructor(controlPlane, { verificationBuilder = undefined, classificationHandoffBuilder = undefined } = {}) {
    this.controlPlane = controlPlane;
    this.verificationBuilder = verificationBuilder;
    this.classificationHandoffBuilder = classificationHandoffBuilder;
    this.requests = new Map();
  }

  bootstrap(request = {}) {
    const corpus = buildRecoveryCorpusV2(request);
    const existing = this.requests.get(corpus.recoveryId);
    if (existing && canonicalJson(existing) !== canonicalJson(corpus)) throw stateError("RECOVERY_IDEMPOTENCY_CONFLICT", "recovery inputs differ for the same recovery identity");
    this.requests.set(corpus.recoveryId, corpus);
    return corpus;
  }

  computePlan(request = {}, { enforceCurrentHead = true } = {}) {
    if (!this.controlPlane) return buildRecoveryPlan(request);
    const { baseCorpusVersionId, brokenHeadCorpusVersionId } = request;
    const versions = committedCorpusVersions(this.controlPlane);
    const stream = this.controlPlane.ensureStream(STREAM_KEYS.corpus);
    const currentHead = this.controlPlane.resolveHead(stream.stream_id)?.versionId ?? null;
    if (enforceCurrentHead && currentHead !== brokenHeadCorpusVersionId) throw stateError("RECOVERY_HEAD_NOT_CURRENT", `broken head ${brokenHeadCorpusVersionId} is not the current corpus head ${currentHead ?? "null"}`);
    assertControlPlaneAncestry(this.controlPlane, baseCorpusVersionId, brokenHeadCorpusVersionId, stream.stream_id);
    const corpus = buildRecoveryCorpusV2({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions: versions });
    const bundles = corpus.snapshot_refs.length === 0 ? [] : readSelectedSnapshotsInReferenceOrder(this.controlPlane.db, corpus.snapshot_refs);
    return buildRecoveryPlan({ baseCorpusVersionId, brokenHeadCorpusVersionId, committedVersions: versions, snapshotBundles: bundles });
  }

  freeze({ actorId = "recovery-operator", nonterminalV3Sessions = 0 } = {}) {
    if (nonterminalV3Sessions !== 0) throw stateError("RECOVERY_DRAIN_REQUIRED", "nonterminal v3 sessions must be zero before recovery freeze");
    return advancePersistedV3Cutover(this.controlPlane, "recovery_freeze", { actorId, newV3Starts: 0, nonterminalV3Sessions }, { operationId: "recovery:freeze" });
  }

  plan(request = {}) {
    assertRecoveryFrozen(this.controlPlane);
    if (Number(request.nonterminalV3Sessions ?? 0) !== 0) throw stateError("RECOVERY_DRAIN_REQUIRED", "nonterminal v3 sessions must be zero before recovery plan");
    const plan = this.computePlan(request);
    return {
      recoveryContract: RECOVERY_CONTRACT,
      recoveryId: plan.recoveryId,
      baseCorpusVersionId: plan.baseCorpusVersionId,
      brokenHeadCorpusVersionId: plan.brokenHeadCorpusVersionId,
      currentCorpusHeadVersionId: plan.brokenHeadCorpusVersionId,
      recoveryRangeVersionIds: plan.recoveryRangeVersionIds,
      snapshot_refs: plan.snapshot_refs,
      baseLogicalRecordCount: plan.baseLogicalRecordCount,
      appendedRawObservationCount: plan.appendedRawObservationCount,
      duplicateObservationCount: plan.duplicateObservationCount,
      expectedLogicalRecordCount: plan.expectedLogicalRecordCount,
      recoveryPlanSha256: plan.recoveryPlanSha256,
    };
  }

  start(request = {}) {
    assertRecoveryFrozen(this.controlPlane);
    if (Number(request.nonterminalV3Sessions ?? 0) !== 0) throw stateError("RECOVERY_DRAIN_REQUIRED", "nonterminal v3 sessions must be zero before recovery start");
    const recoveryId = deterministicId("recovery", `${RECOVERY_CONTRACT}:${request.baseCorpusVersionId}:${request.brokenHeadCorpusVersionId}`);
    const corpusCommitReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "corpus-state-commit");
    const plan = this.computePlan(request, { enforceCurrentHead: !corpusCommitReceipt });
    if (typeof request.expectedPlanSha256 !== "string" || request.expectedPlanSha256 !== plan.recoveryPlanSha256) throw stateError("RECOVERY_PLAN_STALE", "reviewed recovery plan SHA does not match the recomputed plan");
    const existing = readRecoveryReceipt(this.controlPlane, plan.recoveryId, "corpus");
    if (existing) return this.resume({ recoveryId: plan.recoveryId });
    const policyVersionId = corpusPolicyVersion(this.controlPlane, request.brokenHeadCorpusVersionId);
    if (!policyVersionId) throw stateError("RECOVERY_POLICY_REQUIRED", "corpus policy dependency is required for recovery");
    let commit = corpusCommitReceipt?.result;
    if (!commit) {
      const corpusStream = this.controlPlane.ensureStream(STREAM_KEYS.corpus);
      const recoveredState = { schema_version: 2, snapshot_refs: plan.snapshot_refs };
      const proposalId = deterministicId("proposal", `recovery:${plan.recoveryId}:corpus`);
      this.controlPlane.createProposal({ proposalId, streamId: corpusStream.stream_id, expectedHeadVersionId: plan.brokenHeadCorpusVersionId, proposedSemanticSha256: semanticSha256(recoveredState), payload: { schema_version: 1, state: recoveredState }, dependencies: [{ role: "policy", versionId: policyVersionId }], assessmentRefs: { recoveryId: plan.recoveryId, recoveryPlanSha256: plan.recoveryPlanSha256 }, operationId: `recovery:${plan.recoveryId}:corpus-proposal` });
      const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `recovery:${plan.recoveryId}:corpus`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: request.actorId ?? "recovery-operator", transitionPolicyVersionId: policyVersionId, operationId: `recovery:${plan.recoveryId}:corpus-decision` });
      commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: `recovery:${plan.recoveryId}:corpus-state-commit`, domainHandler: typedCorpusHandler(), noOpPolicy: "semantic-and-dependencies" });
    }
    if (!commit?.versionId || commit.versionId === plan.brokenHeadCorpusVersionId) throw stateError("RECOVERY_CORPUS_COMMIT_INVALID", "recovery corpus commit did not produce a distinct version");
    if (commit.recoveryPlanSha256 && commit.recoveryPlanSha256 !== plan.recoveryPlanSha256) throw stateError("RECOVERY_PLAN_STALE", "existing recovery corpus commit is bound to a different plan");
    if (!corpusCommitReceipt) recordRecoveryReceipt(this.controlPlane, plan.recoveryId, "corpus-commit", request, { ...commit, recoveryPlanSha256: plan.recoveryPlanSha256 });
    const result = this._prepareClassification(plan);
    recordRecoveryReceipt(this.controlPlane, plan.recoveryId, "corpus", request, { recoveryContract: RECOVERY_CONTRACT, recoveryId: plan.recoveryId, recoveryPlanSha256: plan.recoveryPlanSha256, recoveredCorpusVersionId: commit.versionId, ...plan.canonicalPlan, classificationPlan: { handoffItems: result.classificationPlan.handoffItems, labels: result.classificationPlan.labels, resolution: result.classificationPlan.resolution, previouslyResolvedItemCount: 0 } });
    if (result.classificationPlan.unresolved.length > 0) {
      recordRecoveryReceipt(this.controlPlane, plan.recoveryId, "classification-plan", request, result.classificationPlan);
      return { stateResult: "handoff_required", recoveryId: plan.recoveryId, recoveredCorpusVersionId: commit.versionId, recoveryPlanSha256: plan.recoveryPlanSha256, classificationPlan: result.classificationPlan };
    }
    const classification = this._commitClassification(plan, commit.versionId, result.classificationPlan, request.actorId ?? "recovery-operator");
    return { stateResult: "started", recoveryId: plan.recoveryId, recoveredCorpusVersionId: commit.versionId, classificationVersionId: classification.versionId, recoveryPlanSha256: plan.recoveryPlanSha256 };
  }

  _prepareClassification(plan, humanDecisions = {}) {
    const observationIds = plan.projection.dedupeGroups.flatMap((group) => (group.observations ?? []).map((row) => String(row.observationId)));
    const historyByVersion = new Map();
    for (const row of readHistoricalClassificationGroupLabels(this.controlPlane.db, observationIds)) {
      const version = historyByVersion.get(row.versionId) ?? { versionId: row.versionId, versionNo: row.versionNo, labels: [] };
      version.labels.push(row);
      historyByVersion.set(row.versionId, version);
    }
    return { classificationPlan: buildRecoveryClassificationPlan({ survivors: plan.projection.survivors, dedupeGroups: plan.projection.dedupeGroups, classificationHistory: [...historyByVersion.values()], humanDecisions }) };
  }

  _commitClassification(plan, recoveredCorpusVersionId, classificationPlan, actorId) {
    assertCompleteClassificationState(plan.projection.survivors, classificationPlan.labels);
    const classificationStream = this.controlPlane.ensureStream(STREAM_KEYS.classification);
    const prior = this.controlPlane.resolveHead(classificationStream.stream_id);
    const policyVersionId = prior
      ? (this.controlPlane.readDependencies(prior.versionId).find((item) => item.role === "policy")?.versionId ?? null)
      : this.controlPlane.resolveHead(this.controlPlane.ensureStream(STREAM_KEYS.classificationPolicy).stream_id)?.versionId ?? null;
    if (!policyVersionId) throw stateError("RECOVERY_POLICY_REQUIRED", "classification policy dependency is required for recovery");
    const state = { schema_version: 2, labels: classificationPlan.labels };
    const proposalId = deterministicId("proposal", `recovery:${plan.recoveryId}:classification`);
    this.controlPlane.createProposal({ proposalId, streamId: classificationStream.stream_id, expectedHeadVersionId: prior?.versionId ?? null, proposedSemanticSha256: semanticSha256(state), payload: { schema_version: 1, state }, dependencies: [{ role: "corpus", versionId: recoveredCorpusVersionId }, { role: "policy", versionId: policyVersionId }], assessmentRefs: { recoveryId: plan.recoveryId, recoveryPlanSha256: plan.recoveryPlanSha256 }, operationId: `recovery:${plan.recoveryId}:classification-proposal` });
    const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `recovery:${plan.recoveryId}:classification`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: actorId, transitionPolicyVersionId: policyVersionId, operationId: `recovery:${plan.recoveryId}:classification-decision` });
    const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: `recovery:${plan.recoveryId}:classification-state-commit`, domainHandler: typedClassificationHandler() });
    recordRecoveryReceipt(this.controlPlane, plan.recoveryId, "classification-commit", { recoveryPlanSha256: plan.recoveryPlanSha256, recoveredCorpusVersionId, classificationVersionId: commit.versionId }, { classificationVersionId: commit.versionId, previouslyResolvedItemCount: 0 });
    this._ensureSourceDataset(plan, recoveredCorpusVersionId, commit.versionId);
    return commit;
  }

  _ensureSourceDataset(plan, recoveredCorpusVersionId, classificationVersionId) {
    const existing = readRecoveryReceipt(this.controlPlane, plan.recoveryId, "source-dataset");
    if (existing) return existing.result;
    const dataset = buildCumulativeSourceDataset({
      corpusVersionId: recoveredCorpusVersionId,
      classificationVersionId,
      snapshotRefs: plan.snapshot_refs,
      survivors: plan.projection.survivors,
      labelRows: readClassificationRows(this.controlPlane, classificationVersionId),
    });
    const bytes = serializeCumulativeSourceDataset(dataset);
    return recordRecoveryReceipt(this.controlPlane, plan.recoveryId, "source-dataset", {
      recoveryPlanSha256: plan.recoveryPlanSha256,
      recoveredCorpusVersionId,
      classificationVersionId,
    }, {
      recoveryId: plan.recoveryId,
      recoveryPlanSha256: plan.recoveryPlanSha256,
      corpusVersionId: recoveredCorpusVersionId,
      classificationVersionId,
      snapshot_refs: dataset.source.snapshot_refs,
      sourceDatasetArtifactSha256: prefixedSha256(bytes),
      recordCount: dataset.records.length,
      previouslyResolvedItemCount: 0,
    });
  }

  classificationComplete({ recoveryId, response = {}, actorId = "recovery-operator" } = {}) {
    const corpusReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "corpus");
    if (!corpusReceipt) throw stateError("RECOVERY_NOT_STARTED", `recovery corpus stage is missing: ${recoveryId}`);
    const request = { baseCorpusVersionId: corpusReceipt.result.baseCorpusVersionId, brokenHeadCorpusVersionId: corpusReceipt.result.brokenHeadCorpusVersionId };
    const plan = this.computePlan(request, { enforceCurrentHead: false });
    if (plan.recoveryPlanSha256 !== corpusReceipt.result.recoveryPlanSha256) throw stateError("RECOVERY_PLAN_STALE", "stored recovery plan no longer matches the current corpus range");
    const handoff = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-handoff");
    if (!handoff) throw stateError("RECOVERY_HANDOFF_REQUIRED", "classification handoff must be opened before its response can be committed");
    if (response?.workset_id !== undefined && response.workset_id !== handoff.result.worksetId) throw stateError("HANDOFF_ARTIFACT_INVALID", "classification response workset identity does not match recovery handoff");
    const decisions = response.decisions ?? response;
    if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) throw stateError("HANDOFF_ARTIFACT_INVALID", "classification response decisions are required");
    const expectedDecisionIds = new Set((handoff.result.handoffItems ?? []).map((item) => item.id));
    const suppliedDecisionIds = Object.keys(decisions);
    if (suppliedDecisionIds.length !== expectedDecisionIds.size || suppliedDecisionIds.some((id) => !expectedDecisionIds.has(id)) || suppliedDecisionIds.some((id) => !RECOVERY_LABELS.has(decisions[id]))) {
      throw stateError("HANDOFF_ARTIFACT_INVALID", "classification response must exactly cover the recovery handoff items with valid labels");
    }
    const prepared = this._prepareClassification(plan, decisions);
    assertClassificationHandoffSafe({ items: prepared.classificationPlan.handoffItems, priorExactByObservationId: prepared.classificationPlan.priorExactByObservationId, priorCommentLabels: prepared.classificationPlan.priorCommentLabels });
    if (prepared.classificationPlan.handoffItems.length > 0 && !readRecoveryReceipt(this.controlPlane, recoveryId, "classification-handoff")) throw stateError("RECOVERY_HANDOFF_REQUIRED", "classification handoff must be opened before its response can be committed");
    if (prepared.classificationPlan.unresolved.length > 0) throw stateError("CLASSIFICATION_STATE_COVERAGE_MISMATCH", "recovery classification response did not resolve every survivor");
    const commit = this._commitClassification(plan, corpusReceipt.result.recoveredCorpusVersionId, prepared.classificationPlan, actorId);
    return { stateResult: "classification_committed", recoveryId, classificationVersionId: commit.versionId, previouslyResolvedItemCount: 0 };
  }

  resume({ recoveryId, actorId = "recovery-operator" } = {}) {
    const corpusReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "corpus");
    if (!corpusReceipt) throw stateError("RECOVERY_NOT_STARTED", `recovery is not started: ${recoveryId}`);
    const classificationReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-commit");
    if (classificationReceipt) {
      const plan = this.computePlan({ baseCorpusVersionId: corpusReceipt.result.baseCorpusVersionId, brokenHeadCorpusVersionId: corpusReceipt.result.brokenHeadCorpusVersionId }, { enforceCurrentHead: false });
      this._ensureSourceDataset(plan, corpusReceipt.result.recoveredCorpusVersionId, classificationReceipt.result.classificationVersionId);
      return { stateResult: "resumed", recoveryId, ...classificationReceipt.result };
    }
    const planReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-plan");
    if (planReceipt?.result?.unresolved?.length > 0) return { stateResult: "handoff_required", recoveryId, classificationPlan: planReceipt.result };
    const plan = this.computePlan({ baseCorpusVersionId: corpusReceipt.result.baseCorpusVersionId, brokenHeadCorpusVersionId: corpusReceipt.result.brokenHeadCorpusVersionId }, { enforceCurrentHead: false });
    const prepared = this._prepareClassification(plan);
    if (prepared.classificationPlan.unresolved.length > 0) return { stateResult: "handoff_required", recoveryId, classificationPlan: prepared.classificationPlan };
    const commit = this._commitClassification(plan, corpusReceipt.result.recoveredCorpusVersionId, prepared.classificationPlan, actorId);
    return { stateResult: "resumed", recoveryId, classificationVersionId: commit.versionId };
  }

  classificationOpen({ recoveryId, worksetId = deterministicWorksetId(recoveryId), actorId = "recovery-operator" } = {}) {
    const corpusReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "corpus");
    if (!corpusReceipt) throw stateError("RECOVERY_NOT_STARTED", `recovery corpus stage is missing: ${recoveryId}`);
    const plan = this.computePlan({
      baseCorpusVersionId: corpusReceipt.result.baseCorpusVersionId,
      brokenHeadCorpusVersionId: corpusReceipt.result.brokenHeadCorpusVersionId,
    }, { enforceCurrentHead: false });
    if (plan.recoveryPlanSha256 !== corpusReceipt.result.recoveryPlanSha256) throw stateError("RECOVERY_PLAN_STALE", "stored recovery plan no longer matches the current corpus range");
    const classificationPlan = this._prepareClassification(plan).classificationPlan;
    assertClassificationHandoffSafe({
      items: classificationPlan.handoffItems,
      priorExactByObservationId: classificationPlan.priorExactByObservationId,
      priorCommentLabels: classificationPlan.priorCommentLabels,
    });
    if ((classificationPlan.handoffItems ?? []).length === 0) return { stateResult: "ready_without_handoff", recoveryId, previouslyResolvedItemCount: 0 };
    const classificationPlanReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-plan");
    if (classificationPlanReceipt && canonicalJson(classificationPlanReceipt.result.handoffItems ?? []) !== canonicalJson(classificationPlan.handoffItems)) {
      throw stateError("RECOVERY_HANDOFF_CHANGED", "recovery classification handoff changed after planning");
    }
    const existingHandoff = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-handoff");
    if (existingHandoff) return existingHandoff.result;
    const artifact = this.classificationHandoffBuilder
      ? this.classificationHandoffBuilder({
        recoveryId,
        corpusVersionId: corpusReceipt.result.recoveredCorpusVersionId,
        recoveryPlanSha256: corpusReceipt.result.recoveryPlanSha256,
        snapshotRefs: plan.snapshot_refs,
        items: classificationPlan.handoffItems,
      })
      : { content: Buffer.from(canonicalJson({ recoveryId, recoveryPlanSha256: corpusReceipt.result.recoveryPlanSha256, items: classificationPlan.handoffItems }), "utf8") };
    if (!artifact || !Buffer.isBuffer(artifact.content)) throw stateError("HANDOFF_ARTIFACT_INVALID", "classification handoff builder must return artifact bytes");
    return recordRecoveryReceipt(this.controlPlane, recoveryId, "classification-handoff", {
      recoveryId,
      worksetId,
      recoveryPlanSha256: corpusReceipt.result.recoveryPlanSha256,
      actorId,
    }, {
      recoveryId,
      worksetId: artifact.worksetId ?? worksetId,
      recoveryPlanSha256: corpusReceipt.result.recoveryPlanSha256,
      itemCount: classificationPlan.handoffItems.length,
      previouslyResolvedItemCount: 0,
      artifactSha256: prefixedSha256(artifact.content),
      artifactByteLength: artifact.content.length,
      artifactType: artifact.worksetId ? "three-class-workset-v1" : "recovery-classification-handoff-v1",
      ...(artifact.artifactPath ? { artifactPath: artifact.artifactPath } : {}),
      handoffItems: classificationPlan.handoffItems,
    });
  }

  classificationReview({ recoveryId, outcome, rationale, actorId = "recovery-operator" } = {}) {
    if (!['accept', 'reject'].includes(outcome) || typeof rationale !== "string" || rationale.length === 0) throw stateError("INVALID_REVIEW_OUTCOME", "classification recovery review requires accept/reject and rationale");
    return recordRecoveryReceipt(this.controlPlane, recoveryId, "classification-review", { recoveryId, outcome, rationale, actorId }, { recoveryId, outcome, rationale, actorId });
  }

  keywordOpen({ recoveryId, actorId = "recovery-operator" } = {}) {
    const classification = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-commit");
    if (!classification) throw stateError("RECOVERY_CLASSIFICATION_REQUIRED", "classification must be committed before keyword recovery");
    const sourceDataset = readRecoveryReceipt(this.controlPlane, recoveryId, "source-dataset");
    if (!sourceDataset) throw stateError("RECOVERY_SOURCE_DATASET_REQUIRED", "Source Dataset v2 must be materialized before keyword recovery");
    return recordRecoveryReceipt(this.controlPlane, recoveryId, "keyword-plan", { recoveryId, actorId }, {
      recoveryId,
      classificationVersionId: classification.result.classificationVersionId,
      sourceDatasetArtifactSha256: sourceDataset.result.sourceDatasetArtifactSha256,
      stateResult: "handoff_required",
    });
  }

  keywordComplete({ recoveryId, proposal, actorId = "recovery-operator" } = {}) {
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) throw stateError("HANDOFF_ARTIFACT_INVALID", "keyword recovery proposal is required");
    const keywordPlan = readRecoveryReceipt(this.controlPlane, recoveryId, "keyword-plan");
    if (!keywordPlan) throw stateError("RECOVERY_KEYWORD_PLAN_REQUIRED", "keyword recovery handoff must be opened before completion");
    const suppliedSourceSha = proposal.source_dataset_artifact_sha256 ?? proposal.sourceDatasetArtifactSha256;
    if (suppliedSourceSha !== undefined && suppliedSourceSha !== keywordPlan.result.sourceDatasetArtifactSha256) throw stateError("SOURCE_DATASET_IDENTITY_MISMATCH", "keyword proposal source dataset SHA does not match recovery Source Dataset v2");
    return recordRecoveryReceipt(this.controlPlane, recoveryId, "keyword-complete", { recoveryId, proposal, actorId }, {
      recoveryId,
      proposal,
      sourceDatasetArtifactSha256: keywordPlan.result.sourceDatasetArtifactSha256,
      stateResult: "completed",
    });
  }

  keywordReview({ recoveryId, outcome, rationale, actorId = "recovery-operator" } = {}) {
    if (!['accept', 'reject'].includes(outcome) || typeof rationale !== "string" || rationale.length === 0) throw stateError("INVALID_REVIEW_OUTCOME", "keyword recovery review requires accept/reject and rationale");
    return recordRecoveryReceipt(this.controlPlane, recoveryId, "keyword-review", { recoveryId, outcome, rationale, actorId }, { recoveryId, outcome, rationale, actorId });
  }

  status({ recoveryId } = {}) {
    if (typeof recoveryId !== "string" || recoveryId.length === 0) throw stateError("RECOVERY_INPUT_REQUIRED", "recoveryId is required");
    const stages = ["corpus", "classification-plan", "classification-commit", "source-dataset", "release", "deployment", "verify", "complete"];
    return { recoveryId, cutover: readV3CutoverControl(this.controlPlane), stages: Object.fromEntries(stages.map((stage) => [stage, readRecoveryReceipt(this.controlPlane, recoveryId, stage)])) };
  }

  cancel({ recoveryId = undefined, actorId = "recovery-operator", rationale = "" } = {}) {
    const mutating = recoveryId && ["corpus", "classification-commit", "source-dataset", "release", "deployment"].some((stage) => readRecoveryReceipt(this.controlPlane, recoveryId, stage));
    if (mutating) throw stateError("RECOVERY_CANCEL_FORBIDDEN", "recovery cancel is forbidden after mutation begins");
    return advancePersistedV3Cutover(this.controlPlane, "recovery_cancelled", { actorId, rationale, mutatingRecoveryStageCompleted: false }, { operationId: recoveryId ? `recovery:${recoveryId}:cancel` : "recovery:cancel" });
  }

  verify({ recoveryId, verification = undefined } = {}) {
    assertRecoveryFrozen(this.controlPlane);
    const corpusReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "corpus");
    if (!corpusReceipt) throw stateError("RECOVERY_NOT_STARTED", `recovery corpus stage is missing: ${recoveryId}`);
    const classificationReceipt = readRecoveryReceipt(this.controlPlane, recoveryId, "classification-commit");
    if (!classificationReceipt) throw stateError("RECOVERY_CLASSIFICATION_REQUIRED", "recovery classification must be committed before verification");
    if (verification !== undefined) throw stateError("RECOVERY_VERIFICATION_INPUT_FORBIDDEN", "verification must be derived from the configured provider read-back verifier");
    if (typeof this.verificationBuilder !== "function") throw stateError("RECOVERY_VERIFIER_REQUIRED", "a provider read-back recovery verifier is required");
    const plan = this.computePlan({ baseCorpusVersionId: corpusReceipt.result.baseCorpusVersionId, brokenHeadCorpusVersionId: corpusReceipt.result.brokenHeadCorpusVersionId }, { enforceCurrentHead: false });
    if (plan.recoveryPlanSha256 !== corpusReceipt.result.recoveryPlanSha256) throw stateError("RECOVERY_PLAN_STALE", "stored recovery plan no longer matches the current corpus range");
    const handoffRows = this.controlPlane.db.prepare(
      "SELECT result_json FROM application_operation_receipts WHERE operation_id LIKE ? ORDER BY operation_id",
    ).all(`recovery:${recoveryId}:classification-handoff%`);
    const handoffs = handoffRows.map((row) => JSON.parse(row.result_json));
    const previouslyResolvedItemCount = handoffs.reduce((total, row) => total + Number(row.previouslyResolvedItemCount ?? 0), 0);
    const classificationHandoffCount = handoffs.length;
    const chatGPTClassificationItemCount = handoffs.reduce((total, row) => total + Number(row.itemCount ?? row.handoffItems?.length ?? 0), 0);
    if (previouslyResolvedItemCount !== 0) throw stateError("RECOVERY_PREVIOUSLY_RESOLVED_ITEM", "immutable classification handoff receipt contains a previously resolved item");
    const result = this.verificationBuilder({
      recoveryId,
      recoveryPlan: plan,
      corpusReceipt,
      classificationReceipt,
      classificationLabels: readClassificationRows(this.controlPlane, classificationReceipt.result.classificationVersionId),
      sourceDatasetReceipt: readRecoveryReceipt(this.controlPlane, recoveryId, "source-dataset"),
    });
    if (!result || result.verificationPassed !== true || result.deploymentVerified !== true) throw stateError("RECOVERY_VERIFICATION_FAILED", "provider read-back recovery verification did not pass");
    const receiptResult = {
      ...result,
      recoveryId,
      recoveryPlanSha256: plan.recoveryPlanSha256,
      classificationVersionId: classificationReceipt.result.classificationVersionId,
      verificationPassed: true,
      deploymentVerified: true,
      classificationHandoffCount,
      chatGPTClassificationItemCount,
      previouslyResolvedItemCount,
    };
    return recordRecoveryReceipt(this.controlPlane, recoveryId, "verify", { recoveryId, classificationVersionId: classificationReceipt.result.classificationVersionId, recoveryPlanSha256: plan.recoveryPlanSha256 }, receiptResult);
  }

  complete({ recoveryId, actorId = "recovery-operator" } = {}) {
    assertRecoveryFrozen(this.controlPlane);
    const verification = readRecoveryReceipt(this.controlPlane, recoveryId, "verify");
    if (!verification?.result?.verificationPassed || verification.result.recoveryId !== recoveryId || verification.result.previouslyResolvedItemCount !== 0) throw stateError("RECOVERY_VERIFICATION_REQUIRED", "matching successful recovery verification is required");
    return advancePersistedV3Cutover(this.controlPlane, "recovery_completed", { recoveryId, actorId, verificationPassed: true, verificationReceiptOperationId: verification.operationId }, { operationId: `recovery:${recoveryId}:complete` });
  }
}

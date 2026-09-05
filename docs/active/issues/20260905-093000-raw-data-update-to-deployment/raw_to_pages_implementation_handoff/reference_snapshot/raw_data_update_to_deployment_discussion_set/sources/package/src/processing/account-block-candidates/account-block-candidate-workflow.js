import crypto from "node:crypto";
import { WorkflowValidationError } from "../shared/workflow-validation-error.js";

export const ACCOUNT_LABELS = ["direct_nuisance", "reactive", "normal"];
export const ACCOUNT_DATASET_FIELDS = [
  "username",
  "handle",
  "comment",
  "postedAt",
  "postedDate",
  "label",
];
export const ACCOUNT_CANDIDATE_FIELDS = [
  "handle",
  "direct_nuisance_count",
  "evidence_sample",
];
export const ACCOUNT_EVIDENCE_FIELDS = ["comment", "postedAt", "postedDate"];

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function issue(code, path, message) {
  return { code, path, message };
}

function fail(errors, message = "アカウント候補契約の検証に失敗しました") {
  if (errors.length) throw new WorkflowValidationError(errors, message);
}

function exactKeys(value, expected, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\u001f") !== wanted.join("\u001f")) {
    errors.push(issue("ADDITIONAL_PROPERTY", path, `フィールドが契約と一致しません: ${actual.join(", ")}`));
  }
}

function assertPlainSha(value, path, errors) {
  if (typeof value !== "string" || !HEX_SHA256.test(value)) {
    errors.push(issue("INVALID_SHA256", path, "64桁のlowercase hex SHA-256が必要です"));
  }
}

function assertSha(value, path, errors) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    errors.push(issue("INVALID_SHA256", path, "sha256:<64 lowercase hex> が必要です"));
  }
}

function assertTimestamp(value, path, errors) {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    errors.push(issue("INVALID_TIMESTAMP", path, "UTC秒精度のtimestampが必要です"));
  }
}

function assertNonNegativeInteger(value, path, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(issue("INVALID_INTEGER", path, "0以上の整数が必要です"));
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function prefixedSha256(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function eventFingerprint({ handle, comment, postedAt, postedDate }) {
  return sha256Hex(
    Buffer.from(JSON.stringify([handle, comment, postedAt, postedDate]), "utf8"),
  );
}

export function handleFingerprint(handle) {
  return sha256Hex(Buffer.from(JSON.stringify([handle]), "utf8"));
}

export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new WorkflowValidationError([
      issue("INVALID_POLICY", "policy", "policyはobjectである必要があります"),
    ]);
  }
  if (policy.schema_version !== 1) errors.push(issue("INVALID_POLICY_VERSION", "policy.schema_version", "schema_version=1が必要です"));
  if (typeof policy.policy_version !== "string" || policy.policy_version.length === 0) {
    errors.push(issue("INVALID_POLICY_VERSION", "policy.policy_version", "policy_versionは空にできません"));
  }
  if (policy.candidate_label !== "direct_nuisance") {
    errors.push(issue("INVALID_CANDIDATE_LABEL", "policy.candidate_label", "candidate_labelはdirect_nuisanceである必要があります"));
  }
  if (!Number.isInteger(policy.minimum_behavior_events) || policy.minimum_behavior_events < 1) {
    errors.push(issue("INVALID_MINIMUM_EVENTS", "policy.minimum_behavior_events", "1以上の整数が必要です"));
  }
  if (!Number.isInteger(policy.evidence_sample_size) || policy.evidence_sample_size < 1) {
    errors.push(issue("INVALID_EVIDENCE_SAMPLE_SIZE", "policy.evidence_sample_size", "1以上の整数が必要です"));
  }
  if (
    Number.isInteger(policy.minimum_behavior_events) &&
    Number.isInteger(policy.evidence_sample_size) &&
    policy.evidence_sample_size > policy.minimum_behavior_events
  ) {
    errors.push(issue("INVALID_EVIDENCE_SAMPLE_SIZE", "policy.evidence_sample_size", "minimum_behavior_events以下である必要があります"));
  }
  fail(errors);
  return policy;
}

export function validateSummary(summary, datasetBytes) {
  const errors = [];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new WorkflowValidationError([
      issue("INVALID_SUMMARY", "summary", "summaryはobjectである必要があります"),
    ]);
  }
  if (summary.final_published !== true) {
    errors.push(issue("DATASET_NOT_PUBLISHED", "summary.final_published", "final_published=trueのdatasetだけを受け付けます"));
  }
  assertPlainSha(summary.final_output_sha256, "summary.final_output_sha256", errors);
  if (typeof summary.three_class_policy_version !== "string" || summary.three_class_policy_version.length === 0) {
    errors.push(issue("INVALID_SUMMARY_FIELD", "summary.three_class_policy_version", "non-empty stringが必要です"));
  }
  assertNonNegativeInteger(summary.unresolved_optional_p2_reviews, "summary.unresolved_optional_p2_reviews", errors);
  if (datasetBytes && HEX_SHA256.test(summary.final_output_sha256 ?? "")) {
    if (sha256Hex(datasetBytes) !== summary.final_output_sha256) {
      errors.push(issue("DATASET_SHA_MISMATCH", "summary.final_output_sha256", "dataset fileの実SHA-256と一致しません"));
    }
  }
  fail(errors);
  return summary;
}

export function validateDataset(dataset) {
  if (!Array.isArray(dataset)) {
    throw new WorkflowValidationError([
      issue("INVALID_DATASET", "dataset", "datasetはJSON arrayである必要があります"),
    ]);
  }

  const errors = [];
  dataset.forEach((record, index) => {
    const path = `dataset[${index}]`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(issue("INVALID_RECORD", path, "recordはobjectである必要があります"));
      return;
    }
    exactKeys(record, ACCOUNT_DATASET_FIELDS, path, errors);
    for (const field of ACCOUNT_DATASET_FIELDS.slice(0, 5)) {
      if (typeof record[field] !== "string") {
        errors.push(issue("INVALID_FIELD", `${path}.${field}`, "source fieldはstringである必要があります"));
      }
    }
    if (!ACCOUNT_LABELS.includes(record.label)) {
      errors.push(issue("INVALID_LABEL", `${path}.label`, "labelが3-Class契約外です"));
    }
  });
  fail(errors);
  return dataset;
}

export function validateKeywordMeta(keywordMeta) {
  const errors = [];
  if (!keywordMeta || typeof keywordMeta !== "object" || Array.isArray(keywordMeta)) {
    throw new WorkflowValidationError([
      issue("INVALID_KEYWORD_META", "keyword_meta", "keyword metaはobjectである必要があります"),
    ]);
  }
  assertSha(keywordMeta.dataset_artifact_sha256, "keyword_meta.dataset_artifact_sha256", errors);
  fail(errors);
  return keywordMeta;
}

function buildEventGroups(dataset) {
  const groups = new Map();
  for (const record of dataset) {
    const fingerprint = eventFingerprint(record);
    const current = groups.get(fingerprint);
    if (current) {
      current.labels.add(record.label);
      continue;
    }
    groups.set(fingerprint, {
      fingerprint,
      handle: record.handle,
      comment: record.comment,
      postedAt: record.postedAt,
      postedDate: record.postedDate,
      labels: new Set([record.label]),
    });
  }
  return groups;
}

export function buildAccountCandidates(dataset, policy) {
  validatePolicy(policy);
  validateDataset(dataset);

  const groups = buildEventGroups(dataset);
  const errors = [];
  const handleEvents = new Map();
  for (const event of groups.values()) {
    if (event.labels.size > 1) {
      errors.push(issue("BEHAVIOR_EVENT_LABEL_CONFLICT", `event.${event.fingerprint}`, "同一behavior eventに異なるlabelがあります"));
      continue;
    }
    const label = [...event.labels][0];
    if (label !== "direct_nuisance") continue;
    if (event.handle.trim().length === 0) {
      errors.push(issue("BLANK_DIRECT_HANDLE", `event.${event.fingerprint}.handle`, "direct_nuisance eventのhandleは空白だけにできません"));
      continue;
    }
    const events = handleEvents.get(event.handle) ?? [];
    events.push(event);
    handleEvents.set(event.handle, events);
  }
  fail(errors);

  const candidates = [...handleEvents.entries()]
    .map(([handle, events]) => {
      const ordered = [...events].sort((left, right) => compareStrings(left.fingerprint, right.fingerprint));
      return {
        handle,
        direct_nuisance_count: ordered.length,
        evidence_sample: ordered.slice(0, policy.evidence_sample_size).map((event) => ({
          comment: event.comment,
          postedAt: event.postedAt,
          postedDate: event.postedDate,
        })),
        _handle_fingerprint: handleFingerprint(handle),
      };
    })
    .filter((candidate) => candidate.direct_nuisance_count >= policy.minimum_behavior_events)
    .sort(
      (left, right) =>
        right.direct_nuisance_count - left.direct_nuisance_count ||
        compareStrings(left._handle_fingerprint, right._handle_fingerprint),
    )
    .map(({ _handle_fingerprint: _ignored, ...candidate }) => candidate);

  return {
    candidates,
    statistics: {
      source_record_count: dataset.length,
      distinct_behavior_event_count: groups.size,
      collapsed_source_rows: dataset.length - groups.size,
      direct_nuisance_event_count: [...groups.values()].filter(
        (event) => event.labels.size === 1 && [...event.labels][0] === "direct_nuisance",
      ).length,
      candidate_count: candidates.length,
    },
  };
}

function validateEvidence(evidence, path, errors) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    errors.push(issue("INVALID_EVIDENCE", path, "evidenceはobjectである必要があります"));
    return;
  }
  exactKeys(evidence, ACCOUNT_EVIDENCE_FIELDS, path, errors);
  for (const field of ACCOUNT_EVIDENCE_FIELDS) {
    if (typeof evidence[field] !== "string") errors.push(issue("INVALID_EVIDENCE", `${path}.${field}`, "stringが必要です"));
  }
}

export function validateCandidateArtifact(candidates, policy) {
  const errors = [];
  validatePolicy(policy);
  if (!Array.isArray(candidates)) {
    throw new WorkflowValidationError([
      issue("INVALID_CANDIDATES", "candidates", "candidate artifactはarrayである必要があります"),
    ]);
  }
  const handles = new Set();
  let previous = null;
  candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(issue("INVALID_CANDIDATE", path, "candidateはobjectである必要があります"));
      return;
    }
    exactKeys(candidate, ACCOUNT_CANDIDATE_FIELDS, path, errors);
    if (typeof candidate.handle !== "string" || candidate.handle.trim().length === 0) {
      errors.push(issue("INVALID_HANDLE", `${path}.handle`, "handleは空白だけにできません"));
    } else if (handles.has(candidate.handle)) {
      errors.push(issue("DUPLICATE_HANDLE", `${path}.handle`, "candidate handleは一意である必要があります"));
    } else {
      handles.add(candidate.handle);
    }
    if (!Number.isInteger(candidate.direct_nuisance_count) || candidate.direct_nuisance_count < policy.minimum_behavior_events) {
      errors.push(issue("INVALID_DIRECT_COUNT", `${path}.direct_nuisance_count`, "minimum_behavior_events以上の整数が必要です"));
    }
    if (!Array.isArray(candidate.evidence_sample) || candidate.evidence_sample.length !== policy.evidence_sample_size) {
      errors.push(issue("INVALID_EVIDENCE_SAMPLE", `${path}.evidence_sample`, "policyどおりのevidence件数が必要です"));
    } else {
      candidate.evidence_sample.forEach((evidence, evidenceIndex) => validateEvidence(evidence, `${path}.evidence_sample[${evidenceIndex}]`, errors));
    }
    if (previous) {
      const expectedOrder =
        previous.direct_nuisance_count > candidate.direct_nuisance_count ||
        (previous.direct_nuisance_count === candidate.direct_nuisance_count &&
          compareStrings(handleFingerprint(previous.handle), handleFingerprint(candidate.handle)) <= 0);
      if (!expectedOrder) errors.push(issue("NON_DETERMINISTIC_ORDER", path, "candidate orderingが契約と一致しません"));
    }
    previous = candidate;
  });
  fail(errors);
  return true;
}

export function validateMeta(meta) {
  const required = [
    "schema_version",
    "run_id",
    "run_manifest_content_sha256",
    "published_at",
    "candidates_content_sha256",
    "dataset_artifact_sha256",
    "three_class_policy_version",
    "unresolved_optional_p2_reviews",
    "candidate_policy_version",
    "candidate_policy_content_sha256",
  ];
  const errors = [];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new WorkflowValidationError([issue("INVALID_META", "meta", "metaはobjectである必要があります")]);
  }
  exactKeys(meta, required, "meta", errors);
  if (meta.schema_version !== 1) errors.push(issue("INVALID_META_VERSION", "meta.schema_version", "schema_version=1が必要です"));
  if (typeof meta.run_id !== "string" || !RUN_ID.test(meta.run_id)) errors.push(issue("INVALID_RUN_ID", "meta.run_id", "UUIDv4形式のrun_idが必要です"));
  assertSha(meta.run_manifest_content_sha256, "meta.run_manifest_content_sha256", errors);
  assertTimestamp(meta.published_at, "meta.published_at", errors);
  assertSha(meta.candidates_content_sha256, "meta.candidates_content_sha256", errors);
  assertSha(meta.dataset_artifact_sha256, "meta.dataset_artifact_sha256", errors);
  if (typeof meta.three_class_policy_version !== "string" || meta.three_class_policy_version.length === 0) errors.push(issue("INVALID_META_FIELD", "meta.three_class_policy_version", "non-empty stringが必要です"));
  assertNonNegativeInteger(meta.unresolved_optional_p2_reviews, "meta.unresolved_optional_p2_reviews", errors);
  if (typeof meta.candidate_policy_version !== "string" || meta.candidate_policy_version.length === 0) errors.push(issue("INVALID_META_FIELD", "meta.candidate_policy_version", "non-empty stringが必要です"));
  assertSha(meta.candidate_policy_content_sha256, "meta.candidate_policy_content_sha256", errors);
  fail(errors);
  return true;
}

export function validateManifest(manifest) {
  const errors = [];
  const expectedTopLevel = [
    "schema_version",
    "run_id",
    "run_type",
    "started_at",
    "completed_at",
    "published_at",
    "outcome",
    "source_dataset",
    "source_summary",
    "candidate_policy",
    "generator",
    "statistics",
    "artifacts",
  ];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new WorkflowValidationError([issue("INVALID_MANIFEST", "manifest", "manifestはobjectである必要があります")]);
  }
  exactKeys(manifest, expectedTopLevel, "manifest", errors);
  if (manifest.schema_version !== 1) errors.push(issue("INVALID_MANIFEST_VERSION", "manifest.schema_version", "schema_version=1が必要です"));
  if (typeof manifest.run_id !== "string" || !RUN_ID.test(manifest.run_id)) errors.push(issue("INVALID_RUN_ID", "manifest.run_id", "UUIDv4形式のrun_idが必要です"));
  if (manifest.run_type !== "full_snapshot") errors.push(issue("INVALID_RUN_TYPE", "manifest.run_type", "run_type=full_snapshotが必要です"));
  for (const field of ["started_at", "completed_at", "published_at"]) assertTimestamp(manifest[field], `manifest.${field}`, errors);
  if (manifest.outcome !== "published") errors.push(issue("INVALID_OUTCOME", "manifest.outcome", "outcome=publishedが必要です"));
  if (!manifest.source_dataset || typeof manifest.source_dataset !== "object") errors.push(issue("INVALID_SOURCE_DATASET", "manifest.source_dataset", "source_datasetが必要です"));
  else {
    exactKeys(manifest.source_dataset, ["artifact_ref", "artifact_sha256"], "manifest.source_dataset", errors);
    if (typeof manifest.source_dataset.artifact_ref !== "string" || manifest.source_dataset.artifact_ref.length === 0) errors.push(issue("INVALID_SOURCE_REF", "manifest.source_dataset.artifact_ref", "non-empty stringが必要です"));
    assertSha(manifest.source_dataset.artifact_sha256, "manifest.source_dataset.artifact_sha256", errors);
  }
  if (!manifest.source_summary || typeof manifest.source_summary !== "object") errors.push(issue("INVALID_SOURCE_SUMMARY", "manifest.source_summary", "source_summaryが必要です"));
  else {
    exactKeys(manifest.source_summary, ["artifact_ref", "content_sha256", "final_published", "three_class_policy_version", "unresolved_optional_p2_reviews"], "manifest.source_summary", errors);
    if (typeof manifest.source_summary.artifact_ref !== "string" || manifest.source_summary.artifact_ref.length === 0) errors.push(issue("INVALID_SOURCE_REF", "manifest.source_summary.artifact_ref", "non-empty stringが必要です"));
    assertSha(manifest.source_summary.content_sha256, "manifest.source_summary.content_sha256", errors);
    if (manifest.source_summary.final_published !== true) errors.push(issue("DATASET_NOT_PUBLISHED", "manifest.source_summary.final_published", "final_published=trueが必要です"));
    if (typeof manifest.source_summary.three_class_policy_version !== "string" || manifest.source_summary.three_class_policy_version.length === 0) errors.push(issue("INVALID_SOURCE_SUMMARY", "manifest.source_summary.three_class_policy_version", "non-empty stringが必要です"));
    assertNonNegativeInteger(manifest.source_summary.unresolved_optional_p2_reviews, "manifest.source_summary.unresolved_optional_p2_reviews", errors);
  }
  if (!manifest.candidate_policy || typeof manifest.candidate_policy !== "object") errors.push(issue("INVALID_CANDIDATE_POLICY", "manifest.candidate_policy", "candidate_policyが必要です"));
  else {
    exactKeys(manifest.candidate_policy, ["version", "content_sha256"], "manifest.candidate_policy", errors);
    if (typeof manifest.candidate_policy.version !== "string" || manifest.candidate_policy.version.length === 0) errors.push(issue("INVALID_CANDIDATE_POLICY", "manifest.candidate_policy.version", "non-empty stringが必要です"));
    assertSha(manifest.candidate_policy.content_sha256, "manifest.candidate_policy.content_sha256", errors);
  }
  if (!manifest.generator || typeof manifest.generator !== "object") errors.push(issue("INVALID_GENERATOR", "manifest.generator", "generatorが必要です"));
  else {
    exactKeys(manifest.generator, ["version", "content_sha256"], "manifest.generator", errors);
    if (typeof manifest.generator.version !== "string" || manifest.generator.version.length === 0) errors.push(issue("INVALID_GENERATOR", "manifest.generator.version", "non-empty stringが必要です"));
    assertSha(manifest.generator.content_sha256, "manifest.generator.content_sha256", errors);
  }
  if (!manifest.statistics || typeof manifest.statistics !== "object") errors.push(issue("INVALID_STATISTICS", "manifest.statistics", "statisticsが必要です"));
  else {
    exactKeys(manifest.statistics, ["source_record_count", "distinct_behavior_event_count", "collapsed_source_rows", "direct_nuisance_event_count", "candidate_count"], "manifest.statistics", errors);
    for (const field of ["source_record_count", "distinct_behavior_event_count", "collapsed_source_rows", "direct_nuisance_event_count", "candidate_count"]) assertNonNegativeInteger(manifest.statistics[field], `manifest.statistics.${field}`, errors);
  }
  if (!manifest.artifacts || typeof manifest.artifacts !== "object") errors.push(issue("INVALID_ARTIFACTS", "manifest.artifacts", "artifactsが必要です"));
  else {
    exactKeys(manifest.artifacts, ["candidate_view"], "manifest.artifacts", errors);
    const candidateView = manifest.artifacts.candidate_view;
    if (!candidateView || typeof candidateView !== "object") errors.push(issue("INVALID_ARTIFACTS", "manifest.artifacts.candidate_view", "candidate_viewが必要です"));
    else {
      exactKeys(candidateView, ["artifact_ref", "content_sha256"], "manifest.artifacts.candidate_view", errors);
      if (candidateView.artifact_ref !== "accountBlockCandidates.json") errors.push(issue("INVALID_ARTIFACT_REF", "manifest.artifacts.candidate_view.artifact_ref", "artifact_refが不正です"));
      assertSha(candidateView.content_sha256, "manifest.artifacts.candidate_view.content_sha256", errors);
    }
  }
  fail(errors);
  return true;
}

export function validateArtifactBindings({ candidates, candidatesBytes, meta, metaBytes, manifest, manifestBytes, policy, policyBytes, generatorBytes, keywordMeta }) {
  const errors = [];
  try { validateCandidateArtifact(candidates, policy); } catch (caught) { errors.push(...(caught.errors ?? [issue("INVALID_CANDIDATES", "candidates", caught.message)])); }
  try { validateMeta(meta); } catch (caught) { errors.push(...(caught.errors ?? [issue("INVALID_META", "meta", caught.message)])); }
  try { validateManifest(manifest); } catch (caught) { errors.push(...(caught.errors ?? [issue("INVALID_MANIFEST", "manifest", caught.message)])); }
  if (candidatesBytes && meta?.candidates_content_sha256 !== prefixedSha256(candidatesBytes)) errors.push(issue("CANDIDATES_HASH_MISMATCH", "meta.candidates_content_sha256", "candidate artifact hashが一致しません"));
  if (candidatesBytes && manifest?.artifacts?.candidate_view?.content_sha256 !== prefixedSha256(candidatesBytes)) errors.push(issue("MANIFEST_CANDIDATES_HASH_MISMATCH", "manifest.artifacts.candidate_view.content_sha256", "manifest candidate artifact hashが一致しません"));
  if (manifestBytes && meta?.run_manifest_content_sha256 !== prefixedSha256(manifestBytes)) errors.push(issue("MANIFEST_HASH_MISMATCH", "meta.run_manifest_content_sha256", "manifest hashが一致しません"));
  if (meta && manifest) {
    if (meta.run_id !== manifest.run_id) errors.push(issue("RUN_ID_MISMATCH", "meta.run_id", "meta/manifestのrun_idが一致しません"));
    if (meta.published_at !== manifest.published_at) errors.push(issue("PUBLISHED_AT_MISMATCH", "meta.published_at", "meta/manifestのpublished_atが一致しません"));
    if (meta.dataset_artifact_sha256 !== manifest.source_dataset?.artifact_sha256) errors.push(issue("DATASET_SHA_MISMATCH", "meta.dataset_artifact_sha256", "meta/manifestのdataset SHAが一致しません"));
    if (meta.three_class_policy_version !== manifest.source_summary?.three_class_policy_version) errors.push(issue("UPSTREAM_POLICY_VERSION_MISMATCH", "meta.three_class_policy_version", "upstream policy versionが一致しません"));
    if (meta.unresolved_optional_p2_reviews !== manifest.source_summary?.unresolved_optional_p2_reviews) errors.push(issue("P2_COUNT_MISMATCH", "meta.unresolved_optional_p2_reviews", "unresolved optional P2件数が一致しません"));
    if (meta.candidate_policy_version !== manifest.candidate_policy?.version) errors.push(issue("CANDIDATE_POLICY_VERSION_MISMATCH", "meta.candidate_policy_version", "candidate policy versionが一致しません"));
    if (meta.candidate_policy_content_sha256 !== manifest.candidate_policy?.content_sha256) errors.push(issue("CANDIDATE_POLICY_HASH_MISMATCH", "meta.candidate_policy_content_sha256", "candidate policy hashが一致しません"));
    if (manifest.statistics?.candidate_count !== candidates?.length) errors.push(issue("CANDIDATE_COUNT_MISMATCH", "manifest.statistics.candidate_count", "candidate_countが一致しません"));
    if (manifest.statistics?.collapsed_source_rows > manifest.statistics?.source_record_count) errors.push(issue("INVALID_STATISTICS", "manifest.statistics.collapsed_source_rows", "collapsed_source_rowsがsource_record_countを超えています"));
  }
  if (keywordMeta && meta && keywordMeta.dataset_artifact_sha256 !== meta.dataset_artifact_sha256) errors.push(issue("DATASET_SNAPSHOT_MISMATCH", "dataset_artifact_sha256", "keyword/accountのdataset SHAが一致しません"));
  if (policyBytes && meta?.candidate_policy_content_sha256 !== prefixedSha256(policyBytes)) errors.push(issue("POLICY_HASH_MISMATCH", "meta.candidate_policy_content_sha256", "policy file hashが一致しません"));
  if (generatorBytes && manifest?.generator?.content_sha256 !== prefixedSha256(generatorBytes)) errors.push(issue("GENERATOR_HASH_MISMATCH", "manifest.generator.content_sha256", "generator script hashが一致しません"));
  fail(errors, "アカウント候補artifactのhash binding検証に失敗しました");
  return true;
}

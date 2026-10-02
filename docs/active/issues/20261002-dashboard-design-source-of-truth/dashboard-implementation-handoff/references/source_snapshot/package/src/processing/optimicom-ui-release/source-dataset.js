import { prettyJson } from "../keyword-candidates/candidate-workflow.js";

export const OPTIMICOM_LABELS = ["direct_nuisance", "reactive", "normal"];
const SHA256 = /^[0-9a-f]{64}$/;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function validateSnapshotRef(snapshot) {
  if (
    !snapshot ||
    typeof snapshot.payloadSha256 !== "string" ||
    !SHA256.test(snapshot.payloadSha256) ||
    !Number.isSafeInteger(snapshot.snapshotIndex) ||
    snapshot.snapshotIndex < 0
  ) {
    fail("THREE_CLASS_LABELS_INCOMPLETE", "snapshot reference is invalid");
  }
}

export function validateSourceDataset(dataset) {
  if (
    !dataset ||
    typeof dataset !== "object" ||
    Array.isArray(dataset) ||
    Object.keys(dataset).join("\u001f") !== ["schema_version", "labeling_status", "snapshot_ref", "records"].join("\u001f") ||
    dataset.schema_version !== 1 ||
    dataset.labeling_status !== "published" ||
    !Array.isArray(dataset.records)
  ) {
    fail("SOURCE_DATASET_INVALID", "source dataset shape is invalid");
  }
  if (!dataset.snapshot_ref || Object.keys(dataset.snapshot_ref).join("\u001f") !== ["payload_sha256", "snapshot_index"].join("\u001f")) {
    fail("SOURCE_DATASET_INVALID", "source dataset snapshot_ref shape is invalid");
  }
  validateSnapshotRef({
    payloadSha256: dataset.snapshot_ref?.payload_sha256,
    snapshotIndex: dataset.snapshot_ref?.snapshot_index,
  });
  dataset.records.forEach((record, index) => {
    const expectedKeys = ["source_index", "username", "handle", "comment", "postedAt", "postedDate", "label"];
    if (
      !record ||
      typeof record !== "object" ||
      Object.keys(record).join("\u001f") !== expectedKeys.join("\u001f") ||
      record.source_index !== index ||
      !["username", "handle", "comment", "postedAt", "postedDate"].every((key) => typeof record[key] === "string") ||
      !OPTIMICOM_LABELS.includes(record.label)
    ) {
      fail("SOURCE_DATASET_INVALID", `source dataset record ${index} is invalid`);
    }
  });
  return dataset;
}

function validateLabelCompleteness(selectedSnapshots, labelRows) {
  if (!Array.isArray(selectedSnapshots) || selectedSnapshots.length !== 1) {
    fail("THREE_CLASS_LABELS_INCOMPLETE", "exactly one snapshot is required");
  }
  const bundle = selectedSnapshots[0];
  const observations = bundle?.observations;
  const loadedCount = Number(bundle?.snapshot?.loadedCount);
  if (
    !Array.isArray(observations) ||
    !Array.isArray(labelRows) ||
    !Number.isSafeInteger(loadedCount) ||
    loadedCount < 0 ||
    observations.length !== loadedCount ||
    labelRows.length !== loadedCount
  ) {
    fail("THREE_CLASS_LABELS_INCOMPLETE", "snapshot observations and three-class labels are incomplete");
  }
  for (let index = 0; index < loadedCount; index += 1) {
    if (
      observations[index]?.sourceIndex !== index ||
      labelRows[index]?.sourceIndex !== index ||
      !OPTIMICOM_LABELS.includes(labelRows[index]?.label)
    ) {
      fail("THREE_CLASS_LABELS_INCOMPLETE", `source_index ${index} is missing, misaligned, or invalid`);
    }
  }
}

export function buildDbKeywordCandidateDataset(selectedSnapshots, labelRows) {
  validateLabelCompleteness(selectedSnapshots, labelRows);
  const bundle = selectedSnapshots[0];
  const dataset = {
    schema_version: 1,
    labeling_status: "published",
    snapshot_ref: {
      payload_sha256: bundle.snapshot.payloadSha256,
      snapshot_index: bundle.snapshot.snapshotIndex,
    },
    records: bundle.observations.map((observation, index) => ({
      source_index: index,
      username: observation.username,
      handle: observation.handle,
      comment: observation.commentText,
      postedAt: observation.postedAt,
      postedDate: observation.postedDate,
      label: labelRows[index].label,
    })),
  };
  return validateSourceDataset(dataset);
}

export function serializeDbKeywordCandidateDataset(dataset) {
  validateSourceDataset(dataset);
  return Buffer.from(prettyJson(dataset), "utf8");
}

function validateCorpusIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    fail("SOURCE_DATASET_INVALID", "source identity is invalid");
  }
  const expectedKeys = ["corpus_version_id", "classification_version_id", "snapshot_refs"];
  if (Object.keys(identity).join("\u001f") !== expectedKeys.join("\u001f")) {
    fail("SOURCE_DATASET_INVALID", "source identity fields are invalid");
  }
  for (const key of expectedKeys.slice(0, 2)) {
    if (typeof identity[key] !== "string" || identity[key].length === 0) fail("SOURCE_DATASET_INVALID", `${key} is invalid`);
  }
  if (!Array.isArray(identity.snapshot_refs) || identity.snapshot_refs.length === 0) {
    fail("SOURCE_DATASET_INVALID", "source snapshot_refs are invalid");
  }
  identity.snapshot_refs.forEach((reference, index) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)
      || Object.keys(reference).join("\u001f") !== ["payload_sha256", "snapshot_index"].join("\u001f")) {
      fail("SOURCE_DATASET_INVALID", `source snapshot_refs[${index}] is invalid`);
    }
    validateSnapshotRef({ payloadSha256: reference.payload_sha256, snapshotIndex: reference.snapshot_index });
  });
}

function validateV2Records(records) {
  if (!Array.isArray(records)) fail("SOURCE_DATASET_INVALID", "source dataset records are invalid");
  records.forEach((record, index) => {
    const expectedKeys = ["source_index", "username", "handle", "comment", "postedAt", "postedDate", "label"];
    if (!record || typeof record !== "object" || Array.isArray(record)
      || Object.keys(record).join("\u001f") !== expectedKeys.join("\u001f")
      || record.source_index !== index
      || !["username", "handle", "comment", "postedAt", "postedDate"].every((key) => typeof record[key] === "string")
      || !OPTIMICOM_LABELS.includes(record.label)) {
      fail("SOURCE_DATASET_INVALID", `source dataset record ${index} is invalid`);
    }
  });
}

export function validateSourceDatasetV2(dataset) {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)
    || Object.keys(dataset).join("\u001f") !== ["schema_version", "labeling_status", "source", "records"].join("\u001f")
    || dataset.schema_version !== 2 || dataset.labeling_status !== "published") {
    fail("SOURCE_DATASET_INVALID", "source dataset v2 shape is invalid");
  }
  validateCorpusIdentity(dataset.source);
  validateV2Records(dataset.records);
  return dataset;
}

function labelMapFromRows(labelRows) {
  const map = new Map();
  for (const row of labelRows ?? []) {
    const observationId = String(row.observationId ?? row.observation_id);
    if (!observationId || map.has(observationId)) fail("SOURCE_DATASET_CLASSIFICATION_COVERAGE_MISMATCH", `duplicate classification label ${observationId}`);
    map.set(observationId, row.label);
  }
  return map;
}

/** Build a public Source Dataset v2 from cumulative survivors and one pinned classification. */
export function buildCumulativeSourceDataset({ corpusVersionId, classificationVersionId, snapshotRefs, survivors, labelRows, labels } = {}) {
  const rows = labelRows ?? labels ?? [];
  const labelMap = rows instanceof Map
    ? new Map([...rows.entries()].map(([observationId, label]) => [String(observationId), label]))
    : labelMapFromRows(rows);
  const sourceRows = (survivors ?? []).map((observation, index) => {
    const observationId = String(observation.observationId ?? observation.observation_id);
    const label = labelMap.get(observationId);
    if (label === undefined) fail("SOURCE_DATASET_CLASSIFICATION_COVERAGE_MISMATCH", `missing classification label ${observationId}`);
    return {
      source_index: index,
      username: observation.username,
      handle: observation.handle,
      comment: observation.commentText ?? observation.comment,
      postedAt: observation.postedAt,
      postedDate: observation.postedDate,
      label,
    };
  });
  if (labelMap.size !== sourceRows.length) {
    const survivorIds = new Set((survivors ?? []).map((row) => String(row.observationId ?? row.observation_id)));
    const extra = [...labelMap.keys()].filter((id) => !survivorIds.has(id));
    fail("SOURCE_DATASET_CLASSIFICATION_COVERAGE_MISMATCH", `classification has ${extra.length} extra observation(s)`);
  }
  const dataset = {
    schema_version: 2,
    labeling_status: "published",
    source: {
      corpus_version_id: corpusVersionId,
      classification_version_id: classificationVersionId,
      snapshot_refs: (snapshotRefs ?? []).map((reference) => ({
        payload_sha256: reference.payloadSha256 ?? reference.payload_sha256,
        snapshot_index: reference.snapshotIndex ?? reference.snapshot_index,
      })),
    },
    records: sourceRows,
  };
  return validateSourceDatasetV2(dataset);
}

export function serializeCumulativeSourceDataset(dataset) {
  validateSourceDatasetV2(dataset);
  return Buffer.from(prettyJson(dataset), "utf8");
}

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

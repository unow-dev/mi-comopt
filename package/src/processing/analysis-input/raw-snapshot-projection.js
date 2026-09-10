import { createHash } from "node:crypto";

export const ANALYSIS_INPUT_FIELDS = ["username", "handle", "comment", "postedAt", "postedDate"];
export const ANALYSIS_PROJECTION_VERSION = "1.0.0";
export const ANALYSIS_MANIFEST_SCHEMA_VERSION = 3;
export const DATABASE_SCHEMA_VERSION = 8;

function compareSnapshots(left, right) {
  if (left.snapshot.payloadSha256 < right.snapshot.payloadSha256) return -1;
  if (left.snapshot.payloadSha256 > right.snapshot.payloadSha256) return 1;
  return left.snapshot.snapshotIndex - right.snapshot.snapshotIndex;
}

function compareObservations(left, right) {
  return left.sourceIndex - right.sourceIndex;
}

export function projectRawSnapshots(snapshotBundles) {
  const records = [];
  const manifestSnapshots = [];
  let outputStartIndex = 0;

  for (const bundle of [...snapshotBundles].sort(compareSnapshots)) {
    const observations = [...bundle.observations].sort(compareObservations);
    for (const observation of observations) {
      records.push({
        username: observation.username,
        handle: observation.handle,
        comment: observation.commentText,
        postedAt: observation.postedAt,
        postedDate: observation.postedDate,
      });
    }
    manifestSnapshots.push({
      payload_sha256: bundle.snapshot.payloadSha256,
      snapshot_index: bundle.snapshot.snapshotIndex,
      input_format: bundle.snapshot.inputFormat,
      platform: bundle.snapshot.platform,
      extracted_at: bundle.snapshot.extractedAt,
      source_canonical_url: bundle.snapshot.sourceCanonicalUrl,
      loaded_count: bundle.snapshot.loadedCount,
      reported_count: bundle.snapshot.reportedCount,
      coverage_note: bundle.snapshot.coverageNote,
      output_start_index: outputStartIndex,
      record_count: observations.length,
    });
    outputStartIndex += observations.length;
  }

  return { records, manifestSnapshots };
}

export const projectAnalysisInput = projectRawSnapshots;

export function serializeAnalysisJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

export function sha256Utf8(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export function buildAnalysisArtifacts(snapshotBundles) {
  const { records, manifestSnapshots } = projectRawSnapshots(snapshotBundles);
  const outputJson = serializeAnalysisJson(records);
  const manifest = {
    schema_version: ANALYSIS_MANIFEST_SCHEMA_VERSION,
    projection_version: ANALYSIS_PROJECTION_VERSION,
    database_schema_version: DATABASE_SCHEMA_VERSION,
    output_sha256: sha256Utf8(outputJson),
    output_record_count: records.length,
    snapshots: manifestSnapshots,
  };
  return {
    records,
    manifest,
    outputJson,
    manifestJson: serializeAnalysisJson(manifest),
  };
}

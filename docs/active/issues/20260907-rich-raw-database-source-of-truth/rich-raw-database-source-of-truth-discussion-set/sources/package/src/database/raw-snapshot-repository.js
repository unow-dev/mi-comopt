import { readFile } from "node:fs/promises";
import path from "node:path";
import { CommentDatabaseError } from "./comment-database.js";
import {
  DEFAULT_RAW_ROOT,
  computeRawPayloadSha256,
  rawSnapshotRelativePath,
  resolveRawRoot,
} from "../raw-snapshot/raw-snapshot-contract.js";

function snapshotNotFound(payloadSha256) {
  return new CommentDatabaseError("SNAPSHOT_NOT_FOUND", `snapshot SHA is not present in the database: ${payloadSha256}`);
}

function integrityError(message) {
  return new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", message);
}

function selectedSnapshotRows(db, snapshotShas = undefined) {
  if (snapshotShas === undefined) {
    return db.prepare(
      `SELECT snapshot_id, platform, raw_schema_version, payload_sha256, raw_relpath,
              extracted_at, source_page_url, source_canonical_url, item_source,
              loaded_count, reported_count, coverage_note, imported_at
       FROM raw_snapshots ORDER BY payload_sha256 ASC`,
    ).all();
  }
  if (snapshotShas.length === 0) return [];
  const placeholders = snapshotShas.map(() => "?").join(", ");
  return db.prepare(
    `SELECT snapshot_id, platform, raw_schema_version, payload_sha256, raw_relpath,
            extracted_at, source_page_url, source_canonical_url, item_source,
            loaded_count, reported_count, coverage_note, imported_at
     FROM raw_snapshots
     WHERE payload_sha256 IN (${placeholders})
     ORDER BY payload_sha256 ASC`,
  ).all(...snapshotShas);
}

function assertSelectedSnapshotsFound(rows, snapshotShas) {
  const known = new Set(rows.map((row) => row.payload_sha256));
  for (const payloadSha256 of snapshotShas) {
    if (!known.has(payloadSha256)) throw snapshotNotFound(payloadSha256);
  }
}

function readSnapshotObservations(db, snapshotId, payloadSha256) {
  const rows = db.prepare(
    `SELECT source_index, username, handle, comment_text, posted_at, posted_date
     FROM snapshot_comment_observations
     WHERE snapshot_id = ? ORDER BY source_index ASC`,
  ).all(snapshotId);
  const loadedCount = Number(db.prepare(
    "SELECT loaded_count FROM raw_snapshots WHERE snapshot_id = ?",
  ).get(snapshotId).loaded_count);
  if (rows.length !== loadedCount) {
    throw integrityError(
      `snapshot ${payloadSha256} loaded_count=${loadedCount} does not match observations=${rows.length}`,
    );
  }
  return rows.map((row) => ({
    sourceIndex: Number(row.source_index),
    username: row.username,
    handle: row.handle,
    commentText: row.comment_text,
    postedAt: row.posted_at,
    postedDate: row.posted_date,
  }));
}

function toPlainSnapshot(row) {
  return {
    snapshotId: Number(row.snapshot_id),
    platform: row.platform,
    rawSchemaVersion: Number(row.raw_schema_version),
    payloadSha256: row.payload_sha256,
    rawRelpath: row.raw_relpath,
    extractedAt: row.extracted_at,
    sourcePageUrl: row.source_page_url,
    sourceCanonicalUrl: row.source_canonical_url,
    itemSource: row.item_source,
    loadedCount: Number(row.loaded_count),
    reportedCount: Number(row.reported_count),
    coverageNote: row.coverage_note,
    importedAt: row.imported_at,
  };
}

export function readSelectedSnapshots(db, snapshotShas) {
  if (!Array.isArray(snapshotShas) || snapshotShas.length === 0) {
    throw new CommentDatabaseError("SNAPSHOT_NOT_FOUND", "at least one snapshot SHA is required");
  }
  if (new Set(snapshotShas).size !== snapshotShas.length) {
    throw new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", "snapshot SHA selection contains duplicates");
  }
  const rows = selectedSnapshotRows(db, snapshotShas);
  assertSelectedSnapshotsFound(rows, snapshotShas);
  return rows.map((row) => ({
    snapshot: toPlainSnapshot(row),
    observations: readSnapshotObservations(db, row.snapshot_id, row.payload_sha256),
  }));
}

export const readAnalysisSnapshots = readSelectedSnapshots;

function selectedRowsForVerification(db, snapshotShas) {
  const rows = selectedSnapshotRows(db, snapshotShas);
  if (snapshotShas !== undefined) assertSelectedSnapshotsFound(rows, snapshotShas);
  return rows;
}

export async function verifyRawStore(db, options = {}) {
  const snapshotShas = options.snapshotShas;
  const rows = selectedRowsForVerification(db, snapshotShas);
  const rawRoot = resolveRawRoot(options.rawRoot ?? DEFAULT_RAW_ROOT);
  for (const row of rows) {
    const expectedRelpath = rawSnapshotRelativePath(row.payload_sha256);
    if (row.raw_relpath !== expectedRelpath) {
      throw integrityError(
        `snapshot ${row.payload_sha256} has unexpected raw_relpath ${row.raw_relpath}`,
      );
    }

    let rawBytes;
    try {
      rawBytes = await readFile(path.join(rawRoot, row.raw_relpath));
    } catch (error) {
      throw new CommentDatabaseError(
        "RAW_STORE_CORRUPT",
        `raw file is missing or unreadable for ${row.payload_sha256}: ${error.message}`,
      );
    }
    const actualSha = computeRawPayloadSha256(rawBytes);
    if (actualSha !== row.payload_sha256) {
      throw new CommentDatabaseError(
        "RAW_STORE_CORRUPT",
        `raw file hash ${actualSha} does not match database SHA ${row.payload_sha256}`,
      );
    }

    const observationCount = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM snapshot_comment_observations WHERE snapshot_id = ?",
    ).get(row.snapshot_id).count);
    if (observationCount !== Number(row.loaded_count)) {
      throw integrityError(
        `snapshot ${row.payload_sha256} loaded_count=${row.loaded_count} does not match observations=${observationCount}`,
      );
    }
    const videoObservationCount = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM snapshot_video_observations WHERE snapshot_id = ?",
    ).get(row.snapshot_id).count);
    if (videoObservationCount !== 1) {
      throw integrityError(
        `snapshot ${row.payload_sha256} must have exactly one video observation, found ${videoObservationCount}`,
      );
    }
  }
  return { status: "verified", snapshotCount: rows.length };
}

import { createHash } from "node:crypto";
import { CommentDatabaseError } from "./comment-database.js";

function snapshotReferenceKey(reference) {
  return `${reference.payloadSha256}:${reference.snapshotIndex}`;
}

function snapshotNotFound(reference) {
  return new CommentDatabaseError(
    "SNAPSHOT_NOT_FOUND",
    `snapshot reference is not present in the database: ${snapshotReferenceKey(reference)}`,
  );
}

function integrityError(message) {
  return new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", message);
}

function validateSnapshotReference(reference) {
  if (
    reference === null ||
    typeof reference !== "object" ||
    Array.isArray(reference) ||
    typeof reference.payloadSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(reference.payloadSha256) ||
    !Number.isSafeInteger(reference.snapshotIndex) ||
    reference.snapshotIndex < 0
  ) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "snapshot reference must be { payloadSha256, snapshotIndex }");
  }
}

function selectedSnapshotRows(db, snapshotRefs = undefined) {
  const columns = `
    rs.snapshot_id,
    rs.platform,
    rs.payload_sha256,
    rs.snapshot_index,
    ri.input_format,
    rs.extracted_at,
    rs.source_page_url,
    rs.source_canonical_url,
    rs.item_source,
    rs.loaded_count,
    rs.reported_count,
    rs.coverage_note,
    ri.imported_at`;
  if (snapshotRefs === undefined) {
    return db.prepare(
      `SELECT ${columns}
       FROM raw_snapshots AS rs
       JOIN raw_inputs AS ri ON ri.payload_sha256 = rs.payload_sha256
       ORDER BY rs.payload_sha256 ASC, rs.snapshot_index ASC`,
    ).all();
  }
  if (snapshotRefs.length === 0) return [];
  const conditions = snapshotRefs.map(() => "(rs.payload_sha256 = ? AND rs.snapshot_index = ?)").join(" OR ");
  const parameters = snapshotRefs.flatMap((reference) => [reference.payloadSha256, reference.snapshotIndex]);
  return db.prepare(
    `SELECT ${columns}
     FROM raw_snapshots AS rs
     JOIN raw_inputs AS ri ON ri.payload_sha256 = rs.payload_sha256
     WHERE ${conditions}
     ORDER BY rs.payload_sha256 ASC, rs.snapshot_index ASC`,
  ).all(...parameters);
}

function assertSelectedSnapshotsFound(rows, snapshotRefs) {
  const known = new Set(rows.map((row) => `${row.payload_sha256}:${Number(row.snapshot_index)}`));
  for (const reference of snapshotRefs) {
    if (!known.has(snapshotReferenceKey(reference))) throw snapshotNotFound(reference);
  }
}

function readSnapshotObservations(db, snapshotId, payloadSha256, loadedCount) {
  const rows = db.prepare(
    `SELECT source_index, username, handle, comment_text, posted_at, posted_date
     FROM snapshot_comment_observations
     WHERE snapshot_id = ? ORDER BY source_index ASC`,
  ).all(snapshotId);
  if (rows.length !== Number(loadedCount)) {
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
    payloadSha256: row.payload_sha256,
    snapshotIndex: Number(row.snapshot_index),
    inputFormat: row.input_format,
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

export function readSelectedSnapshots(db, snapshotRefs) {
  if (!Array.isArray(snapshotRefs) || snapshotRefs.length === 0) {
    throw new CommentDatabaseError("SNAPSHOT_NOT_FOUND", "at least one snapshot reference is required");
  }
  snapshotRefs.forEach(validateSnapshotReference);
  if (new Set(snapshotRefs.map(snapshotReferenceKey)).size !== snapshotRefs.length) {
    throw new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", "snapshot selection contains duplicates");
  }
  const rows = selectedSnapshotRows(db, snapshotRefs);
  assertSelectedSnapshotsFound(rows, snapshotRefs);
  return rows.map((row) => ({
    snapshot: toPlainSnapshot(row),
    observations: readSnapshotObservations(db, row.snapshot_id, row.payload_sha256, row.loaded_count),
  }));
}

export const readAnalysisSnapshots = readSelectedSnapshots;

function selectedRowsForVerification(db, snapshotRefs) {
  if (snapshotRefs === undefined) return selectedSnapshotRows(db);
  snapshotRefs.forEach(validateSnapshotReference);
  const rows = selectedSnapshotRows(db, snapshotRefs);
  assertSelectedSnapshotsFound(rows, snapshotRefs);
  return rows;
}

function allRowsForPayloadShas(db, payloadShas) {
  if (payloadShas.length === 0) return [];
  return db.prepare(
    `SELECT rs.snapshot_id, rs.platform, rs.payload_sha256, rs.snapshot_index,
            ri.input_format, rs.extracted_at, rs.source_page_url,
            rs.source_canonical_url, rs.item_source, rs.loaded_count,
            rs.reported_count, rs.coverage_note, ri.imported_at
     FROM raw_snapshots AS rs
     JOIN raw_inputs AS ri ON ri.payload_sha256 = rs.payload_sha256
     WHERE rs.payload_sha256 IN (${payloadShas.map(() => "?").join(", ")})
     ORDER BY rs.payload_sha256 ASC, rs.snapshot_index ASC`,
  ).all(...payloadShas);
}

function verifyRawInputRow(row) {
  if (!(row.payload_bytes instanceof Uint8Array)) {
    throw integrityError(`raw input ${row.payload_sha256} payload_bytes is not a BLOB`);
  }
  const payloadBytes = Buffer.from(row.payload_bytes);
  const actualSha = createHash("sha256").update(payloadBytes).digest("hex");
  if (actualSha !== row.payload_sha256) {
    throw integrityError(`raw input hash ${actualSha} does not match database SHA ${row.payload_sha256}`);
  }
  if (Number(row.byte_length) !== payloadBytes.length) {
    throw integrityError(
      `raw input ${row.payload_sha256} byte_length=${row.byte_length} does not match payload length=${payloadBytes.length}`,
    );
  }
}

export function readRawInput(db, payloadSha256) {
  if (typeof payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(payloadSha256)) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "payload SHA must be 64 lowercase hexadecimal characters");
  }
  const row = db.prepare(
    `SELECT payload_sha256, payload_bytes, byte_length, input_format, imported_at
     FROM raw_inputs WHERE payload_sha256 = ?`,
  ).get(payloadSha256);
  if (row === undefined) {
    throw new CommentDatabaseError("SNAPSHOT_NOT_FOUND", `raw input is not present in the database: ${payloadSha256}`);
  }
  verifyRawInputRow(row);
  return {
    payloadSha256: row.payload_sha256,
    payloadBytes: Buffer.from(row.payload_bytes),
    byteLength: Number(row.byte_length),
    inputFormat: row.input_format,
    importedAt: row.imported_at,
  };
}

function verifySnapshotRow(db, row) {
  const parentCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM raw_inputs WHERE payload_sha256 = ?",
  ).get(row.payload_sha256).count);
  if (parentCount !== 1) {
    throw integrityError(`snapshot ${row.payload_sha256}:${row.snapshot_index} has no unique raw input parent`);
  }
  const observationCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM snapshot_comment_observations WHERE snapshot_id = ?",
  ).get(row.snapshot_id).count);
  if (observationCount !== Number(row.loaded_count)) {
    throw integrityError(
      `snapshot ${row.payload_sha256}:${row.snapshot_index} loaded_count=${row.loaded_count} does not match observations=${observationCount}`,
    );
  }
  const videoObservationCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM snapshot_video_observations WHERE snapshot_id = ?",
  ).get(row.snapshot_id).count);
  if (videoObservationCount !== 1) {
    throw integrityError(
      `snapshot ${row.payload_sha256}:${row.snapshot_index} must have exactly one video observation, found ${videoObservationCount}`,
    );
  }
}

export function verifyRawInputs(db, options = {}) {
  const snapshotRefs = options.snapshotRefs;
  const selectedRows = selectedRowsForVerification(db, snapshotRefs);
  const payloadShas = [...new Set(selectedRows.map((row) => row.payload_sha256))];
  const snapshotRows = snapshotRefs === undefined ? selectedRows : allRowsForPayloadShas(db, payloadShas);
  const rawInputRows = payloadShas.length === 0
    ? db.prepare(
      `SELECT payload_sha256, payload_bytes, byte_length, input_format, imported_at
       FROM raw_inputs ORDER BY payload_sha256 ASC`,
    ).all()
    : db.prepare(
      `SELECT payload_sha256, payload_bytes, byte_length, input_format, imported_at
       FROM raw_inputs WHERE payload_sha256 IN (${payloadShas.map(() => "?").join(", ")})
       ORDER BY payload_sha256 ASC`,
    ).all(...payloadShas);
  for (const row of rawInputRows) verifyRawInputRow(row);
  for (const row of snapshotRows) verifySnapshotRow(db, row);

  const duplicateRows = db.prepare(
    `SELECT payload_sha256, snapshot_index, COUNT(*) AS count
     FROM raw_snapshots GROUP BY payload_sha256, snapshot_index HAVING COUNT(*) > 1`,
  ).all();
  if (duplicateRows.length > 0) {
    throw integrityError("raw snapshot provenance identity is not unique");
  }
  const emptyRawInputs = db.prepare(
    `SELECT ri.payload_sha256
     FROM raw_inputs AS ri
     LEFT JOIN raw_snapshots AS rs ON rs.payload_sha256 = ri.payload_sha256
     GROUP BY ri.payload_sha256 HAVING COUNT(rs.snapshot_id) = 0`,
  ).all();
  if (emptyRawInputs.length > 0) {
    throw integrityError("raw input has no materialized snapshots");
  }
  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw integrityError(`foreign key check failed for ${foreignKeyViolations.length} row(s)`);
  }
  return {
    status: "verified",
    rawInputCount: rawInputRows.length,
    snapshotCount: snapshotRows.length,
  };
}

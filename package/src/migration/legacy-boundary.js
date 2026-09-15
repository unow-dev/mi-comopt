const LEGACY_WRITER_DISABLED_STATUSES = new Set(["cutover", "legacy_read_compatibility", "retired"]);

function boundaryError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function cutoverRow(db, { domain, streamKey }) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'state_cutovers'").get();
  if (!table) return null;
  return db.prepare(
    `SELECT c.status, c.legacy_writer_enabled
     FROM state_cutovers AS c
     JOIN state_streams AS s ON s.stream_id = c.stream_id
     WHERE s.domain = ? AND s.stream_key = ?`,
  ).get(domain, streamKey) ?? null;
}

export function assertLegacyWriterAllowed(db, stream) {
  const cutover = cutoverRow(db, stream);
  if (cutover && LEGACY_WRITER_DISABLED_STATUSES.has(cutover.status) && Number(cutover.legacy_writer_enabled) === 0) {
    throw boundaryError("LEGACY_WRITER_RETIRED", `legacy authoritative writer is disabled for ${stream.domain}/${stream.streamKey}`);
  }
  return true;
}

export function assertLegacyCurrentMarkerReaderAllowed(db, stream) {
  const cutover = cutoverRow(db, stream);
  if (cutover && LEGACY_WRITER_DISABLED_STATUSES.has(cutover.status)) {
    throw boundaryError("LEGACY_READER_RETIRED", `legacy current marker is not authoritative for ${stream.domain}/${stream.streamKey}`);
  }
  return true;
}

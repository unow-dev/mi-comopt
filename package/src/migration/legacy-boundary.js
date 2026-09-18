const LEGACY_WRITER_DISABLED_STATUSES = new Set(["cutover", "legacy_read_compatibility", "retired"]);
const GLOBAL_LEGACY_DISABLED_STATES = new Set(["legacy_disabled", "v3_enabled", "smoke_verified", "v3_frozen"]);

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

function globalCutoverRow(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v3_cutover_control'").get();
  if (!table) return null;
  return db.prepare("SELECT state, legacy_writer_enabled FROM v3_cutover_control WHERE control_id = 'comment-data-update'").get() ?? null;
}

export function assertLegacyWriterAllowed(db, stream) {
  const global = globalCutoverRow(db);
  if (global && GLOBAL_LEGACY_DISABLED_STATES.has(global.state) && Number(global.legacy_writer_enabled) === 0) {
    throw boundaryError("LEGACY_WRITER_RETIRED", `legacy authoritative writer is disabled by v3 cutover for ${stream.domain}/${stream.streamKey}`);
  }
  const cutover = cutoverRow(db, stream);
  if (cutover && LEGACY_WRITER_DISABLED_STATUSES.has(cutover.status) && Number(cutover.legacy_writer_enabled) === 0) {
    throw boundaryError("LEGACY_WRITER_RETIRED", `legacy authoritative writer is disabled for ${stream.domain}/${stream.streamKey}`);
  }
  return true;
}

export function assertLegacyCurrentMarkerReaderAllowed(db, stream) {
  const global = globalCutoverRow(db);
  if (global && GLOBAL_LEGACY_DISABLED_STATES.has(global.state)) {
    throw boundaryError("LEGACY_READER_RETIRED", `legacy current marker is not authoritative after v3 cutover for ${stream.domain}/${stream.streamKey}`);
  }
  const cutover = cutoverRow(db, stream);
  if (cutover && LEGACY_WRITER_DISABLED_STATUSES.has(cutover.status)) {
    throw boundaryError("LEGACY_READER_RETIRED", `legacy current marker is not authoritative for ${stream.domain}/${stream.streamKey}`);
  }
  return true;
}

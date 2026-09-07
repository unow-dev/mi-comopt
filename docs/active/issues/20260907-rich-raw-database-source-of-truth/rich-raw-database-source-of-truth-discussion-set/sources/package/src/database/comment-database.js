import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RAW_ROOT,
  ensureRawSnapshotStored,
  parseAndValidateRawSnapshotBytes,
  rawSnapshotRelativePath,
} from "../raw-snapshot/raw-snapshot-contract.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(moduleDirectory, "../..");
export const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "..");
export const DEFAULT_DB_PATH = path.join(REPOSITORY_ROOT, "var", "comment-history.sqlite3");
export const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "db", "comment-database");
export const APPLICATION_SCHEMA_VERSION = 2;

const migrations = [
  { version: 1, filename: "001-init.sql" },
  { version: 2, filename: "002-raw-snapshots.sql" },
];
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const normalizedPayloadKeys = ["schemaVersion", "observations"];
const observationKeys = ["source", "postRef", "collectedAt", "commentText"];

export class CommentDatabaseError extends Error {
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`, options);
    this.name = "CommentDatabaseError";
    this.code = code;
  }
}

function validationError(message) {
  return new CommentDatabaseError("VALIDATION_ERROR", message);
}

function assertExactKeys(value, expectedKeys, context) {
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw validationError(`${context} must contain exactly: ${expectedKeys.join(", ")}`);
  }
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeCollectedAt(value, index = null) {
  const location = index === null ? "collectedAt" : `observation ${index} collectedAt`;
  const match = timestampPattern.exec(value);
  if (!match) {
    throw validationError(`${location} must be RFC 3339-compatible with an explicit timezone and at most 3 fractional digits`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    throw validationError(`${location} is not a real date/time`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError(`${location} is not a real date/time`);
  }
  return parsed.toISOString();
}

export function validateAndNormalizePayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("root must be an object");
  }
  assertExactKeys(payload, normalizedPayloadKeys, "root");

  if (payload.schemaVersion !== 1 || !Number.isInteger(payload.schemaVersion)) {
    throw validationError("schemaVersion must be the integer 1");
  }
  if (!Array.isArray(payload.observations)) {
    throw validationError("observations must be an array");
  }

  const observations = payload.observations.map((observation, index) => {
    if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
      throw validationError(`observation ${index} must be an object`);
    }
    assertExactKeys(observation, observationKeys, `observation ${index}`);

    for (const field of ["source", "postRef", "collectedAt", "commentText"]) {
      if (typeof observation[field] !== "string") {
        throw validationError(`observation ${index} ${field} must be a string`);
      }
    }
    if (observation.source.trim().length === 0) {
      throw validationError(`observation ${index} source must contain a non-whitespace character`);
    }
    if (observation.postRef.trim().length === 0) {
      throw validationError(`observation ${index} postRef must contain a non-whitespace character`);
    }

    return {
      source: observation.source,
      postRef: observation.postRef,
      collectedAt: normalizeCollectedAt(observation.collectedAt, index),
      commentText: observation.commentText,
    };
  });

  return { schemaVersion: 1, observations };
}

export function computePayloadSha256(observations) {
  const sortedObservationStrings = observations
    .map(({ source, postRef, collectedAt, commentText }) => JSON.stringify([
      source,
      postRef,
      collectedAt,
      commentText,
    ]))
    .sort();
  const canonicalPayload = JSON.stringify([1, sortedObservationStrings]);
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

export function normalizePayloadBytes(bytes) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new CommentDatabaseError("VALIDATION_ERROR", `input is not valid JSON: ${error.message}`);
  }

  const normalized = validateAndNormalizePayload(payload);
  return {
    ...normalized,
    payloadSha256: computePayloadSha256(normalized.observations),
  };
}

export function resolveDatabasePath(dbPath) {
  if (dbPath === undefined || dbPath === null) return DEFAULT_DB_PATH;
  if (dbPath === ":memory:") return dbPath;
  return path.resolve(dbPath);
}

function readUserVersion(db) {
  const row = db.prepare("PRAGMA user_version").get();
  return Number(row.user_version);
}

function ensureForeignKeys(db) {
  db.exec("PRAGMA foreign_keys = ON");
  const row = db.prepare("PRAGMA foreign_keys").get();
  if (Number(row.foreign_keys) !== 1) {
    throw new CommentDatabaseError("SQLITE_FOREIGN_KEYS_DISABLED", "SQLite foreign-key enforcement could not be enabled");
  }
}

function rollbackQuietly(db) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // Preserve the original migration/import error.
  }
}

function applyMigrations(db, currentVersion) {
  const pendingMigrations = migrations.filter(({ version }) => version > currentVersion);
  for (const migration of pendingMigrations) {
    const migrationPath = path.join(MIGRATIONS_DIR, migration.filename);
    let sql;
    try {
      sql = readMigrationSql(migrationPath);
    } catch (error) {
      throw new CommentDatabaseError("MIGRATION_READ_FAILED", `${migrationPath}: ${error.message}`);
    }

    let transactionStarted = false;
    try {
      db.exec("BEGIN");
      transactionStarted = true;
      db.exec(sql);
      if (readUserVersion(db) !== migration.version) {
        throw new Error(`migration did not set PRAGMA user_version to ${migration.version}`);
      }
      db.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) rollbackQuietly(db);
      throw new CommentDatabaseError("MIGRATION_FAILED", `${migration.filename}: ${error.message}`);
    }
  }
}

function readMigrationSql(migrationPath) {
  // This synchronous read keeps migration application ordered and makes the transaction boundary explicit.
  // The migration files are small, immutable repository assets.
  return readFileSync(migrationPath, "utf8");
}

export async function openCommentDatabase(dbPath = undefined) {
  const isMemoryDatabase = dbPath === ":memory:";
  const resolvedPath = resolveDatabasePath(dbPath);
  if (!isMemoryDatabase) {
    try {
      await mkdir(path.dirname(resolvedPath), { recursive: true });
    } catch (error) {
      throw new CommentDatabaseError("DATABASE_PATH_FAILED", `${resolvedPath}: ${error.message}`);
    }
  }

  let db;
  try {
    db = new DatabaseSync(resolvedPath);
    ensureForeignKeys(db);
    const currentVersion = readUserVersion(db);
    if (currentVersion > APPLICATION_SCHEMA_VERSION) {
      throw new CommentDatabaseError(
        "SCHEMA_VERSION_UNSUPPORTED",
        `database user_version ${currentVersion} is newer than supported version ${APPLICATION_SCHEMA_VERSION}`,
      );
    }
    if (currentVersion < APPLICATION_SCHEMA_VERSION) {
      applyMigrations(db, currentVersion);
    }
    return db;
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Preserve the database error.
    }
    if (error instanceof CommentDatabaseError) throw error;
    throw new CommentDatabaseError("DATABASE_OPEN_FAILED", `${resolvedPath}: ${error.message}`);
  }
}

export async function importNormalizedPayload(payload, options = {}) {
  const normalized = validateAndNormalizePayload(payload);
  return importValidatedPayload({
    ...normalized,
    payloadSha256: computePayloadSha256(normalized.observations),
  }, options);
}

export async function importNormalizedPayloadFile(inputPath, options = {}) {
  let bytes;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    throw new CommentDatabaseError("INPUT_READ_FAILED", `${inputPath}: ${error.message}`);
  }
  return importValidatedPayload(normalizePayloadBytes(bytes), options);
}

async function importValidatedPayload(normalized, options) {
  const db = await openCommentDatabase(options.dbPath);
  try {
    const existing = db.prepare(
      "SELECT observation_count FROM imports WHERE payload_sha256 = ?",
    ).get(normalized.payloadSha256);
    if (existing !== undefined) {
      return {
        status: "already-imported",
        payloadSha256: normalized.payloadSha256,
        observationCount: Number(existing.observation_count),
      };
    }

    const importedAt = new Date().toISOString();
    let transactionStarted = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const importResult = db.prepare(
        `INSERT INTO imports
          (payload_sha256, imported_at, schema_version, observation_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(payload_sha256) DO NOTHING`,
      ).run(
        normalized.payloadSha256,
        importedAt,
        normalized.schemaVersion,
        normalized.observations.length,
      );
      if (Number(importResult.changes) === 0) {
        const racedExisting = db.prepare(
          "SELECT observation_count FROM imports WHERE payload_sha256 = ?",
        ).get(normalized.payloadSha256);
        if (racedExisting === undefined) {
          throw new Error("payload insert was ignored but no existing import was found");
        }
        db.exec("COMMIT");
        transactionStarted = false;
        return {
          status: "already-imported",
          payloadSha256: normalized.payloadSha256,
          observationCount: Number(racedExisting.observation_count),
        };
      }
      const importId = importResult.lastInsertRowid;
      const insertObservation = db.prepare(
        `INSERT INTO comment_observations
          (import_id, source_index, source, post_ref, collected_at, comment_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      normalized.observations.forEach((observation, sourceIndex) => {
        insertObservation.run(
          importId,
          sourceIndex,
          observation.source,
          observation.postRef,
          observation.collectedAt,
          observation.commentText,
        );
      });
      db.exec("COMMIT");
      transactionStarted = false;
      return {
        status: "imported",
        payloadSha256: normalized.payloadSha256,
        observationCount: normalized.observations.length,
      };
    } catch (error) {
      if (transactionStarted) rollbackQuietly(db);
      throw new CommentDatabaseError("IMPORT_FAILED", error.message);
    }
  } catch (error) {
    if (error instanceof CommentDatabaseError) throw error;
    throw new CommentDatabaseError("DATABASE_QUERY_FAILED", error.message);
  } finally {
    try {
      db.close();
    } catch {
      // The import result or primary database error is more useful to the operator.
    }
  }
}

export { DEFAULT_RAW_ROOT };

const rawErrorCodes = new Set([
  "VALIDATION_ERROR",
  "INPUT_READ_FAILED",
  "RAW_STORE_WRITE_FAILED",
  "RAW_STORE_CORRUPT",
]);

function preserveRawError(error) {
  if (error instanceof CommentDatabaseError) return error;
  if (rawErrorCodes.has(error?.code)) {
    return new CommentDatabaseError(error.code, error.message, { cause: error });
  }
  return new CommentDatabaseError("IMPORT_FAILED", error instanceof Error ? error.message : String(error), { cause: error });
}

function databaseIntegrityError(message) {
  return new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", message);
}

function getOrCreateVideo(db, externalVideoId) {
  db.prepare(
    `INSERT INTO videos (platform, external_video_id)
     VALUES (?, ?)
     ON CONFLICT(platform, external_video_id) DO NOTHING`,
  ).run("tiktok", externalVideoId);
  const row = db.prepare(
    "SELECT video_pk FROM videos WHERE platform = ? AND external_video_id = ?",
  ).get("tiktok", externalVideoId);
  if (row === undefined) throw new Error(`video master was not found after insert: ${externalVideoId}`);
  return row.video_pk;
}

function getOrCreateAuthor(db, externalAuthorId) {
  db.prepare(
    `INSERT INTO authors (platform, external_author_id)
     VALUES (?, ?)
     ON CONFLICT(platform, external_author_id) DO NOTHING`,
  ).run("tiktok", externalAuthorId);
  const row = db.prepare(
    "SELECT author_pk FROM authors WHERE platform = ? AND external_author_id = ?",
  ).get("tiktok", externalAuthorId);
  if (row === undefined) throw new Error(`author master was not found after insert: ${externalAuthorId}`);
  return row.author_pk;
}

function getOrCreateComment(db, videoPk, externalCommentId) {
  db.prepare(
    `INSERT INTO comments (video_pk, external_comment_id)
     VALUES (?, ?)
     ON CONFLICT(video_pk, external_comment_id) DO NOTHING`,
  ).run(videoPk, externalCommentId);
  const row = db.prepare(
    "SELECT comment_pk FROM comments WHERE video_pk = ? AND external_comment_id = ?",
  ).get(videoPk, externalCommentId);
  if (row === undefined) throw new Error(`comment master was not found after insert: ${externalCommentId}`);
  return row.comment_pk;
}

function assertExistingRawSnapshotIntegrity(db, existing, expectedRawRelpath, expectedLoadedCount) {
  if (existing.raw_relpath !== expectedRawRelpath) {
    throw databaseIntegrityError(
      `snapshot ${existing.payload_sha256} has unexpected raw_relpath ${existing.raw_relpath}`,
    );
  }
  const observationCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM snapshot_comment_observations WHERE snapshot_id = ?",
  ).get(existing.snapshot_id).count);
  if (Number(existing.loaded_count) !== observationCount || Number(existing.loaded_count) !== expectedLoadedCount) {
    throw databaseIntegrityError(
      `snapshot ${existing.payload_sha256} loaded_count=${existing.loaded_count} does not match observations=${observationCount}`,
    );
  }
  const videoObservationCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM snapshot_video_observations WHERE snapshot_id = ?",
  ).get(existing.snapshot_id).count);
  if (videoObservationCount !== 1) {
    throw databaseIntegrityError(
      `snapshot ${existing.payload_sha256} must have exactly one video observation, found ${videoObservationCount}`,
    );
  }
}

export async function importRawSnapshotFile(inputPath, options = {}) {
  let bytes;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    throw new CommentDatabaseError("INPUT_READ_FAILED", `${inputPath}: ${error.message}`);
  }
  return importRawSnapshotBytes(bytes, options);
}

export async function importRawSnapshotBytes(bytes, options = {}) {
  let parsed;
  try {
    parsed = parseAndValidateRawSnapshotBytes(bytes);
  } catch (error) {
    throw preserveRawError(error);
  }

  try {
    await ensureRawSnapshotStored(bytes, parsed.payloadSha256, options.rawRoot);
  } catch (error) {
    throw preserveRawError(error);
  }

  const db = await openCommentDatabase(options.dbPath);
  const payload = parsed.payload;
  const rawRelpath = rawSnapshotRelativePath(parsed.payloadSha256);
  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    const existing = db.prepare(
      `SELECT snapshot_id, payload_sha256, raw_relpath, loaded_count
       FROM raw_snapshots WHERE payload_sha256 = ?`,
    ).get(parsed.payloadSha256);
    if (existing !== undefined) {
      assertExistingRawSnapshotIntegrity(db, existing, rawRelpath, payload.comments.items.length);
      db.exec("COMMIT");
      transactionStarted = false;
      return {
        status: "already-imported",
        payloadSha256: parsed.payloadSha256,
        commentCount: payload.comments.items.length,
        observationCount: payload.comments.items.length,
      };
    }

    const snapshotResult = db.prepare(
      `INSERT INTO raw_snapshots
        (platform, raw_schema_version, payload_sha256, raw_relpath,
         extracted_at, source_page_url, source_canonical_url, item_source,
         loaded_count, reported_count, coverage_note, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "tiktok",
      payload.schemaVersion,
      parsed.payloadSha256,
      rawRelpath,
      payload.extractedAt,
      payload.source.pageUrl,
      payload.source.canonicalUrl,
      payload.source.itemSource,
      payload.comments.loadedCount,
      payload.comments.reportedCount,
      payload.comments.note,
      new Date().toISOString(),
    );
    const snapshotId = snapshotResult.lastInsertRowid;

    const videoPk = parsed.effectiveVideoId === null
      ? null
      : getOrCreateVideo(db, parsed.effectiveVideoId);
    const authorPk = payload.author.id === ""
      ? null
      : getOrCreateAuthor(db, payload.author.id);

    db.prepare(
      `INSERT INTO snapshot_video_observations
        (snapshot_id, video_pk, author_pk, video_id_raw, canonical_url, title,
         description, published_at, published_date, region_code, duration,
         view_count, like_count, comment_count, share_count, favorite_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshotId,
      videoPk,
      authorPk,
      payload.video.id,
      payload.video.canonicalUrl,
      payload.video.title,
      payload.video.description,
      payload.video.publishedAt,
      payload.video.publishedDate,
      payload.video.regionCode,
      payload.video.duration,
      payload.stats.viewCount,
      payload.stats.likeCount,
      payload.stats.commentCount,
      payload.stats.shareCount,
      payload.stats.favoriteCount,
    );

    const insertObservation = db.prepare(
      `INSERT INTO snapshot_comment_observations
        (snapshot_id, source_index, comment_pk, level, comment_id_raw,
         video_id_raw, parent_comment_id_raw, username, handle, user_id_raw,
         comment_text, posted_at, created_at, posted_date, like_count, reply_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    payload.comments.items.forEach((comment, sourceIndex) => {
      const commentPk = videoPk !== null && comment.commentId !== ""
        ? getOrCreateComment(db, videoPk, comment.commentId)
        : null;
      insertObservation.run(
        snapshotId,
        sourceIndex,
        commentPk,
        comment.level,
        comment.commentId,
        comment.videoId,
        comment.parentCommentId,
        comment.username,
        comment.handle,
        comment.userId,
        comment.comment,
        comment.postedAt,
        comment.createdAt,
        comment.postedDate,
        comment.likeCount,
        comment.replyCount,
      );
    });

    const insertedObservationCount = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM snapshot_comment_observations WHERE snapshot_id = ?",
    ).get(snapshotId).count);
    if (insertedObservationCount !== payload.comments.loadedCount) {
      throw databaseIntegrityError(
        `snapshot ${parsed.payloadSha256} loaded_count=${payload.comments.loadedCount} does not match observations=${insertedObservationCount}`,
      );
    }

    db.exec("COMMIT");
    transactionStarted = false;
    return {
      status: "imported",
      payloadSha256: parsed.payloadSha256,
      commentCount: payload.comments.items.length,
      observationCount: payload.comments.items.length,
    };
  } catch (error) {
    if (transactionStarted) rollbackQuietly(db);
    if (error instanceof CommentDatabaseError) throw error;
    throw new CommentDatabaseError("IMPORT_FAILED", error.message, { cause: error });
  } finally {
    try {
      db.close();
    } catch {
      // Preserve the import result or primary database error.
    }
  }
}

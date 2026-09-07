import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeRawPayloadSha256,
  parseAndValidateRawSnapshotBytes,
  rawSnapshotRelativePath,
} from "../raw-snapshot/raw-snapshot-contract.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(moduleDirectory, "../..");
export const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "..");
export const DEFAULT_DB_PATH = path.join(REPOSITORY_ROOT, "var", "comment-history.sqlite3");
export const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "db", "comment-database");
export const APPLICATION_SCHEMA_VERSION = 4;

const migrations = [
  { version: 1, filename: "001-init.sql" },
  { version: 2, filename: "002-raw-snapshots.sql" },
  {
    version: 3,
    filename: "003-rich-raw-inputs.sql",
    beginMode: "IMMEDIATE",
    prepare: prepareRichRawInputMigration,
    validate: validateRichRawInputMigration,
  },
  { version: 4, filename: "004-nullable-rich-metadata.sql" },
];
const LEGACY_RAW_INPUT_BACKFILL_TABLE = "legacy_raw_input_backfill";
const LEGACY_INPUT_FORMAT = "tiktokRawSnapshot-1.0.0";
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

async function applyMigrations(db, currentVersion, migrationContext = {}) {
  const pendingMigrations = migrations.filter(({ version }) => version > currentVersion);
  for (const migration of pendingMigrations) {
    const migrationPath = path.join(MIGRATIONS_DIR, migration.filename);
    let sql;
    try {
      sql = readMigrationSql(migrationPath);
    } catch (error) {
      throw new CommentDatabaseError("MIGRATION_READ_FAILED", `${migrationPath}: ${error.message}`);
    }

    let preparedContext = migrationContext;
    if (migration.prepare !== undefined) {
      try {
        preparedContext = await migration.prepare(db, migrationContext);
      } catch (error) {
        if (error instanceof CommentDatabaseError) throw error;
        throw new CommentDatabaseError("MIGRATION_FAILED", `${migration.filename}: ${error.message}`, { cause: error });
      }
      if (preparedContext === undefined) preparedContext = migrationContext;
    }
    let transactionStarted = false;
    try {
      if (migration.prepare !== undefined && preparedContext?.afterPrepare !== undefined) {
        await preparedContext.afterPrepare(db, preparedContext);
      }
      db.exec(migration.beginMode === undefined ? "BEGIN" : `BEGIN ${migration.beginMode}`);
      transactionStarted = true;
      if (migration.validate !== undefined) {
        await migration.validate(db, preparedContext);
      }
      db.exec(sql);
      if (readUserVersion(db) !== migration.version) {
        throw new Error(`migration did not set PRAGMA user_version to ${migration.version}`);
      }
      db.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) rollbackQuietly(db);
      if (error instanceof CommentDatabaseError) throw error;
      throw new CommentDatabaseError("MIGRATION_FAILED", `${migration.filename}: ${error.message}`);
    }
  }
}

function readMigrationSql(migrationPath) {
  // This synchronous read keeps migration application ordered and makes the transaction boundary explicit.
  // The migration files are small, immutable repository assets.
  return readFileSync(migrationPath, "utf8");
}

function readLegacyRawSnapshotRows(db) {
  return db.prepare(
    `SELECT payload_sha256, raw_relpath, imported_at
     FROM raw_snapshots ORDER BY payload_sha256 ASC`,
  ).all();
}

function legacyMigrationMismatch(message) {
  return new CommentDatabaseError("LEGACY_RAW_INPUT_MISMATCH", message);
}

async function prepareRichRawInputMigration(db, migrationContext) {
  const sourceRows = readLegacyRawSnapshotRows(db);
  if (sourceRows.length > 0 && migrationContext.rawRoot === undefined) {
    throw new CommentDatabaseError(
      "RAW_INPUT_BACKFILL_REQUIRED",
      "populated v2 raw snapshots require explicit legacy raw backfill",
    );
  }

  const stagedRows = [];
  if (sourceRows.length > 0) {
    const rawRoot = path.resolve(migrationContext.rawRoot);
    for (const row of sourceRows) {
      let expectedRelpath;
      try {
        expectedRelpath = rawSnapshotRelativePath(row.payload_sha256);
      } catch (error) {
        throw legacyMigrationMismatch(
          `invalid legacy snapshot identity ${row.payload_sha256}: ${error.message}`,
        );
      }
      if (row.raw_relpath !== expectedRelpath) {
        throw legacyMigrationMismatch(
          `legacy raw_relpath ${row.raw_relpath} does not match ${expectedRelpath}`,
        );
      }

      const filePath = path.join(rawRoot, row.raw_relpath);
      let payloadBytes;
      try {
        payloadBytes = await readFile(filePath);
      } catch (error) {
        throw new CommentDatabaseError(
          "LEGACY_RAW_INPUT_MISSING",
          `legacy raw file is missing or unreadable for ${row.payload_sha256}: ${error.message}`,
          { cause: error },
        );
      }
      const actualSha = computeRawPayloadSha256(payloadBytes);
      if (actualSha !== row.payload_sha256) {
        throw legacyMigrationMismatch(
          `legacy raw file hash ${actualSha} does not match database SHA ${row.payload_sha256}`,
        );
      }
      stagedRows.push({
        payloadSha256: row.payload_sha256,
        rawRelpath: row.raw_relpath,
        payloadBytes,
        byteLength: payloadBytes.length,
      });
    }
  }

  db.exec(
    `CREATE TEMP TABLE ${LEGACY_RAW_INPUT_BACKFILL_TABLE} (
       payload_sha256 TEXT PRIMARY KEY,
       raw_relpath TEXT NOT NULL,
       payload_bytes BLOB NOT NULL,
       byte_length INTEGER NOT NULL
         CHECK (byte_length >= 0 AND byte_length = length(payload_bytes))
     ) STRICT`,
  );
  const insertStaged = db.prepare(
    `INSERT INTO temp.${LEGACY_RAW_INPUT_BACKFILL_TABLE}
      (payload_sha256, raw_relpath, payload_bytes, byte_length)
     VALUES (?, ?, ?, ?)`,
  );
  for (const row of stagedRows) {
    insertStaged.run(row.payloadSha256, row.rawRelpath, row.payloadBytes, row.byteLength);
  }

  return {
    ...migrationContext,
    sourceRows,
    stagedRows,
  };
}

function validateRichRawInputMigration(db, migrationContext) {
  const currentRows = readLegacyRawSnapshotRows(db);
  const expectedRows = migrationContext.sourceRows ?? [];
  if (currentRows.length !== expectedRows.length) {
    throw new CommentDatabaseError(
      "MIGRATION_SOURCE_CHANGED",
      "v2 raw snapshot row count changed during migration preparation",
    );
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const actual = currentRows[index];
    if (
      actual.payload_sha256 !== expected.payload_sha256 ||
      actual.raw_relpath !== expected.raw_relpath ||
      actual.imported_at !== expected.imported_at
    ) {
      throw new CommentDatabaseError(
        "MIGRATION_SOURCE_CHANGED",
        `v2 raw snapshot source changed for ${expected.payload_sha256}`,
      );
    }
  }
}

export async function openCommentDatabase(dbPath = undefined, options = {}) {
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
      await applyMigrations(db, currentVersion, options.migrationContext ?? {});
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

function databaseIntegrityError(message) {
  return new CommentDatabaseError("DATABASE_INTEGRITY_ERROR", message);
}

const rawInputKeys = ["payloadBytes", "inputFormat", "snapshots"];
const snapshotDtoKeys = [
  "platform",
  "extractedAt",
  "sourcePageUrl",
  "sourceCanonicalUrl",
  "itemSource",
  "loadedCount",
  "reportedCount",
  "coverageNote",
  "video",
  "comments",
];
const videoDtoKeys = [
  "externalVideoId",
  "externalAuthorId",
  "videoIdRaw",
  "canonicalUrl",
  "title",
  "description",
  "publishedAt",
  "publishedDate",
  "regionCode",
  "duration",
  "viewCount",
  "likeCount",
  "commentCount",
  "shareCount",
  "favoriteCount",
];
const commentDtoKeys = [
  "externalCommentId",
  "level",
  "commentIdRaw",
  "videoIdRaw",
  "parentCommentIdRaw",
  "username",
  "handle",
  "userIdRaw",
  "commentText",
  "postedAt",
  "createdAt",
  "postedDate",
  "likeCount",
  "replyCount",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertDtoKeys(value, expectedKeys, context) {
  if (!isRecord(value)) throw validationError(`${context} must be an object`);
  assertExactKeys(value, expectedKeys, context);
}

function assertDtoText(value, context) {
  if (typeof value !== "string") throw validationError(`${context} must be a string`);
}

function assertDtoNonEmptyText(value, context) {
  assertDtoText(value, context);
  if (value.length === 0) throw validationError(`${context} must not be empty`);
}

function assertDtoNullableText(value, context, requireNonEmpty = false) {
  if (value === null) return;
  if (requireNonEmpty) {
    assertDtoNonEmptyText(value, context);
  } else {
    assertDtoText(value, context);
  }
}

function assertDtoInteger(value, context) {
  if (!Number.isSafeInteger(value)) throw validationError(`${context} must be a safe integer`);
}

function assertDtoNullableInteger(value, context) {
  if (value !== null) assertDtoInteger(value, context);
}

function assertDtoNumber(value, context) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`${context} must be a finite number`);
  }
}

function assertDtoNullableNumber(value, context) {
  if (value !== null) assertDtoNumber(value, context);
}

function validateSnapshotDto(snapshot, snapshotIndex) {
  const context = `snapshot ${snapshotIndex}`;
  assertDtoKeys(snapshot, snapshotDtoKeys, context);
  assertDtoNonEmptyText(snapshot.platform, `${context}.platform`);
  for (const field of ["extractedAt", "sourcePageUrl", "sourceCanonicalUrl", "itemSource", "coverageNote"]) {
    assertDtoText(snapshot[field], `${context}.${field}`);
  }
  assertDtoInteger(snapshot.loadedCount, `${context}.loadedCount`);
  assertDtoNullableInteger(snapshot.reportedCount, `${context}.reportedCount`);
  if (!Array.isArray(snapshot.comments)) throw validationError(`${context}.comments must be an array`);
  if (snapshot.loadedCount !== snapshot.comments.length) {
    throw validationError(
      `${context}.loadedCount (${snapshot.loadedCount}) must equal comments.length (${snapshot.comments.length})`,
    );
  }

  assertDtoKeys(snapshot.video, videoDtoKeys, `${context}.video`);
  assertDtoNullableText(snapshot.video.externalVideoId, `${context}.video.externalVideoId`, true);
  assertDtoNullableText(snapshot.video.externalAuthorId, `${context}.video.externalAuthorId`, true);
  for (const field of [
    "videoIdRaw", "canonicalUrl", "title", "description", "publishedAt", "publishedDate", "regionCode",
  ]) {
    assertDtoText(snapshot.video[field], `${context}.video.${field}`);
  }
  assertDtoNullableNumber(snapshot.video.duration, `${context}.video.duration`);
  for (const field of ["viewCount", "likeCount", "commentCount", "shareCount", "favoriteCount"]) {
    assertDtoNullableInteger(snapshot.video[field], `${context}.video.${field}`);
  }

  snapshot.comments.forEach((comment, commentIndex) => {
    const commentContext = `${context}.comments[${commentIndex}]`;
    assertDtoKeys(comment, commentDtoKeys, commentContext);
    assertDtoNullableText(comment.externalCommentId, `${commentContext}.externalCommentId`, true);
    assertDtoInteger(comment.level, `${commentContext}.level`);
    for (const field of [
      "commentIdRaw", "videoIdRaw", "parentCommentIdRaw", "username", "handle", "userIdRaw",
      "commentText", "postedAt", "createdAt", "postedDate",
    ]) {
      assertDtoText(comment[field], `${commentContext}.${field}`);
    }
    assertDtoNullableInteger(comment.likeCount, `${commentContext}.likeCount`);
    assertDtoNullableInteger(comment.replyCount, `${commentContext}.replyCount`);
  });
}

function validateRawInputRequest(request) {
  assertDtoKeys(request, rawInputKeys, "raw input");
  if (!(request.payloadBytes instanceof Uint8Array)) {
    throw validationError("raw input.payloadBytes must be a Uint8Array or Buffer");
  }
  assertDtoNonEmptyText(request.inputFormat, "raw input.inputFormat");
  if (!Array.isArray(request.snapshots) || request.snapshots.length < 1) {
    throw validationError("raw input.snapshots must contain at least one snapshot");
  }
  request.snapshots.forEach(validateSnapshotDto);
  return {
    payloadBytes: Buffer.from(request.payloadBytes),
    inputFormat: request.inputFormat,
    snapshots: request.snapshots,
  };
}

function getOrCreateVideo(db, platform, externalVideoId) {
  db.prepare(
    `INSERT INTO videos (platform, external_video_id)
     VALUES (?, ?)
     ON CONFLICT(platform, external_video_id) DO NOTHING`,
  ).run(platform, externalVideoId);
  const row = db.prepare(
    "SELECT video_pk FROM videos WHERE platform = ? AND external_video_id = ?",
  ).get(platform, externalVideoId);
  if (row === undefined) throw new Error(`video master was not found after insert: ${externalVideoId}`);
  return row.video_pk;
}

function getOrCreateAuthor(db, platform, externalAuthorId) {
  db.prepare(
    `INSERT INTO authors (platform, external_author_id)
     VALUES (?, ?)
     ON CONFLICT(platform, external_author_id) DO NOTHING`,
  ).run(platform, externalAuthorId);
  const row = db.prepare(
    "SELECT author_pk FROM authors WHERE platform = ? AND external_author_id = ?",
  ).get(platform, externalAuthorId);
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

function materializationConflict(message) {
  return new CommentDatabaseError("RAW_INPUT_MATERIALIZATION_CONFLICT", message);
}

function materializationForDto(snapshot, snapshotIndex) {
  return {
    snapshot: {
      platform: snapshot.platform,
      snapshotIndex,
      extractedAt: snapshot.extractedAt,
      sourcePageUrl: snapshot.sourcePageUrl,
      sourceCanonicalUrl: snapshot.sourceCanonicalUrl,
      itemSource: snapshot.itemSource,
      loadedCount: snapshot.loadedCount,
      reportedCount: snapshot.reportedCount,
      coverageNote: snapshot.coverageNote,
    },
    video: {
      externalVideoId: snapshot.video.externalVideoId,
      externalVideoPlatform: snapshot.video.externalVideoId === null ? null : snapshot.platform,
      externalAuthorId: snapshot.video.externalAuthorId,
      externalAuthorPlatform: snapshot.video.externalAuthorId === null ? null : snapshot.platform,
      videoIdRaw: snapshot.video.videoIdRaw,
      canonicalUrl: snapshot.video.canonicalUrl,
      title: snapshot.video.title,
      description: snapshot.video.description,
      publishedAt: snapshot.video.publishedAt,
      publishedDate: snapshot.video.publishedDate,
      regionCode: snapshot.video.regionCode,
      duration: snapshot.video.duration,
      viewCount: snapshot.video.viewCount,
      likeCount: snapshot.video.likeCount,
      commentCount: snapshot.video.commentCount,
      shareCount: snapshot.video.shareCount,
      favoriteCount: snapshot.video.favoriteCount,
    },
    comments: snapshot.comments.map((comment) => ({
      externalCommentId: snapshot.video.externalVideoId === null ? null : comment.externalCommentId,
      externalCommentVideoId: comment.externalCommentId === null || snapshot.video.externalVideoId === null
        ? null
        : snapshot.video.externalVideoId,
      externalCommentVideoPlatform: comment.externalCommentId === null || snapshot.video.externalVideoId === null
        ? null
        : snapshot.platform,
      level: comment.level,
      commentIdRaw: comment.commentIdRaw,
      videoIdRaw: comment.videoIdRaw,
      parentCommentIdRaw: comment.parentCommentIdRaw,
      username: comment.username,
      handle: comment.handle,
      userIdRaw: comment.userIdRaw,
      commentText: comment.commentText,
      postedAt: comment.postedAt,
      createdAt: comment.createdAt,
      postedDate: comment.postedDate,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
    })),
  };
}

function materializationForDatabase(db, snapshotRow) {
  const videoRows = db.prepare(
    `SELECT svo.video_pk, svo.author_pk, svo.video_id_raw, svo.canonical_url,
            svo.title, svo.description, svo.published_at, svo.published_date,
            svo.region_code, svo.duration, svo.view_count, svo.like_count,
            svo.comment_count, svo.share_count, svo.favorite_count,
            video.platform AS video_platform,
            video.external_video_id,
            author.platform AS author_platform,
            author.external_author_id
     FROM snapshot_video_observations AS svo
     LEFT JOIN videos AS video ON video.video_pk = svo.video_pk
     LEFT JOIN authors AS author ON author.author_pk = svo.author_pk
     WHERE svo.snapshot_id = ?`,
  ).all(snapshotRow.snapshot_id);
  const commentRows = db.prepare(
    `SELECT sco.source_index, sco.comment_pk, sco.level, sco.comment_id_raw,
            sco.video_id_raw, sco.parent_comment_id_raw, sco.username,
            sco.handle, sco.user_id_raw, sco.comment_text, sco.posted_at,
            sco.created_at, sco.posted_date, sco.like_count, sco.reply_count,
            comment.external_comment_id,
            comment_video.platform AS comment_video_platform,
            comment_video.external_video_id AS comment_video_id
     FROM snapshot_comment_observations AS sco
     LEFT JOIN comments AS comment ON comment.comment_pk = sco.comment_pk
     LEFT JOIN videos AS comment_video ON comment_video.video_pk = comment.video_pk
     WHERE sco.snapshot_id = ? ORDER BY sco.source_index ASC`,
  ).all(snapshotRow.snapshot_id);
  const video = videoRows.length === 1 ? videoRows[0] : null;
  return {
    snapshot: {
      platform: snapshotRow.platform,
      snapshotIndex: Number(snapshotRow.snapshot_index),
      extractedAt: snapshotRow.extracted_at,
      sourcePageUrl: snapshotRow.source_page_url,
      sourceCanonicalUrl: snapshotRow.source_canonical_url,
      itemSource: snapshotRow.item_source,
      loadedCount: Number(snapshotRow.loaded_count),
      reportedCount: snapshotRow.reported_count === null ? null : Number(snapshotRow.reported_count),
      coverageNote: snapshotRow.coverage_note,
    },
    video: video === null ? null : {
      externalVideoId: video.external_video_id ?? null,
      externalVideoPlatform: video.external_video_id === null || video.external_video_id === undefined
        ? null
        : video.video_platform,
      externalAuthorId: video.external_author_id ?? null,
      externalAuthorPlatform: video.external_author_id === null || video.external_author_id === undefined
        ? null
        : video.author_platform,
      videoIdRaw: video.video_id_raw,
      canonicalUrl: video.canonical_url,
      title: video.title,
      description: video.description,
      publishedAt: video.published_at,
      publishedDate: video.published_date,
      regionCode: video.region_code,
      duration: video.duration === null ? null : Number(video.duration),
      viewCount: video.view_count === null ? null : Number(video.view_count),
      likeCount: video.like_count === null ? null : Number(video.like_count),
      commentCount: video.comment_count === null ? null : Number(video.comment_count),
      shareCount: video.share_count === null ? null : Number(video.share_count),
      favoriteCount: video.favorite_count === null ? null : Number(video.favorite_count),
    },
    comments: commentRows.map((comment) => ({
      externalCommentId: comment.external_comment_id ?? null,
      externalCommentVideoId: comment.external_comment_id === null || comment.external_comment_id === undefined
        ? null
        : comment.comment_video_id,
      externalCommentVideoPlatform: comment.external_comment_id === null || comment.external_comment_id === undefined
        ? null
        : comment.comment_video_platform,
      level: Number(comment.level),
      commentIdRaw: comment.comment_id_raw,
      videoIdRaw: comment.video_id_raw,
      parentCommentIdRaw: comment.parent_comment_id_raw,
      username: comment.username,
      handle: comment.handle,
      userIdRaw: comment.user_id_raw,
      commentText: comment.comment_text,
      postedAt: comment.posted_at,
      createdAt: comment.created_at,
      postedDate: comment.posted_date,
      likeCount: comment.like_count === null ? null : Number(comment.like_count),
      replyCount: comment.reply_count === null ? null : Number(comment.reply_count),
    })),
  };
}

function assertSameMaterialization(expected, actual, payloadSha256, snapshotIndex) {
  if (actual.video === null || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw materializationConflict(
      `materialization differs for ${payloadSha256}:${snapshotIndex}`,
    );
  }
}

function assertStoredRawInputIntegrity(db, stored, payloadBytes, inputFormat) {
  const storedBytes = Buffer.from(stored.payload_bytes);
  if (
    computeRawPayloadSha256(storedBytes) !== stored.payload_sha256 ||
    Number(stored.byte_length) !== storedBytes.length
  ) {
    throw databaseIntegrityError(`raw input ${stored.payload_sha256} has invalid stored bytes or byte_length`);
  }
  if (!storedBytes.equals(payloadBytes) || stored.input_format !== inputFormat) {
    throw new CommentDatabaseError(
      "RAW_INPUT_CONFLICT",
      `raw input ${stored.payload_sha256} differs from the supplied bytes or input format`,
    );
  }
}

function assertExistingRawInputIntegrity(db, stored, request, payloadSha256) {
  assertStoredRawInputIntegrity(db, stored, request.payloadBytes, request.inputFormat);
  const snapshotRows = db.prepare(
    `SELECT snapshot_id, platform, payload_sha256, snapshot_index, extracted_at,
            source_page_url, source_canonical_url, item_source, loaded_count,
            reported_count, coverage_note
     FROM raw_snapshots
     WHERE payload_sha256 = ? ORDER BY snapshot_index ASC`,
  ).all(payloadSha256);
  if (snapshotRows.length !== request.snapshots.length) {
    throw materializationConflict(`snapshot count differs for ${payloadSha256}`);
  }
  request.snapshots.forEach((snapshot, snapshotIndex) => {
    const storedSnapshot = snapshotRows[snapshotIndex];
    const expected = materializationForDto(snapshot, snapshotIndex);
    const actual = materializationForDatabase(db, storedSnapshot);
    assertSameMaterialization(expected, actual, payloadSha256, snapshotIndex);
  });
}

function insertRawInputMaterialization(db, request, payloadSha256) {
  db.prepare(
    `INSERT INTO raw_inputs
      (payload_sha256, payload_bytes, byte_length, input_format, imported_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(payloadSha256, request.payloadBytes, request.payloadBytes.length, request.inputFormat, new Date().toISOString());

  const insertSnapshot = db.prepare(
    `INSERT INTO raw_snapshots
      (platform, payload_sha256, snapshot_index, extracted_at, source_page_url,
       source_canonical_url, item_source, loaded_count, reported_count, coverage_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertVideoObservation = db.prepare(
    `INSERT INTO snapshot_video_observations
      (snapshot_id, video_pk, author_pk, video_id_raw, canonical_url, title,
       description, published_at, published_date, region_code, duration,
       view_count, like_count, comment_count, share_count, favorite_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCommentObservation = db.prepare(
    `INSERT INTO snapshot_comment_observations
      (snapshot_id, source_index, comment_pk, level, comment_id_raw,
       video_id_raw, parent_comment_id_raw, username, handle, user_id_raw,
       comment_text, posted_at, created_at, posted_date, like_count, reply_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let commentObservationCount = 0;
  request.snapshots.forEach((snapshot, snapshotIndex) => {
    const snapshotResult = insertSnapshot.run(
      snapshot.platform,
      payloadSha256,
      snapshotIndex,
      snapshot.extractedAt,
      snapshot.sourcePageUrl,
      snapshot.sourceCanonicalUrl,
      snapshot.itemSource,
      snapshot.loadedCount,
      snapshot.reportedCount,
      snapshot.coverageNote,
    );
    const snapshotId = snapshotResult.lastInsertRowid;
    const videoPk = snapshot.video.externalVideoId === null
      ? null
      : getOrCreateVideo(db, snapshot.platform, snapshot.video.externalVideoId);
    const authorPk = snapshot.video.externalAuthorId === null
      ? null
      : getOrCreateAuthor(db, snapshot.platform, snapshot.video.externalAuthorId);
    insertVideoObservation.run(
      snapshotId,
      videoPk,
      authorPk,
      snapshot.video.videoIdRaw,
      snapshot.video.canonicalUrl,
      snapshot.video.title,
      snapshot.video.description,
      snapshot.video.publishedAt,
      snapshot.video.publishedDate,
      snapshot.video.regionCode,
      snapshot.video.duration,
      snapshot.video.viewCount,
      snapshot.video.likeCount,
      snapshot.video.commentCount,
      snapshot.video.shareCount,
      snapshot.video.favoriteCount,
    );

    snapshot.comments.forEach((comment, sourceIndex) => {
      const commentPk = videoPk !== null && comment.externalCommentId !== null
        ? getOrCreateComment(db, videoPk, comment.externalCommentId)
        : null;
      insertCommentObservation.run(
        snapshotId,
        sourceIndex,
        commentPk,
        comment.level,
        comment.commentIdRaw,
        comment.videoIdRaw,
        comment.parentCommentIdRaw,
        comment.username,
        comment.handle,
        comment.userIdRaw,
        comment.commentText,
        comment.postedAt,
        comment.createdAt,
        comment.postedDate,
        comment.likeCount,
        comment.replyCount,
      );
      commentObservationCount += 1;
    });

    const persistedCount = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM snapshot_comment_observations WHERE snapshot_id = ?",
    ).get(snapshotId).count);
    if (persistedCount !== snapshot.loadedCount) {
      throw databaseIntegrityError(
        `snapshot ${payloadSha256}:${snapshotIndex} loaded_count=${snapshot.loadedCount} does not match observations=${persistedCount}`,
      );
    }
  });
  return commentObservationCount;
}

export async function importRawInput(input, options = {}) {
  const request = validateRawInputRequest(input);
  const payloadSha256 = computeRawPayloadSha256(request.payloadBytes);
  const db = await openCommentDatabase(options.dbPath);
  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const existing = db.prepare(
      `SELECT payload_sha256, payload_bytes, byte_length, input_format, imported_at
       FROM raw_inputs WHERE payload_sha256 = ?`,
    ).get(payloadSha256);
    if (existing !== undefined) {
      assertExistingRawInputIntegrity(db, existing, request, payloadSha256);
      db.exec("COMMIT");
      transactionStarted = false;
      return {
        status: "already-imported",
        payloadSha256,
        snapshotCount: request.snapshots.length,
        commentObservationCount: request.snapshots.reduce((sum, snapshot) => sum + snapshot.comments.length, 0),
      };
    }

    const commentObservationCount = insertRawInputMaterialization(db, request, payloadSha256);
    db.exec("COMMIT");
    transactionStarted = false;
    return {
      status: "imported",
      payloadSha256,
      snapshotCount: request.snapshots.length,
      commentObservationCount,
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

function mapTikTokSnapshotToDto(parsed) {
  const { payload } = parsed;
  return {
    platform: "tiktok",
    extractedAt: payload.extractedAt,
    sourcePageUrl: payload.source.pageUrl,
    sourceCanonicalUrl: payload.source.canonicalUrl,
    itemSource: payload.source.itemSource,
    loadedCount: payload.comments.loadedCount,
    reportedCount: payload.comments.reportedCount,
    coverageNote: payload.comments.note,
    video: {
      externalVideoId: parsed.effectiveVideoId,
      externalAuthorId: payload.author.id === "" ? null : payload.author.id,
      videoIdRaw: payload.video.id,
      canonicalUrl: payload.video.canonicalUrl,
      title: payload.video.title,
      description: payload.video.description,
      publishedAt: payload.video.publishedAt,
      publishedDate: payload.video.publishedDate,
      regionCode: payload.video.regionCode,
      duration: payload.video.duration,
      viewCount: payload.stats.viewCount,
      likeCount: payload.stats.likeCount,
      commentCount: payload.stats.commentCount,
      shareCount: payload.stats.shareCount,
      favoriteCount: payload.stats.favoriteCount,
    },
    comments: payload.comments.items.map((comment) => ({
      externalCommentId: comment.commentId === "" ? null : comment.commentId,
      level: comment.level,
      commentIdRaw: comment.commentId,
      videoIdRaw: comment.videoId,
      parentCommentIdRaw: comment.parentCommentId,
      username: comment.username,
      handle: comment.handle,
      userIdRaw: comment.userId,
      commentText: comment.comment,
      postedAt: comment.postedAt,
      createdAt: comment.createdAt,
      postedDate: comment.postedDate,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
    })),
  };
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
    if (error instanceof CommentDatabaseError) throw error;
    throw new CommentDatabaseError("VALIDATION_ERROR", error.message, { cause: error });
  }
  const result = await importRawInput({
    payloadBytes: bytes,
    inputFormat: LEGACY_INPUT_FORMAT,
    snapshots: [mapTikTokSnapshotToDto(parsed)],
  }, options);
  return {
    ...result,
    commentCount: parsed.payload.comments.items.length,
    observationCount: parsed.payload.comments.items.length,
  };
}

export async function backfillRawInputs(options = {}) {
  if (!isRecord(options) || typeof options.dbPath !== "string" || options.dbPath.length === 0) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "backfillRawInputs requires dbPath");
  }
  if (typeof options.rawRoot !== "string" || options.rawRoot.length === 0) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "backfillRawInputs requires rawRoot");
  }

  const resolvedDbPath = resolveDatabasePath(options.dbPath);
  let previousVersion = 0;
  if (resolvedDbPath !== ":memory:" && existsSync(resolvedDbPath)) {
    const existingDb = new DatabaseSync(resolvedDbPath);
    try {
      previousVersion = readUserVersion(existingDb);
    } finally {
      existingDb.close();
    }
  }

  const db = await openCommentDatabase(resolvedDbPath, {
    migrationContext: {
      rawRoot: path.resolve(options.rawRoot),
      afterPrepare: options.afterPrepare,
    },
  });
  try {
    return {
      status: previousVersion >= APPLICATION_SCHEMA_VERSION ? "already-migrated" : "migrated",
      schemaVersion: readUserVersion(db),
    };
  } finally {
    db.close();
  }
}

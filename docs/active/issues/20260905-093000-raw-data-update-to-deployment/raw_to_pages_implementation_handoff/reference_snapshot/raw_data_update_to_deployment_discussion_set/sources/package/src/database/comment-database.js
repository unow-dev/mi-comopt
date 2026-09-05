import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(moduleDirectory, "../..");
export const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "..");
export const DEFAULT_DB_PATH = path.join(REPOSITORY_ROOT, "var", "comment-history.sqlite3");
export const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "db", "comment-database");
export const APPLICATION_SCHEMA_VERSION = 1;

const migrations = [
  { version: 1, filename: "001-init.sql" },
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

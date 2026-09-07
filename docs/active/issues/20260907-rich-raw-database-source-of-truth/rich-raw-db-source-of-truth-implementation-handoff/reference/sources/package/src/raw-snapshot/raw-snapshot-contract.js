import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync as readFileSyncBytes } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(moduleDirectory, "../..");
export const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "..");
export const RAW_SNAPSHOT_SCHEMA_PATH = path.join(
  PACKAGE_ROOT,
  "contracts",
  "raw-snapshots",
  "tiktokRawSnapshot-1.0.0.schema.json",
);
export const DEFAULT_RAW_ROOT = path.join(REPOSITORY_ROOT, "var", "raw-snapshots");
export const RAW_SNAPSHOT_RELATIVE_PREFIX = "tiktok-v1";

export class RawSnapshotContractError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "RawSnapshotContractError";
    this.code = code;
  }
}

export class RawSnapshotStoreError extends RawSnapshotContractError {}

const rawSnapshotSchema = JSON.parse(readFileSyncBytes(RAW_SNAPSHOT_SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validateSchema = ajv.compile(rawSnapshotSchema);

function validationError(message) {
  return new RawSnapshotContractError("VALIDATION_ERROR", message);
}

function formatSchemaErrors(errors) {
  return errors.map((error) => {
    const location = error.instancePath || "$";
    return `${location} ${error.message}`;
  }).join("; ");
}

export function validateRawSnapshot(payload) {
  if (!validateSchema(payload)) {
    throw validationError(`raw snapshot schema validation failed: ${formatSchemaErrors(validateSchema.errors ?? [])}`);
  }

  if (payload.comments.loadedCount !== payload.comments.items.length) {
    throw validationError(
      `comments.loadedCount (${payload.comments.loadedCount}) must equal comments.items.length (${payload.comments.items.length})`,
    );
  }

  const videoIds = new Set();
  if (payload.video.id !== "") videoIds.add(payload.video.id);
  for (const comment of payload.comments.items) {
    if (comment.videoId !== "") videoIds.add(comment.videoId);
  }
  if (videoIds.size > 1) {
    throw validationError("video.id and comment videoId values must identify at most one distinct video");
  }

  return payload;
}

export function getEffectiveVideoId(payload) {
  const videoIds = new Set();
  if (payload.video.id !== "") videoIds.add(payload.video.id);
  for (const comment of payload.comments.items) {
    if (comment.videoId !== "") videoIds.add(comment.videoId);
  }
  return videoIds.size === 0 ? null : [...videoIds][0];
}

export function computeRawPayloadSha256(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

export function parseAndValidateRawSnapshotBytes(bytes) {
  const inputBytes = Buffer.from(bytes);
  let jsonText;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(inputBytes);
  } catch (error) {
    throw validationError(`input is not valid UTF-8: ${error.message}`);
  }

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    throw validationError(`input is not valid JSON: ${error.message}`);
  }

  validateRawSnapshot(payload);
  return {
    payload,
    payloadSha256: computeRawPayloadSha256(inputBytes),
    effectiveVideoId: getEffectiveVideoId(payload),
  };
}

export function rawSnapshotRelativePath(payloadSha256) {
  if (!/^[0-9a-f]{64}$/.test(payloadSha256)) {
    throw new RawSnapshotContractError("VALIDATION_ERROR", "payload SHA must be 64 lowercase hexadecimal characters");
  }
  return `${RAW_SNAPSHOT_RELATIVE_PREFIX}/${payloadSha256}.json`;
}

export function resolveRawRoot(rawRoot = undefined) {
  if (rawRoot === undefined || rawRoot === null) return DEFAULT_RAW_ROOT;
  return path.resolve(rawRoot);
}

async function ensureExistingRawTarget(targetPath, payloadSha256) {
  let existingBytes;
  try {
    existingBytes = await readFile(targetPath);
  } catch (error) {
    throw new RawSnapshotStoreError(
      "RAW_STORE_CORRUPT",
      `existing raw target cannot be read: ${targetPath}: ${error.message}`,
    );
  }
  const existingSha = computeRawPayloadSha256(existingBytes);
  if (existingSha !== payloadSha256) {
    throw new RawSnapshotStoreError(
      "RAW_STORE_CORRUPT",
      `raw target hash ${existingSha} does not match pathname SHA ${payloadSha256}: ${targetPath}`,
    );
  }
  return { reused: true };
}

export async function ensureRawSnapshotStored(bytes, payloadSha256, rawRoot = undefined) {
  const inputBytes = Buffer.from(bytes);
  const actualSha = computeRawPayloadSha256(inputBytes);
  if (actualSha !== payloadSha256) {
    throw new RawSnapshotStoreError(
      "RAW_STORE_CORRUPT",
      `input bytes hash ${actualSha} does not match requested SHA ${payloadSha256}`,
    );
  }
  const root = resolveRawRoot(rawRoot);
  const rawRelpath = rawSnapshotRelativePath(payloadSha256);
  const targetPath = path.join(root, rawRelpath);
  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
  } catch (error) {
    throw new RawSnapshotStoreError("RAW_STORE_WRITE_FAILED", `${root}: ${error.message}`);
  }

  try {
    await writeFile(targetPath, inputBytes, { flag: "wx" });
    return { rawRelpath, targetPath, reused: false };
  } catch (error) {
    if (error.code === "EEXIST") {
      const result = await ensureExistingRawTarget(targetPath, payloadSha256);
      return { rawRelpath, targetPath, ...result };
    }
    throw new RawSnapshotStoreError("RAW_STORE_WRITE_FAILED", `${targetPath}: ${error.message}`);
  }
}

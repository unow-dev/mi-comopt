import { readFile, writeFile, mkdir, mkdtemp, rename, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCommentBatch } from "../src/collector/comment-batch/comment-batch-contract.js";

export const COMMENT_BATCH_FIELDS = Object.freeze([
  "username",
  "handle",
  "comment",
  "postedAt",
  "postedDate",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function conversionError(message) {
  const error = new Error(message);
  error.code = "CONVERSION_ERROR";
  return error;
}

/**
 * Convert an array of rich snapshot records into the strict five-field
 * tiktokCommentBatch-1.0.0 payload. Values and source order are preserved.
 */
export function convertRichSnapshotsToCommentBatch(payload) {
  if (!Array.isArray(payload)) {
    throw conversionError("rich snapshot input root must be an array");
  }

  const batch = [];
  payload.forEach((snapshot, snapshotIndex) => {
    if (!isRecord(snapshot)) {
      throw conversionError(`snapshot[${snapshotIndex}] must be an object`);
    }
    if (!isRecord(snapshot.comments) || !Array.isArray(snapshot.comments.items)) {
      throw conversionError(`snapshot[${snapshotIndex}].comments.items must be an array`);
    }

    snapshot.comments.items.forEach((comment, commentIndex) => {
      if (!isRecord(comment)) {
        throw conversionError(`snapshot[${snapshotIndex}].comments.items[${commentIndex}] must be an object`);
      }
      for (const field of COMMENT_BATCH_FIELDS) {
        if (typeof comment[field] !== "string") {
          throw conversionError(
            `snapshot[${snapshotIndex}].comments.items[${commentIndex}].${field} must be a string`,
          );
        }
      }
      batch.push(Object.fromEntries(COMMENT_BATCH_FIELDS.map((field) => [field, comment[field]])));
    });
  });

  validateCommentBatch(batch);
  return batch;
}

function parseArguments(argv) {
  const options = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if (argument === "--input" || argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      options[argument === "--input" ? "inputPath" : "outputPath"] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.inputPath || !options.outputPath) {
    throw new Error("--input and --output are required");
  }
  return options;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function convertRichCommentSnapshotFile({ inputPath, outputPath, force = false }) {
  const resolvedInputPath = path.resolve(inputPath);
  const resolvedOutputPath = path.resolve(outputPath);
  if (resolvedInputPath === resolvedOutputPath) {
    throw new Error("input and output must be different paths; preserve the rich source file");
  }
  if (!force && await pathExists(resolvedOutputPath)) {
    throw new Error(`${resolvedOutputPath} already exists; use --force to replace it`);
  }

  const inputBytes = await readFile(resolvedInputPath);
  let payload;
  try {
    payload = JSON.parse(inputBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${resolvedInputPath}: invalid JSON: ${error.message}`, { cause: error });
  }
  const batch = convertRichSnapshotsToCommentBatch(payload);
  const outputBytes = Buffer.from(`${JSON.stringify(batch, null, 2)}\n`, "utf8");

  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(resolvedOutputPath), ".comment-batch-convert-"));
  const temporaryPath = path.join(temporaryDirectory, path.basename(resolvedOutputPath));
  try {
    await writeFile(temporaryPath, outputBytes, { flag: "wx" });
    await rename(temporaryPath, resolvedOutputPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return {
    inputPath: resolvedInputPath,
    outputPath: resolvedOutputPath,
    sourceSnapshotCount: payload.length,
    outputCommentCount: batch.length,
    outputBytes: outputBytes.length,
  };
}

function usage() {
  return "Usage: npm run convert:comment-batch -- --input PATH --output PATH [--force]";
}

const scriptPath = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await convertRichCommentSnapshotFile(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`${error.code ? `${error.code}: ` : ""}${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

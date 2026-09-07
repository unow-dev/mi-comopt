import { readFile } from "node:fs/promises";
import { CommentDatabaseError, importRawInput } from "../../src/database/comment-database.js";
import { adaptCommentBatchBytes } from "../../src/collector/comment-batch/comment-batch-adapter.js";

export async function importCommentBatchFile(inputPath, options = {}) {
  let bytes;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    throw new CommentDatabaseError("INPUT_READ_FAILED", `${inputPath}: ${error.message}`);
  }
  const request = adaptCommentBatchBytes(bytes);
  return importRawInput(request, options);
}

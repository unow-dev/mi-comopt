import { readFile } from "node:fs/promises";
import { importRawInput, CommentDatabaseError } from "../../src/database/comment-database.js";
import { adaptNewCommentsWrapperBytes } from "../../src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js";

export async function importNewCommentsWrapperFile(inputPath, options = {}) {
  let bytes;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    throw new CommentDatabaseError("INPUT_READ_FAILED", `${inputPath}: ${error.message}`);
  }
  const request = adaptNewCommentsWrapperBytes(bytes);
  return importRawInput(request, options);
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(moduleDirectory, "../../..");
export const COMMENT_BATCH_INPUT_FORMAT = "tiktokCommentBatch-1.0.0";
export const COMMENT_BATCH_SCHEMA_PATH = path.join(
  PACKAGE_ROOT,
  "contracts",
  "collector-inputs",
  "tiktokCommentBatch-1.0.0.schema.json",
);

export class CommentBatchContractError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "CommentBatchContractError";
    this.code = code;
  }
}

const commentBatchSchema = JSON.parse(readFileSync(COMMENT_BATCH_SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(commentBatchSchema);

function validationError(message) {
  return new CommentBatchContractError("VALIDATION_ERROR", message);
}

function schemaPath(instancePath, params) {
  let location = instancePath === "" ? "$" : instancePath
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((result, part) => /^\d+$/.test(part) ? `${result}[${part}]` : `${result}.${part}`, "")
    .replace(/^\./, "") || "$";
  if (params?.missingProperty !== undefined) location += `.${params.missingProperty}`;
  if (params?.additionalProperty !== undefined) location += `.${params.additionalProperty}`;
  return location;
}

function formatSchemaErrors(errors) {
  return errors.map((error) => `${schemaPath(error.instancePath, error.params)} ${error.message}`).join("; ");
}

export function validateCommentBatch(payload) {
  if (!validateSchema(payload)) {
    throw validationError(`comment batch schema validation failed: ${formatSchemaErrors(validateSchema.errors ?? [])}`);
  }
  return payload;
}

export function parseAndValidateCommentBatchBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw validationError("input bytes must be a Uint8Array or Buffer");
  }
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

  return { payload: validateCommentBatch(payload) };
}

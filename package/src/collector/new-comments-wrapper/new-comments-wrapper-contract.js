import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(moduleDirectory, "../../..");
export const NEW_COMMENTS_WRAPPER_INPUT_FORMAT = "tiktokNewCommentsWrapper-1.0.0";
export const NEW_COMMENTS_WRAPPER_SCHEMA_PATH = path.join(
  PACKAGE_ROOT,
  "contracts",
  "collector-inputs",
  "tiktokNewCommentsWrapper-1.0.0.schema.json",
);

export class NewCommentsWrapperContractError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "NewCommentsWrapperContractError";
    this.code = code;
  }
}

const wrapperSchema = JSON.parse(readFileSync(NEW_COMMENTS_WRAPPER_SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validateSchema = ajv.compile(wrapperSchema);

function validationError(message) {
  return new NewCommentsWrapperContractError("VALIDATION_ERROR", message);
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

function assertWrapperShape(payload) {
  if (!validateSchema(payload)) {
    throw validationError(`new comments wrapper schema validation failed: ${formatSchemaErrors(validateSchema.errors ?? [])}`);
  }
  if (payload.items.length < 1) {
    throw validationError("items must contain at least one item");
  }
}

function effectiveVideoIds(item) {
  const values = [];
  if (item.video.id !== "") values.push({ path: "video.id", value: item.video.id });
  item.comments.items.forEach((comment, commentIndex) => {
    if (comment.videoId !== "") {
      values.push({ path: `comments.items[${commentIndex}].videoId`, value: comment.videoId });
    }
  });
  return values;
}

export function getEffectiveVideoId(item) {
  const ids = new Set(effectiveVideoIds(item).map(({ value }) => value));
  return ids.size === 0 ? null : [...ids][0];
}

function validateWrapperSemantics(payload) {
  payload.items.forEach((item, itemIndex) => {
    if (item.comments.loadedCount !== item.comments.items.length) {
      throw validationError(
        `items[${itemIndex}].comments.loadedCount (${item.comments.loadedCount}) must equal `
        + `items[${itemIndex}].comments.items.length (${item.comments.items.length})`,
      );
    }

    const ids = effectiveVideoIds(item);
    const distinctIds = new Set(ids.map(({ value }) => value));
    if (distinctIds.size > 1) {
      const locations = ids.filter(({ value }, index) => ids.findIndex((candidate) => candidate.value === value) === index)
        .map(({ path }) => `items[${itemIndex}].${path}`)
        .join(", ");
      throw validationError(
        `items[${itemIndex}] contains conflicting non-empty video IDs at ${locations}`,
      );
    }
  });
}

export function validateNewCommentsWrapper(payload) {
  assertWrapperShape(payload);
  validateWrapperSemantics(payload);
  return payload;
}

export function parseAndValidateNewCommentsWrapperBytes(bytes) {
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

  validateNewCommentsWrapper(payload);
  return { payload };
}

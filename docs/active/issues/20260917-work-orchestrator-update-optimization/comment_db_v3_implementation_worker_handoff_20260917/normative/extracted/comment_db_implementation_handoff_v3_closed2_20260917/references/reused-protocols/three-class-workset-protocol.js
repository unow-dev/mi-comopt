import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

export const PROTOCOL_VERSION = "three-class-workset-v1";
export const LABELS = Object.freeze(["direct_nuisance", "reactive", "normal"]);
export const LABEL_SET = new Set(LABELS);
export const ITEM_ID_PATTERN = /^I[1-9][0-9]*$/;
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ARCHIVE_MEMBER_NAMES = Object.freeze([
  "PROMPT.md",
  "RULES.md",
  "HISTORY.json",
  "ITEMS.json",
  "response.schema.json",
]);

export class ProtocolValidationError extends Error {
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`, options);
    this.name = "ProtocolValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProtocolValidationError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertExactKeys(value, expectedKeys, context, code = "PROTOCOL_INVALID") {
  if (!isRecord(value)) fail(code, `${context} must be an object`);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    fail(code, `${context} must contain exactly: ${expectedKeys.join(", ")}`);
  }
}

class StrictJsonParser {
  constructor(text, description) {
    this.text = text;
    this.description = description;
    this.index = 0;
  }

  error(message) {
    throw new ProtocolValidationError(
      "INVALID_JSON",
      `${this.description} at offset ${this.index}: ${message}`,
    );
  }

  skipWhitespace() {
    while (this.index < this.text.length && /[\u0020\u0009\u000a\u000d]/.test(this.text[this.index])) {
      this.index += 1;
    }
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) this.error("unexpected trailing data");
    return value;
  }

  parseValue() {
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t" && this.consumeLiteral("true")) return true;
    if (character === "f" && this.consumeLiteral("false")) return false;
    if (character === "n" && this.consumeLiteral("null")) return null;
    if (character === "-" || /[0-9]/.test(character ?? "")) return this.parseNumber();
    this.error("expected a JSON value");
  }

  consumeLiteral(literal) {
    if (this.text.startsWith(literal, this.index)) {
      this.index += literal.length;
      return true;
    }
    return false;
  }

  parseObject() {
    this.index += 1;
    const result = Object.create(null);
    const keys = new Set();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.error("object keys must be strings");
      const key = this.parseString();
      if (keys.has(key)) this.error(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.error("expected ':' after object key");
      this.index += 1;
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.error("expected ',' or '}' in object");
      this.index += 1;
    }
  }

  parseArray() {
    this.index += 1;
    const result = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.error("expected ',' or ']' in array");
      this.index += 1;
    }
  }

  parseString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        const raw = this.text.slice(start, this.index + 1);
        this.index += 1;
        try {
          return JSON.parse(raw);
        } catch (error) {
          this.error(`invalid string: ${error.message}`);
        }
      }
      if (code === 0x5c) {
        this.index += 1;
        if (this.index >= this.text.length) this.error("unterminated escape");
        const escaped = this.text[this.index];
        if (escaped === "u") {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error("invalid Unicode escape");
          this.index += 5;
        } else if (!["\"", "\\", "/", "b", "f", "n", "r", "t"].includes(escaped)) {
          this.error(`invalid escape ${JSON.stringify(escaped)}`);
        } else {
          this.index += 1;
        }
        continue;
      }
      if (code < 0x20) this.error("unescaped control character in string");
      this.index += 1;
    }
    this.error("unterminated string");
  }

  parseNumber() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.text.slice(this.index),
    );
    if (match === null) this.error("invalid number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.error("number is outside supported range");
    return value;
  }
}

export function parseStrictJson(input, description = "JSON") {
  let text;
  try {
    text = typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch (error) {
    throw new ProtocolValidationError("INVALID_JSON", `${description} is not valid UTF-8`, { cause: error });
  }
  return new StrictJsonParser(text, description).parse();
}

export async function readStrictJsonFile(filePath, description = filePath) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    throw new ProtocolValidationError("INVALID_JSON", `${description} could not be read: ${error.message}`, { cause: error });
  }
  return parseStrictJson(bytes, description);
}

function validateLabel(label, context, code) {
  if (typeof label !== "string" || !LABEL_SET.has(label)) {
    fail(code, `${context} has an invalid label`);
  }
}

export function validateHistory(value, { deduplicate = false } = {}) {
  const code = "INVALID_HISTORY";
  assertExactKeys(value, ["protocol_version", "items"], "HISTORY.json", code);
  if (value.protocol_version !== PROTOCOL_VERSION) {
    fail(code, `HISTORY.json protocol_version must be ${PROTOCOL_VERSION}`);
  }
  if (!Array.isArray(value.items)) fail(code, "HISTORY.json items must be an array");

  const seen = new Map();
  const items = [];
  for (const [index, item] of value.items.entries()) {
    assertExactKeys(item, ["comment", "label"], `HISTORY.json items[${index}]`, code);
    if (typeof item.comment !== "string") {
      fail(code, `HISTORY.json items[${index}].comment must be a string`);
    }
    validateLabel(item.label, `HISTORY.json items[${index}]`, code);
    if (seen.has(item.comment)) {
      if (seen.get(item.comment) !== item.label) {
        fail(code, `HISTORY.json contains conflicting labels for an exact comment at index ${index}`);
      }
      if (deduplicate) continue;
    } else {
      seen.set(item.comment, item.label);
    }
    items.push({ comment: item.comment, label: item.label });
  }
  return { protocol_version: PROTOCOL_VERSION, items };
}

export function validateItems(value) {
  const code = "INVALID_ITEMS";
  assertExactKeys(value, ["protocol_version", "workset_id", "items"], "ITEMS.json", code);
  if (value.protocol_version !== PROTOCOL_VERSION) {
    fail(code, `ITEMS.json protocol_version must be ${PROTOCOL_VERSION}`);
  }
  if (typeof value.workset_id !== "string" || !UUID_V4_PATTERN.test(value.workset_id)) {
    fail(code, "ITEMS.json workset_id must be a UUID v4");
  }
  if (!Array.isArray(value.items)) fail(code, "ITEMS.json items must be an array");

  const ids = new Set();
  const comments = new Set();
  for (const [index, item] of value.items.entries()) {
    assertExactKeys(item, ["id", "comment"], `ITEMS.json items[${index}]`, code);
    if (typeof item.id !== "string" || !ITEM_ID_PATTERN.test(item.id)) {
      fail(code, `ITEMS.json items[${index}].id has invalid syntax`);
    }
    if (ids.has(item.id)) fail(code, `ITEMS.json contains duplicate item id ${item.id}`);
    ids.add(item.id);
    if (typeof item.comment !== "string") {
      fail(code, `ITEMS.json items[${index}].comment must be a string`);
    }
    if (comments.has(item.comment)) {
      fail(code, "ITEMS.json contains duplicate comments");
    }
    comments.add(item.comment);
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    workset_id: value.workset_id,
    items: value.items.map((item) => ({ id: item.id, comment: item.comment })),
  };
}

export function buildResponseSchema(worksetId) {
  if (typeof worksetId !== "string" || !UUID_V4_PATTERN.test(worksetId)) {
    throw new ProtocolValidationError("INVALID_SCHEMA", "cannot build a schema for an invalid UUID v4");
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["workset_id", "decisions"],
    additionalProperties: false,
    properties: {
      workset_id: { const: worksetId },
      decisions: {
        type: "object",
        propertyNames: { pattern: "^I[1-9][0-9]*$" },
        additionalProperties: { enum: LABELS.slice() },
      },
    },
  };
}

export function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !Object.hasOwn(right, key))) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

export function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function assertValidWorksetArchiveMembers(names) {
  const expected = new Set(ARCHIVE_MEMBER_NAMES);
  if (names.length !== ARCHIVE_MEMBER_NAMES.length || new Set(names).size !== names.length) {
    fail("ARCHIVE_INVALID", "workset ZIP must contain exactly five unique members");
  }
  if (names.some((name) => !expected.has(name))) {
    fail("ARCHIVE_INVALID", "workset ZIP contains an unexpected member");
  }
  return ARCHIVE_MEMBER_NAMES;
}


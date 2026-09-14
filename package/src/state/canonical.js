import { createHash, randomUUID } from "node:crypto";

export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not accept non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonicalize(value[key])]));
  }
  throw new TypeError("canonical JSON does not accept undefined or functions");
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value
    : Buffer.from(typeof value === "string" ? value : canonicalJson(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

export function semanticSha256(value) {
  return sha256Hex(value);
}

export function prefixedSha256(value) {
  return `sha256:${sha256Hex(value)}`;
}

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function deterministicId(prefix, seed) {
  return `${prefix}_${sha256Hex(String(seed)).slice(0, 32)}`;
}

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function isoNow(clock = () => new Date()) {
  const value = clock();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

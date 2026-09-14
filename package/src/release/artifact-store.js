import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { canonicalJson, prefixedSha256 } from "../state/canonical.js";

function bytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.from(canonicalJson(value), "utf8");
}

export class MemoryReleaseArtifactStore {
  constructor() { this.blobs = new Map(); }

  write({ releaseId, artifactKey, content }) {
    const data = bytes(content);
    const record = { releaseId, artifactKey, path: `releases/${releaseId}/${artifactKey}`, sha256: prefixedSha256(data), byteLength: data.length, content: Buffer.from(data) };
    this.blobs.set(`${releaseId}/${artifactKey}`, record);
    return { ...record, content: undefined };
  }

  read({ releaseId, artifactKey }) { return this.blobs.get(`${releaseId}/${artifactKey}`)?.content ?? null; }

  has({ releaseId, artifactKey, sha256 = undefined }) {
    const record = this.blobs.get(`${releaseId}/${artifactKey}`);
    return Boolean(record && (sha256 === undefined || record.sha256 === sha256));
  }
}

export class FileReleaseArtifactStore {
  constructor(root) { this.root = path.resolve(root); mkdirSync(this.root, { recursive: true }); }

  filePath(releaseId, artifactKey) { return path.join(this.root, "releases", releaseId, `${artifactKey}.bin`); }

  write({ releaseId, artifactKey, content }) {
    const data = bytes(content);
    const target = this.filePath(releaseId, artifactKey);
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, data, { flag: "wx" });
    renameSync(temporary, target);
    return { releaseId, artifactKey, path: path.relative(this.root, target).split(path.sep).join("/"), sha256: prefixedSha256(data), byteLength: data.length };
  }

  read({ releaseId, artifactKey }) {
    const target = this.filePath(releaseId, artifactKey);
    return existsSync(target) ? readFileSync(target) : null;
  }

  has({ releaseId, artifactKey, sha256 = undefined }) {
    const data = this.read({ releaseId, artifactKey });
    return Boolean(data && (sha256 === undefined || prefixedSha256(data) === sha256));
  }
}

export function normalizeArtifactBytes(value) { return bytes(value); }

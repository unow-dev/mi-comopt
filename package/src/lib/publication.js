import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prettyJson } from "./candidate-workflow.js";

function currentPath(rootDir) {
  return path.join(rootDir, "current");
}

export function resolveCurrentPublicationDir(rootDir) {
  return fs.realpathSync(currentPath(path.resolve(rootDir)));
}

function readCurrentMeta(rootDir) {
  const file = path.join(currentPath(rootDir), "filterKeywordCandidates.meta.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertFreshParent(rootDir, baseRunId, baseRegistryContentSha256) {
  const current = readCurrentMeta(rootDir);
  if (!current) {
    if (baseRunId !== null && baseRunId !== undefined) {
      const stale = new Error("current publication is missing");
      stale.code = "STALE_PARENT";
      throw stale;
    }
    return;
  }
  if (current.run_id !== baseRunId || current.registry_content_sha256 !== baseRegistryContentSha256) {
    const stale = new Error("current publication parent changed");
    stale.code = "STALE_PARENT";
    throw stale;
  }
}

function writeStagedFiles(stageDir, files) {
  for (const [relativePath, value] of Object.entries(files)) {
    const destination = path.join(stageDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const body = typeof value === "string" ? value : prettyJson(value);
    fs.writeFileSync(destination, body, "utf8");
  }
}

/**
 * Immutable publication directory + atomic `current` symlink promotion.
 * currentの読者は常に1つの完成済みrunだけを見るため、複数JSONの途中状態を観測しません。
 */
export function publishBundleAtomically({ rootDir, runId, baseRunId, baseRegistryContentSha256, files }) {
  fs.mkdirSync(rootDir, { recursive: true });
  const lockPath = path.join(rootDir, ".publication.lock");
  let stageDir;
  try {
    fs.mkdirSync(lockPath);
    assertFreshParent(rootDir, baseRunId, baseRegistryContentSha256);
    const publicationsDir = path.join(rootDir, "publications");
    fs.mkdirSync(publicationsDir, { recursive: true });
    stageDir = fs.mkdtempSync(path.join(rootDir, ".publication-stage-"));
    writeStagedFiles(stageDir, files);
    const publicationDir = path.join(publicationsDir, runId);
    if (fs.existsSync(publicationDir)) {
      const duplicate = new Error(`publication already exists: ${runId}`);
      duplicate.code = "DUPLICATE_RUN_ID";
      throw duplicate;
    }
    fs.renameSync(stageDir, publicationDir);
    stageDir = undefined;

    const nextLink = path.join(rootDir, `.current-${crypto.randomUUID()}`);
    fs.symlinkSync(path.relative(rootDir, publicationDir), nextLink, "dir");
    fs.renameSync(nextLink, currentPath(rootDir));
    return { publicationDir, currentDir: currentPath(rootDir) };
  } finally {
    if (stageDir && fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
    if (fs.existsSync(lockPath)) fs.rmdirSync(lockPath);
  }
}

export function readCurrentPublication(rootDir) {
  const current = currentPath(rootDir);
  if (!fs.existsSync(current)) return null;
  const result = {};
  for (const name of fs.readdirSync(current)) {
    const file = path.join(current, name);
    if (name.endsWith(".json")) result[name] = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return result;
}

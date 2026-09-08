import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import {
  CommentDatabaseError,
  REPOSITORY_ROOT,
  openCommentDatabase,
} from "../../src/database/comment-database.js";
import {
  readSelectedSnapshots,
  resolveSelectedSnapshotRefs,
} from "../../src/database/raw-snapshot-repository.js";
import { buildAnalysisArtifacts } from "../../src/processing/analysis-input/raw-snapshot-projection.js";

const PIPELINE_PATH = path.join(
  REPOSITORY_ROOT,
  "docs",
  "active",
  "operations",
  "Integrated_Labeling_Handoff_v1.5.0",
  "src",
  "pipeline.py",
);
const PACKAGER_PATH = path.join(REPOSITORY_ROOT, "package", "scripts", "pack-three-class-workset.py");
const README_TEMPLATE_PATH = path.join(REPOSITORY_ROOT, "package", "templates", "three-class-workset", "README_FIRST.md");
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function worksetError(code, message, options = {}) {
  return new CommentDatabaseError(code, message, options);
}

async function assertAbsent(target, code, description) {
  try {
    await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw worksetError(code, `${description} cannot be inspected: ${target}: ${error.message}`, { cause: error });
  }
  throw worksetError(code, `${description} already exists: ${target}`);
}

async function assertRegularFile(target, description) {
  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    throw worksetError("INTEGRITY_MISMATCH", `${description} is unavailable: ${target}: ${error.message}`, { cause: error });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw worksetError("INTEGRITY_MISMATCH", `${description} must be a regular file: ${target}`);
  }
}

function parseJsonObject(bytes, description) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw worksetError("INTEGRITY_MISMATCH", `${description} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw worksetError("INTEGRITY_MISMATCH", `${description} must be a JSON object`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runPython(args, description) {
  const executable = process.env.TIKTOK_FILTER_KEYWORDS_PYTHON ?? process.env.PYTHON ?? "python3";
  const result = spawnSync(executable, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw worksetError("PIPELINE_INVOCATION_FAILED", `${description} could not be started: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw worksetError(
      description === "pipeline" ? "PIPELINE_INVOCATION_FAILED" : "PACKAGING_FAILED",
      `${description} failed with exit code ${result.status}${details ? `: ${details}` : ""}`,
    );
  }
  return result.stdout;
}

function parseSubprocessJson(stdout, description) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw worksetError(
      description === "pipeline" ? "PIPELINE_INVOCATION_FAILED" : "PACKAGING_FAILED",
      `${description} did not return a JSON object: ${error.message}`,
      { cause: error },
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw worksetError(
      description === "pipeline" ? "PIPELINE_INVOCATION_FAILED" : "PACKAGING_FAILED",
      `${description} did not return a JSON object`,
    );
  }
  return value;
}

async function writeExclusive(target, bytes, description) {
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    throw worksetError("INTEGRITY_MISMATCH", `${description} could not be written: ${target}: ${error.message}`, { cause: error });
  }
}

async function verifyPipelineBinding(stagingWorkspace, pipelineResult, inputBytes) {
  const snapshotInput = path.join(stagingWorkspace, "snapshot", "input.json");
  const requestManifestPath = path.join(stagingWorkspace, "request", "manifest.json");
  const receiptPath = path.join(stagingWorkspace, "prepare_receipt.json");
  for (const [target, description] of [
    [snapshotInput, "pipeline snapshot/input.json"],
    [requestManifestPath, "request manifest"],
    [receiptPath, "prepare receipt"],
  ]) {
    await assertRegularFile(target, description);
  }

  const snapshotInputBytes = await readFile(snapshotInput);
  if (!snapshotInputBytes.equals(inputBytes)) {
    throw worksetError("INTEGRITY_MISMATCH", "pipeline snapshot/input.json differs from the DB analysis projection");
  }
  const requestManifest = parseJsonObject(await readFile(requestManifestPath), "request manifest");
  const receipt = parseJsonObject(await readFile(receiptPath), "prepare receipt");
  const inputSha = sha256(inputBytes);
  if (requestManifest.bindings?.input_sha256 !== inputSha) {
    throw worksetError("INTEGRITY_MISMATCH", "request manifest input binding differs from the DB analysis projection");
  }
  if (receipt.bindings?.input_sha256 !== inputSha) {
    throw worksetError("INTEGRITY_MISMATCH", "prepare receipt input binding differs from the DB analysis projection");
  }
  const requestId = requestManifest.request_id;
  if (!SHA256_PATTERN.test(requestId ?? "") || receipt.request_id !== requestId || pipelineResult.request_id !== requestId) {
    throw worksetError("INTEGRITY_MISMATCH", "pipeline request_id bindings do not agree");
  }
  if (pipelineResult.workspace !== undefined && path.resolve(pipelineResult.workspace) !== path.resolve(stagingWorkspace)) {
    throw worksetError("INTEGRITY_MISMATCH", "pipeline returned an unexpected workspace path");
  }
  return { requestId, state: pipelineResult.state ?? receipt.state };
}

export async function generateThreeClassWorkset({
  dbPath,
  snapshotRefs = [],
  snapshotShas = [],
  referencePath,
  workspacePath,
  stateDir,
}) {
  if (typeof referencePath !== "string" || referencePath.length === 0) {
    throw worksetError("VALIDATION_ERROR", "referencePath is required");
  }
  if (typeof workspacePath !== "string" || workspacePath.length === 0) {
    throw worksetError("VALIDATION_ERROR", "workspacePath is required");
  }
  const finalWorkspace = path.resolve(workspacePath);
  await assertAbsent(finalWorkspace, "WORKSPACE_EXISTS", "workspace");
  await mkdir(path.dirname(finalWorkspace), { recursive: true });

  let db;
  let stagingRoot;
  try {
    db = await openCommentDatabase(dbPath);
    const resolvedRefs = resolveSelectedSnapshotRefs(db, { snapshotRefs, snapshotShas });
    const selectedSnapshots = readSelectedSnapshots(db, resolvedRefs);
    const artifacts = buildAnalysisArtifacts(selectedSnapshots);
    const inputBytes = Buffer.from(artifacts.outputJson, "utf8");
    const manifestBytes = Buffer.from(artifacts.manifestJson, "utf8");
    if (sha256(inputBytes) !== artifacts.manifest.output_sha256) {
      throw worksetError("INTEGRITY_MISMATCH", "analysis projection output hash does not match its manifest");
    }
    stagingRoot = await mkdtemp(path.join(path.dirname(finalWorkspace), `.${path.basename(finalWorkspace)}.workset-`));
    const stagingInput = path.join(stagingRoot, "analysis_input.json");
    const stagingManifest = path.join(stagingRoot, "analysis_input.manifest.json");
    await writeExclusive(stagingInput, inputBytes, "analysis projection");
    await writeExclusive(stagingManifest, manifestBytes, "analysis projection manifest");
    const stagingWorkspace = path.join(stagingRoot, "workspace");
    const pipelineArgs = [
      PIPELINE_PATH,
      "prepare-single-roundtrip",
      stagingInput,
      "--reference",
      path.resolve(referencePath),
      "--workspace",
      stagingWorkspace,
    ];
    if (stateDir !== undefined) pipelineArgs.push("--state-dir", path.resolve(stateDir));
    const pipelineResult = parseSubprocessJson(runPython(pipelineArgs, "pipeline"), "pipeline");
    const binding = await verifyPipelineBinding(stagingWorkspace, pipelineResult, inputBytes);

    const readmeBytes = await readFile(README_TEMPLATE_PATH);
    await writeExclusive(path.join(stagingWorkspace, "README_FIRST.md"), readmeBytes, "workset README");
    await mkdir(path.join(stagingWorkspace, "provenance"));
    await writeExclusive(path.join(stagingWorkspace, "provenance", "analysis_input.json"), inputBytes, "provenance analysis input");
    await writeExclusive(path.join(stagingWorkspace, "provenance", "analysis_input.manifest.json"), manifestBytes, "provenance analysis manifest");

    const packagingResult = parseSubprocessJson(
      runPython([PACKAGER_PATH, "--workspace", stagingWorkspace], "packager"),
      "packager",
    );
    if (!SHA256_PATTERN.test(packagingResult.workset_id ?? "") || packagingResult.request_id !== binding.requestId) {
      throw worksetError("INTEGRITY_MISMATCH", "packager identity bindings are invalid");
    }
    const expectedZipPath = path.join(stagingWorkspace, `three_class_workset_${packagingResult.workset_id}.zip`);
    const expectedManifestPath = path.join(stagingWorkspace, "workset_manifest.json");
    if (path.resolve(packagingResult.zip_path ?? "") !== path.resolve(expectedZipPath)) {
      throw worksetError("PACKAGING_FAILED", "packager returned an unexpected ZIP path");
    }
    if (path.resolve(packagingResult.manifest_path ?? "") !== path.resolve(expectedManifestPath)) {
      throw worksetError("PACKAGING_FAILED", "packager returned an unexpected manifest path");
    }
    await assertRegularFile(expectedZipPath, "workset ZIP");
    await assertRegularFile(expectedManifestPath, "workset manifest");
    const worksetManifest = parseJsonObject(await readFile(expectedManifestPath), "workset manifest");
    if (worksetManifest.workset_id !== packagingResult.workset_id || worksetManifest.request_id !== binding.requestId) {
      throw worksetError("INTEGRITY_MISMATCH", "workset manifest identity bindings are invalid");
    }

    const result = {
      requestId: binding.requestId,
      worksetId: packagingResult.workset_id,
      state: binding.state,
      workspacePath: finalWorkspace,
      zipPath: path.join(finalWorkspace, path.basename(expectedZipPath)),
      manifestPath: path.join(finalWorkspace, "workset_manifest.json"),
    };
    await rename(stagingWorkspace, finalWorkspace);
    return result;
  } catch (error) {
    if (error instanceof CommentDatabaseError) throw error;
    throw worksetError("WORKSET_GENERATION_FAILED", error.message, { cause: error });
  } finally {
    if (db !== undefined) db.close();
    if (stagingRoot !== undefined) await rm(stagingRoot, { recursive: true, force: true });
  }
}

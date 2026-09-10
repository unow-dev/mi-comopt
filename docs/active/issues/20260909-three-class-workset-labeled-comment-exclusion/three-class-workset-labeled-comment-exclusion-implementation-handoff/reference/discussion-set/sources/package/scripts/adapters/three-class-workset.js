import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
import {
  insertObservationLabel,
  readExistingCommentLabels,
  readExistingTargetLabels,
  readTargetObservations,
  readWorksetSnapshotRefs,
  registerWorkset,
  worksetExists,
} from "../../src/database/three-class-label-repository.js";
import { buildAnalysisArtifacts } from "../../src/processing/analysis-input/raw-snapshot-projection.js";
import {
  ARCHIVE_MEMBER_NAMES,
  ProtocolValidationError,
  assertExactKeys,
  assertValidWorksetArchiveMembers,
  buildResponseSchema,
  deepEqual,
  parseStrictJson,
  readStrictJsonFile,
  serializeJson,
  validateHistory,
  validateItems,
  LABEL_SET,
  ITEM_ID_PATTERN,
  UUID_V4_PATTERN,
  PROTOCOL_VERSION,
} from "../../src/three-class-workset/protocol.js";

const PACKAGER_PATH = path.join(REPOSITORY_ROOT, "package", "scripts", "pack-three-class-workset.py");
const PROMPT_TEMPLATE_PATH = path.join(REPOSITORY_ROOT, "package", "templates", "three-class-workset", "PROMPT.md");
const RULES_TEMPLATE_PATH = path.join(REPOSITORY_ROOT, "package", "templates", "three-class-workset", "RULES.md");

function worksetError(code, message, options = {}) {
  return new CommentDatabaseError(code, message, options);
}

function buildThreeClassItems(records) {
  const seenComments = new Set();
  const items = [];
  for (const record of records) {
    if (typeof record.comment !== "string") {
      throw worksetError("DATABASE_INTEGRITY_ERROR", "projected record comment must be a string");
    }
    if (seenComments.has(record.comment)) continue;
    seenComments.add(record.comment);
    items.push({ id: `I${items.length + 1}`, comment: record.comment });
  }
  return items;
}

function withImmediateTransaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  let committed = false;
  try {
    const result = action();
    db.exec("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
    }
  }
}

function rethrowProtocol(error) {
  if (error instanceof ProtocolValidationError) {
    const prefix = `${error.code}: `;
    const message = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
    throw worksetError(error.code, message, { cause: error });
  }
  throw error;
}

async function assertAbsent(target, description) {
  try {
    await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw worksetError("OUTPUT_WRITE_FAILED", `${description} cannot be inspected: ${target}: ${error.message}`, { cause: error });
  }
  throw worksetError("OUTPUT_WRITE_FAILED", `refusing to overwrite ${description}: ${target}`);
}

async function assertRegularFile(target, description) {
  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    throw worksetError("ARCHIVE_INVALID", `${description} is unavailable: ${target}: ${error.message}`, { cause: error });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw worksetError("ARCHIVE_INVALID", `${description} must be a regular file: ${target}`);
  }
}

function pythonExecutable() {
  return process.env.TIKTOK_FILTER_KEYWORDS_PYTHON ?? process.env.PYTHON ?? "python3";
}

function runPython(args, failureCode, description) {
  const result = spawnSync(pythonExecutable(), args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw worksetError(failureCode, `${description} could not be started: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw worksetError(failureCode, `${description} failed with exit code ${result.status}${details ? `: ${details}` : ""}`);
  }
  return result.stdout;
}

function parseSubprocessJson(stdout, failureCode, description) {
  try {
    const value = JSON.parse(stdout);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected an object");
    }
    return value;
  } catch (error) {
    throw worksetError(failureCode, `${description} returned invalid JSON: ${error.message}`, { cause: error });
  }
}

async function writeExclusive(target, bytes, description) {
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    throw worksetError("OUTPUT_WRITE_FAILED", `${description} could not be written: ${target}: ${error.message}`, { cause: error });
  }
}

function archiveBytesFromInspection(value) {
  if (value === null || typeof value !== "object" || !Array.isArray(value.members)) {
    throw worksetError("ARCHIVE_INVALID", "archive inspector returned no member list");
  }
  const entries = new Map();
  for (const member of value.members) {
    if (
      member === null
      || typeof member !== "object"
      || typeof member.name !== "string"
      || typeof member.data !== "string"
    ) {
      throw worksetError("ARCHIVE_INVALID", "archive inspector returned an invalid member");
    }
    if (entries.has(member.name)) throw worksetError("ARCHIVE_INVALID", `duplicate ZIP member: ${member.name}`);
    entries.set(member.name, Buffer.from(member.data, "base64"));
  }
  return entries;
}

function inspectArchive(worksetPath) {
  const stdout = runPython(
    [PACKAGER_PATH, "inspect", "--input", worksetPath],
    "ARCHIVE_INVALID",
    "workset ZIP inspection",
  );
  return archiveBytesFromInspection(parseSubprocessJson(stdout, "ARCHIVE_INVALID", "workset ZIP inspection"));
}

function requireArchiveMembers(entries) {
  try {
    assertValidWorksetArchiveMembers([...entries.keys()]);
  } catch (error) {
    rethrowProtocol(error);
  }
}

function requireJson(value, description) {
  try {
    return parseStrictJson(value, description);
  } catch (error) {
    rethrowProtocol(error);
  }
}

async function readCanonicalTemplates() {
  try {
    return {
      prompt: await readFile(PROMPT_TEMPLATE_PATH),
      rules: await readFile(RULES_TEMPLATE_PATH),
    };
  } catch (error) {
    throw worksetError("TEMPLATE_MISMATCH", `canonical v1 templates could not be read: ${error.message}`, { cause: error });
  }
}

function validateWorksetContents(entries, templates) {
  requireArchiveMembers(entries);
  if (!entries.get("PROMPT.md").equals(templates.prompt)) {
    throw worksetError("TEMPLATE_MISMATCH", "PROMPT.md does not match the canonical v1 prompt");
  }
  if (!entries.get("RULES.md").equals(templates.rules)) {
    throw worksetError("TEMPLATE_MISMATCH", "RULES.md does not match the canonical v1 rules");
  }

  let history;
  let items;
  let bundledSchema;
  try {
    history = validateHistory(requireJson(entries.get("HISTORY.json"), "HISTORY.json"));
  } catch (error) {
    rethrowProtocol(error);
  }
  try {
    items = validateItems(requireJson(entries.get("ITEMS.json"), "ITEMS.json"));
  } catch (error) {
    rethrowProtocol(error);
  }
  try {
    bundledSchema = requireJson(entries.get("response.schema.json"), "response.schema.json");
  } catch (error) {
    rethrowProtocol(error);
  }
  let expectedSchema;
  try {
    expectedSchema = buildResponseSchema(items.workset_id);
  } catch (error) {
    rethrowProtocol(error);
  }
  if (!deepEqual(bundledSchema, expectedSchema)) {
    throw worksetError("INVALID_SCHEMA", "bundled response.schema.json does not match the local v1 schema");
  }
  return {
    history,
    items,
    schema: expectedSchema,
    worksetId: items.workset_id,
    itemIds: new Set(items.items.map((item) => item.id)),
  };
}

export async function validateWorksetArchive(worksetPath) {
  await assertRegularFile(worksetPath, "workset ZIP");
  const entries = inspectArchive(worksetPath);
  const templates = await readCanonicalTemplates();
  return validateWorksetContents(entries, templates);
}

function validateResponseValue(response, workset) {
  try {
    assertExactKeys(response, ["workset_id", "decisions"], "response.json", "INVALID_RESPONSE");
  } catch (error) {
    rethrowProtocol(error);
  }
  if (response.workset_id !== workset.worksetId) {
    throw worksetError("WORKSET_ID_MISMATCH", "response workset_id does not match ITEMS.json");
  }
  if (response.decisions === null || typeof response.decisions !== "object" || Array.isArray(response.decisions)) {
    throw worksetError("INVALID_RESPONSE", "response decisions must be an object");
  }
  const decisionIds = Object.keys(response.decisions);
  for (const id of decisionIds) {
    if (!ITEM_ID_PATTERN.test(id)) throw worksetError("INVALID_RESPONSE", `invalid response item id: ${id}`);
    if (!LABEL_SET.has(response.decisions[id])) {
      throw worksetError("INVALID_RESPONSE", `invalid response label for ${id}`);
    }
  }
  if (decisionIds.length !== workset.itemIds.size || decisionIds.some((id) => !workset.itemIds.has(id))) {
    throw worksetError("DECISION_COVERAGE_MISMATCH", "response decisions must exactly cover ITEMS.json IDs");
  }
  return response;
}

async function readValidatedThreeClassSubmission({ worksetPath, responsePath }) {
  const workset = await validateWorksetArchive(worksetPath);
  let response;
  try {
    await assertRegularFile(responsePath, "response JSON");
    response = parseStrictJson(await readFile(responsePath), "response.json");
  } catch (error) {
    if (error instanceof CommentDatabaseError) throw error;
    if (error instanceof ProtocolValidationError) rethrowProtocol(error);
    throw worksetError("INVALID_RESPONSE", `response JSON could not be read: ${error.message}`, { cause: error });
  }
  validateResponseValue(response, workset);
  return { workset, response };
}

export async function validateThreeClassResponse({ worksetPath, responsePath }) {
  const { workset, response } = await readValidatedThreeClassSubmission({ worksetPath, responsePath });
  return {
    worksetId: workset.worksetId,
    decisionCount: Object.keys(response.decisions).length,
  };
}

export async function generateThreeClassWorkset({
  dbPath,
  snapshotRefs = [],
  snapshotShas = [],
  historyPath,
  outputPath,
}) {
  if (typeof historyPath !== "string" || historyPath.length === 0) {
    throw worksetError("VALIDATION_ERROR", "historyPath is required");
  }
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw worksetError("VALIDATION_ERROR", "outputPath is required");
  }
  const finalOutput = path.resolve(outputPath);
  await assertAbsent(finalOutput, "workset output");
  const templates = await readCanonicalTemplates();

  let history;
  try {
    history = validateHistory(await readStrictJsonFile(historyPath, "history input"), { deduplicate: true });
  } catch (error) {
    rethrowProtocol(error);
  }

  let db;
  let stagingRoot;
  let stagingCleaned = false;
  let outputOwned = false;
  try {
    db = await openCommentDatabase(dbPath);
    const resolvedRefs = resolveSelectedSnapshotRefs(db, { snapshotRefs, snapshotShas });
    const selectedSnapshots = readSelectedSnapshots(db, resolvedRefs);
    const artifacts = buildAnalysisArtifacts(selectedSnapshots);
    const items = buildThreeClassItems(artifacts.records);
    const worksetId = randomUUID();
    const itemsValue = {
      protocol_version: PROTOCOL_VERSION,
      workset_id: worksetId,
      items,
    };
    const schemaValue = buildResponseSchema(worksetId);

    const outputParent = path.dirname(finalOutput);
    await access(outputParent).catch((error) => {
      throw worksetError("OUTPUT_WRITE_FAILED", `output parent is unavailable: ${outputParent}: ${error.message}`, { cause: error });
    });
    stagingRoot = await mkdtemp(path.join(outputParent, ".three-class-workset-"));
    const promptPath = path.join(stagingRoot, "PROMPT.md");
    const rulesPath = path.join(stagingRoot, "RULES.md");
    const historyFilePath = path.join(stagingRoot, "HISTORY.json");
    const itemsPath = path.join(stagingRoot, "ITEMS.json");
    const schemaPath = path.join(stagingRoot, "response.schema.json");
    await writeExclusive(promptPath, templates.prompt, "PROMPT.md");
    await writeExclusive(rulesPath, templates.rules, "RULES.md");
    await writeExclusive(historyFilePath, serializeJson(history), "HISTORY.json");
    await writeExclusive(itemsPath, serializeJson(itemsValue), "ITEMS.json");
    await writeExclusive(schemaPath, serializeJson(schemaValue), "response.schema.json");

    const packageOutput = parseSubprocessJson(
      runPython(
        [
          PACKAGER_PATH,
          "package",
          "--output",
          finalOutput,
          "--prompt",
          promptPath,
          "--rules",
          rulesPath,
          "--history",
          historyFilePath,
          "--items",
          itemsPath,
          "--schema",
          schemaPath,
        ],
        "PACKAGING_FAILED",
        "workset ZIP packaging",
      ),
      "PACKAGING_FAILED",
      "workset ZIP packaging",
    );
    if (packageOutput.member_count !== ARCHIVE_MEMBER_NAMES.length) {
      throw worksetError("PACKAGING_FAILED", "packager returned an unexpected member count");
    }
    await assertRegularFile(finalOutput, "generated workset ZIP");
    outputOwned = true;
    const verified = await validateWorksetArchive(finalOutput);
    try {
      await rm(stagingRoot, { recursive: true, force: false });
      stagingCleaned = true;
    } catch (error) {
      throw worksetError("OUTPUT_WRITE_FAILED", `staging directory could not be removed: ${stagingRoot}: ${error.message}`, { cause: error });
    }
    withImmediateTransaction(db, () => {
      registerWorkset(db, {
        worksetId: verified.worksetId,
        snapshotIds: selectedSnapshots.map(({ snapshot }) => snapshot.snapshotId),
      });
    });
    outputOwned = false;
    return {
      worksetId: verified.worksetId,
      itemCount: verified.items.items.length,
      historyCount: verified.history.items.length,
      outputPath: finalOutput,
    };
  } catch (error) {
    if (error instanceof CommentDatabaseError) throw error;
    if (error instanceof ProtocolValidationError) rethrowProtocol(error);
    throw worksetError("WORKSET_GENERATION_FAILED", error.message, { cause: error });
  } finally {
    try {
      if (db !== undefined) db.close();
    } catch {
      // Preserve the original generation or registration error.
    }
    if (stagingRoot !== undefined && !stagingCleaned) {
      try {
        await rm(stagingRoot, { recursive: true, force: true });
      } catch {
        // Preserve the original generation or registration error.
      }
    }
    if (outputOwned) {
      try {
        await unlink(finalOutput);
      } catch {
        // Preserve the original generation or registration error.
      }
    }
  }
}

export async function applyThreeClassResponse({ dbPath, worksetPath, responsePath }) {
  const { workset, response } = await readValidatedThreeClassSubmission({ worksetPath, responsePath });
  const db = await openCommentDatabase(dbPath);
  try {
    return withImmediateTransaction(db, () => {
      if (!worksetExists(db, workset.worksetId)) {
        throw worksetError("WORKSET_NOT_REGISTERED", `workset is not registered: ${workset.worksetId}`);
      }

      const snapshotRefs = readWorksetSnapshotRefs(db, workset.worksetId);
      if (snapshotRefs.length === 0) {
        throw worksetError("DATABASE_INTEGRITY_ERROR", `registered workset has no snapshots: ${workset.worksetId}`);
      }
      const selectedSnapshots = readSelectedSnapshots(db, snapshotRefs);
      const artifacts = buildAnalysisArtifacts(selectedSnapshots);
      const regeneratedItems = buildThreeClassItems(artifacts.records);
      if (!deepEqual(regeneratedItems, workset.items.items)) {
        throw worksetError("WORKSET_SOURCE_MISMATCH", `registered source does not reproduce workset ITEMS: ${workset.worksetId}`);
      }

      const decisionByComment = new Map();
      for (const item of workset.items.items) {
        decisionByComment.set(item.comment, response.decisions[item.id]);
      }

      const existingCommentLabels = new Map();
      for (const row of readExistingCommentLabels(db)) {
        if (!decisionByComment.has(row.commentText)) continue;
        const labels = existingCommentLabels.get(row.commentText) ?? [];
        labels.push(row);
        existingCommentLabels.set(row.commentText, labels);
      }
      for (const [commentText, rows] of existingCommentLabels) {
        const requestedLabel = decisionByComment.get(commentText);
        const conflict = rows.find((row) => row.label !== requestedLabel);
        if (conflict !== undefined) {
          throw worksetError(
            "LABEL_CONFLICT",
            `comment label conflicts for workset ${workset.worksetId}: existing=${conflict.label} requested=${requestedLabel} observation=${conflict.exampleObservationId}`,
          );
        }
      }

      const targetObservations = readTargetObservations(db, workset.worksetId);
      const expectedObservationCount = selectedSnapshots.reduce(
        (sum, bundle) => sum + bundle.observations.length,
        0,
      );
      if (targetObservations.length !== expectedObservationCount) {
        throw worksetError(
          "DATABASE_INTEGRITY_ERROR",
          `target observation count ${targetObservations.length} does not match source count ${expectedObservationCount}`,
        );
      }
      for (const target of targetObservations) {
        if (!decisionByComment.has(target.commentText)) {
          throw worksetError("DATABASE_INTEGRITY_ERROR", `target comment is absent from decision map: observation ${target.observationId}`);
        }
      }

      const existingTargetLabels = new Map(
        readExistingTargetLabels(db, workset.worksetId).map((row) => [row.observationId, row.label]),
      );
      const pending = [];
      let unchanged = 0;
      for (const target of targetObservations) {
        const requestedLabel = decisionByComment.get(target.commentText);
        const currentLabel = existingTargetLabels.get(target.observationId);
        if (currentLabel === undefined) {
          pending.push({ observationId: target.observationId, label: requestedLabel });
        } else if (currentLabel === requestedLabel) {
          unchanged += 1;
        } else {
          throw worksetError(
            "LABEL_CONFLICT",
            `target label conflicts for workset ${workset.worksetId}: existing=${currentLabel} requested=${requestedLabel} observation=${target.observationId}`,
          );
        }
      }

      for (const row of pending) insertObservationLabel(db, row);
      const inserted = pending.length;
      if (inserted + unchanged !== targetObservations.length) {
        throw worksetError("DATABASE_INTEGRITY_ERROR", "label application counts do not match target observations");
      }
      return {
        worksetId: workset.worksetId,
        observations: targetObservations.length,
        inserted,
        unchanged,
      };
    });
  } finally {
    try {
      db.close();
    } catch {
      // Preserve the application result or primary transaction error.
    }
  }
}

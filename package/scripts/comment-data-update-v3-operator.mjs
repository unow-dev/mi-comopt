#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeV3HumanTask,
  listV3HumanTasks,
  listV3Sessions,
  openV3HumanTask,
  openV3Operator,
  releaseV3HumanTask,
  startV3Session,
  syncV3DeploymentEvents,
} from "../src/integration/v3-operator.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMMENT_DATABASE_CLI = path.join(REPOSITORY_ROOT, "package", "scripts", "comment-database.mjs");

function productionKeywordPublicationRoot() {
  return path.resolve(process.env.COMMENT_DATA_UPDATE_KEYWORD_PUBLICATION_ROOT ?? path.join(REPOSITORY_ROOT, "work", "20260826", "candidate-publication-final"));
}

function productionThreeClassHistoryPath() {
  return path.resolve(process.env.COMMENT_DATA_UPDATE_THREE_CLASS_HISTORY ?? path.join(REPOSITORY_ROOT, "docs", "active", "operations", "integrated-labeling-state", "three_class_history.json"));
}

function corpusSnapshotRefs(controlPlane, corpusVersionId) {
  const version = controlPlane.readVersion(corpusVersionId);
  const refs = version?.payload?.state?.snapshot_refs ?? [];
  if (!Array.isArray(refs) || refs.length === 0) throw new Error(`corpus version ${corpusVersionId} contains no snapshot references`);
  return refs.map((reference) => {
    const normalized = typeof reference === "string"
      ? reference
      : `${reference?.payloadSha256 ?? ""}:${reference?.snapshotIndex ?? ""}`;
    if (!/^[0-9a-f]{64}:[0-9]+$/.test(normalized)) throw new Error(`corpus version ${corpusVersionId} contains an invalid snapshot reference`);
    return normalized;
  });
}

function createProductionKeywordHandoffBuilder(dbPath) {
  const publicationRoot = productionKeywordPublicationRoot();
  const resolvedDbPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
  return ({ candidateRequestId, request, controlPlane }) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "comment-db-v3-keyword-handoff-"));
    const outputPath = path.join(temporaryRoot, "keyword-candidate-handoff.zip");
    try {
      const result = spawnSync(process.execPath, [
        COMMENT_DATABASE_CLI,
        "generate-keyword-candidate-handoff",
        "--db", resolvedDbPath,
        ...corpusSnapshotRefs(controlPlane, request.corpusVersionId).flatMap((reference) => ["--snapshot-ref", reference]),
        "--corpus-version-id", request.corpusVersionId,
        "--classification-version-id", request.classificationVersionId,
        "--publication-root", publicationRoot,
        "--output", outputPath,
        "--request-id", candidateRequestId,
      ], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`keyword candidate handoff generation failed: ${result.stderr.trim() || result.stdout.trim()}`);
      const response = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
      return {
        content: readFileSync(outputPath),
        requestId: response.requestId,
        inputFingerprint: response.inputFingerprint,
      };
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  };
}

function createProductionClassificationWorksetBuilder(dbPath) {
  const historyPath = productionThreeClassHistoryPath();
  const resolvedDbPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
  return ({ corpusVersionId, classificationVersionId, controlPlane }) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "comment-db-v3-classification-workset-"));
    const outputPath = path.join(temporaryRoot, "three-class-workset.zip");
    try {
      const result = spawnSync(process.execPath, [
        COMMENT_DATABASE_CLI,
        "generate-three-class-workset",
        "--db", resolvedDbPath,
        ...corpusSnapshotRefs(controlPlane, corpusVersionId).flatMap((reference) => ["--snapshot-ref", reference]),
        ...(classificationVersionId ? ["--classification-version-id", classificationVersionId] : []),
        "--history", historyPath,
        "--output", outputPath,
      ], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`classification workset generation failed: ${result.stderr.trim() || result.stdout.trim()}`);
      const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
      const generatedWorksetId = /^generated workset=([0-9a-f-]{36})\s/.exec(line)?.[1];
      if (!generatedWorksetId) throw new Error(`classification workset generator returned an invalid result: ${line}`);
      return { content: readFileSync(outputPath), worksetId: generatedWorksetId };
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  };
}

const TOP_LEVEL_COMMANDS = new Set(["start", "sessions", "tasks", "human-task"]);
const HUMAN_TASK_COMMANDS = new Set(["open", "complete", "release"]);

function usage() {
  return `Usage:
  npm --workspace package run comment-data-update:v3 -- start \\
    --db PATH --workspace PATH --session-id ID --update-request-id ID --actor ACTOR [--pinned-json PATH]
  npm --workspace package run comment-data-update:v3 -- sessions \\
    --db PATH --workspace PATH
  npm --workspace package run comment-data-update:v3 -- tasks \\
    --db PATH --workspace PATH --session-id ID
  npm --workspace package run comment-data-update:v3 -- human-task open \\
    --db PATH --workspace PATH --session-id ID (--task-id ID|--step-id STEP) --actor ACTOR
  npm --workspace package run comment-data-update:v3 -- human-task complete \\
    --db PATH --workspace PATH --session-id ID (--task-id ID|--step-id STEP) --actor ACTOR \\
    [--outcome accept|reject --rationale TEXT]
  npm --workspace package run comment-data-update:v3 -- human-task release \\
    --db PATH --workspace PATH --session-id ID (--task-id ID|--step-id STEP) --actor ACTOR

Human artifact task:
  1. human-task open の出力先に、表示された expectedFile を1件だけ保存する。
  2. 内容を確認して human-task complete を実行する。

Decision task:
  human-task open の後、human-task complete に --outcome と --rationale を指定する。

このentrypointはproduction target固定で、v3 application-service adapterを使用します。
GitHub Pages workflow dispatch、deployment.completed event配送およびPages上のrelease marker検証までを行います。
汎用 Work Orchestrator CLI の new は使用しません。`;
}

function parseArgs(argv) {
  const [command, ...afterCommand] = argv;
  if (!command || command === "--help" || command === "-h") return { help: true };
  if (!TOP_LEVEL_COMMANDS.has(command)) throw new Error(`不明なcommandです: ${command}`);

  let subcommand;
  let rest = afterCommand;
  if (command === "human-task") {
    [subcommand, ...rest] = afterCommand;
    if (!subcommand || subcommand === "--help" || subcommand === "-h") return { help: true };
    if (!HUMAN_TASK_COMMANDS.has(subcommand)) throw new Error(`不明なhuman-task commandです: ${subcommand}`);
  }

  const args = { command, subcommand, help: false };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--help" || value === "-h") args.help = true;
    else if (value === "--db") args.dbPath = rest[++index];
    else if (value === "--workspace") args.workspacePath = rest[++index];
    else if (value === "--session-id") args.sessionId = rest[++index];
    else if (value === "--update-request-id") args.updateRequestId = rest[++index];
    else if (value === "--actor") args.actorId = rest[++index];
    else if (value === "--task-id") args.taskId = rest[++index];
    else if (value === "--step-id") args.stepId = rest[++index];
    else if (value === "--outcome") args.outcome = rest[++index];
    else if (value === "--rationale") args.rationale = rest[++index];
    else if (value === "--pinned-json") args.pinnedPath = rest[++index];
    else throw new Error(`不明な引数です: ${value}`);
  }
  return args;
}

function requireValue(args, name, value) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function requireAuthorityArgs(args) {
  requireValue(args, "--db PATH", args.dbPath);
  requireValue(args, "--workspace PATH", args.workspacePath);
}

function requireActor(args) {
  return requireValue(args, "--actor ACTOR", args.actorId);
}

function requireSession(args) {
  return requireValue(args, "--session-id ID", args.sessionId);
}

async function readPinned(path) {
  if (!path) return {};
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("--pinned-json must contain a JSON object");
  return value.pinned && typeof value.pinned === "object" ? value.pinned : value;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  requireAuthorityArgs(args);
  let operator;
  try {
    operator = await openV3Operator({
      dbPath: args.dbPath,
      workspacePath: args.workspacePath,
      classificationWorksetBuilder: createProductionClassificationWorksetBuilder(args.dbPath),
      keywordHandoffBuilder: createProductionKeywordHandoffBuilder(args.dbPath),
    });
    await syncV3DeploymentEvents(operator);
    let result;
    if (args.command === "start") {
      result = await startV3Session(operator, {
        sessionId: requireSession(args),
        updateRequestId: requireValue(args, "--update-request-id ID", args.updateRequestId),
        actorId: requireActor(args),
        pinned: await readPinned(args.pinnedPath),
      });
    } else if (args.command === "sessions") {
      result = { sessions: listV3Sessions(operator) };
    } else if (args.command === "tasks") {
      result = { sessionId: requireSession(args), tasks: listV3HumanTasks(operator, args.sessionId) };
    } else if (args.subcommand === "open") {
      result = await openV3HumanTask(operator, {
        sessionId: requireSession(args), taskId: args.taskId, stepId: args.stepId, actorId: requireActor(args),
      });
    } else if (args.subcommand === "complete") {
      result = await completeV3HumanTask(operator, {
        sessionId: requireSession(args), taskId: args.taskId, stepId: args.stepId, actorId: requireActor(args),
        outcome: args.outcome, rationale: args.rationale,
      });
    } else if (args.subcommand === "release") {
      result = await releaseV3HumanTask(operator, {
        sessionId: requireSession(args), taskId: args.taskId, stepId: args.stepId, actorId: requireActor(args),
      });
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    operator?.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`${error.code ? `${error.code}: ` : ""}${error.message}`);
  console.error(usage());
  process.exitCode = 1;
});

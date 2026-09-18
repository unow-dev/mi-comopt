#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  completeV3HumanTask,
  listV3HumanTasks,
  listV3Sessions,
  openV3HumanTask,
  openV3Operator,
  releaseV3HumanTask,
  startV3Session,
} from "../src/integration/v3-operator.js";

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
    operator = await openV3Operator({ dbPath: args.dbPath, workspacePath: args.workspacePath });
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

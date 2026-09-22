#!/usr/bin/env node

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { RecoveryApplicationServiceV3, verifyRecoveryArtifacts } from "../src/application/v3/recovery-services.js";
import { buildOptimicomUiArtifacts, validateOptimicomUiReleaseAtRoot } from "../src/processing/optimicom-ui-release/release.js";
import { buildCumulativeSourceDataset, serializeCumulativeSourceDataset } from "../src/processing/optimicom-ui-release/source-dataset.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMMENT_DATABASE_CLI = path.join(REPOSITORY_ROOT, "package", "scripts", "comment-database.mjs");
const DEPLOYED_UI_RELEASE_VERIFIER = path.join(REPOSITORY_ROOT, "package", "scripts", "verify-deployed-optimicom-ui-release.mjs");
const ACCOUNT_POLICY_PATH = path.join(REPOSITORY_ROOT, "package", "contracts", "account-block-candidates", "accountBlockCandidatePolicy-1.0.0.json");

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

function createProductionRecoveryClassificationHandoffBuilder(dbPath, workspacePath) {
  const historyPath = productionThreeClassHistoryPath();
  const resolvedDbPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
  return ({ recoveryId, snapshotRefs, items }) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "comment-db-v3-recovery-classification-"));
    const itemsPath = path.join(temporaryRoot, "recovery-items.json");
    const outputPath = path.join(temporaryRoot, "three-class-workset.zip");
    try {
      writeFileSync(itemsPath, JSON.stringify(items.map((item) => ({ id: item.id, comment: item.commentText }))));
      const result = spawnSync(process.execPath, [
        COMMENT_DATABASE_CLI,
        "generate-three-class-workset",
        "--db", resolvedDbPath,
        ...snapshotRefs.flatMap((reference) => ["--snapshot-ref", `${reference.payloadSha256}:${reference.snapshotIndex}`]),
        "--history", historyPath,
        "--recovery-items-json", itemsPath,
        "--output", outputPath,
      ], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`recovery classification handoff generation failed: ${result.stderr.trim() || result.stdout.trim()}`);
      const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
      const generatedWorksetId = /^generated workset=([0-9a-f-]{36})\s/.exec(line)?.[1];
      if (!generatedWorksetId) throw new Error(`recovery classification workset generator returned an invalid result: ${line}`);
      const handoffRoot = path.resolve(workspacePath, ".work-orchestrator", "recovery-handoffs");
      mkdirSync(handoffRoot, { recursive: true });
      const artifactPath = path.join(handoffRoot, `${recoveryId}.three-class-workset.zip`);
      copyFileSync(outputPath, artifactPath);
      return { content: readFileSync(artifactPath), worksetId: generatedWorksetId, artifactPath };
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  };
}

function createProductionRecoveryVerificationBuilder() {
  return ({ recoveryPlan, classificationLabels, corpusReceipt, classificationReceipt }) => {
    const expectedRoot = process.env.COMMENT_DATA_UPDATE_UI_RELEASE_ROOT;
    const pagesUrl = process.env.COMMENT_DATA_UPDATE_PAGES_URL;
    if (!expectedRoot || !pagesUrl) throw new Error("recovery verify requires COMMENT_DATA_UPDATE_UI_RELEASE_ROOT and COMMENT_DATA_UPDATE_PAGES_URL");
    const expected = validateOptimicomUiReleaseAtRoot(expectedRoot);
    const corpusVersionId = corpusReceipt.result.recoveredCorpusVersionId;
    const classificationVersionId = classificationReceipt.result.classificationVersionId;
    if (expected.manifest.schema_version !== 2
      || expected.manifest.source.corpus_version_id !== corpusVersionId
      || expected.manifest.source.classification_version_id !== classificationVersionId
      || JSON.stringify(expected.manifest.source.snapshot_refs) !== JSON.stringify(recoveryPlan.snapshot_refs.map((reference) => ({ payload_sha256: reference.payloadSha256, snapshot_index: reference.snapshotIndex })))) {
      throw new Error("recovery materialized release identity does not match recovered corpus/classification");
    }
    const sourceDataset = buildCumulativeSourceDataset({
      corpusVersionId,
      classificationVersionId,
      snapshotRefs: recoveryPlan.snapshot_refs,
      survivors: recoveryPlan.projection.survivors,
      labelRows: classificationLabels,
    });
    const sourceDatasetBytes = serializeCumulativeSourceDataset(sourceDataset);
    const keywordBytes = expected.dataArtifacts.keywords;
    const keywords = JSON.parse(keywordBytes.toString("utf8"));
    const accountPolicyBytes = readFileSync(ACCOUNT_POLICY_PATH);
    const accountPolicy = JSON.parse(accountPolicyBytes.toString("utf8"));
    const generated = buildOptimicomUiArtifacts({ sourceDataset, sourceDatasetBytes, keywords, keywordBytes, accountPolicy });
    const provider = spawnSync(process.execPath, [DEPLOYED_UI_RELEASE_VERIFIER, "--url", pagesUrl, "--expected", expectedRoot], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
    if (provider.error) throw provider.error;
    if (provider.status !== 0) throw new Error(`provider read-back verification failed: ${provider.stderr.trim() || provider.stdout.trim()}`);
    const providerResult = JSON.parse(provider.stdout.trim().split(/\r?\n/).at(-1));
    const artifactVerification = verifyRecoveryArtifacts({
      recoveryPlan,
      classificationLabels,
      sourceDatasetBytes,
      materializedCommentsBytes: expected.dataArtifacts.comments,
      servedCommentsBytes: expected.dataArtifacts.comments,
      generatedOverviewBytes: generated.dataArtifacts.overview,
      materializedOverviewBytes: expected.dataArtifacts.overview,
      servedOverviewBytes: expected.dataArtifacts.overview,
      generatedAccountBytes: generated.dataArtifacts.accounts,
      materializedAccountBytes: expected.dataArtifacts.accounts,
      servedAccountBytes: expected.dataArtifacts.accounts,
      generatedKeywordBytes: generated.dataArtifacts.keywords,
      materializedKeywordBytes: expected.dataArtifacts.keywords,
      servedKeywordBytes: expected.dataArtifacts.keywords,
      servedReleaseId: providerResult.identity,
      correctedReleaseId: providerResult.identity,
    });
    return { ...artifactVerification, servedReleaseId: providerResult.identity, correctedReleaseId: providerResult.identity, providerVerification: providerResult };
  };
}

const TOP_LEVEL_COMMANDS = new Set(["start", "sessions", "tasks", "human-task", "recovery"]);
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

  npm --workspace package run comment-data-update:v3 -- recovery freeze|plan|start|cancel|status|resume|verify|complete \\
    --db PATH --workspace PATH [recovery options]
  npm --workspace package run comment-data-update:v3 -- recovery classification open|complete|review \\
    --db PATH --workspace PATH [recovery options]
  npm --workspace package run comment-data-update:v3 -- recovery keyword open|complete|review \\
    --db PATH --workspace PATH [recovery options]

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

  const args = { command, subcommand: undefined, help: false };
  let subcommand;
  let rest = afterCommand;
  if (command === "human-task" || command === "recovery") {
    [subcommand, ...rest] = afterCommand;
    if (!subcommand || subcommand === "--help" || subcommand === "-h") return { help: true };
    if (command === "human-task" && !HUMAN_TASK_COMMANDS.has(subcommand)) throw new Error(`不明なhuman-task commandです: ${subcommand}`);
    if (command === "recovery" && !new Set(["freeze", "plan", "start", "cancel", "status", "resume", "verify", "complete", "classification", "keyword"]).has(subcommand)) throw new Error(`不明なrecovery commandです: ${subcommand}`);
    if (command === "recovery" && ["classification", "keyword"].includes(subcommand)) {
      args.recoveryGroup = subcommand;
      [args.recoverySubcommand, ...rest] = rest;
      if (!new Set(["open", "complete", "review"]).has(args.recoverySubcommand)) throw new Error(`不明なrecovery ${subcommand} commandです: ${args.recoverySubcommand}`);
    }
  }
  args.subcommand = subcommand;
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
    else if (value === "--base-corpus-version-id") args.baseCorpusVersionId = rest[++index];
    else if (value === "--broken-head-corpus-version-id") args.brokenHeadCorpusVersionId = rest[++index];
    else if (value === "--expected-plan-sha256") args.expectedPlanSha256 = rest[++index];
    else if (value === "--recovery-id") args.recoveryId = rest[++index];
    else if (value === "--response") args.responsePath = rest[++index];
    else if (value === "--proposal") args.proposalPath = rest[++index];
    else throw new Error(`不明な引数です: ${value}`);
  }
  return args;
}

function requireRecoveryId(args, optional = false) {
  if (optional && !args.recoveryId) return undefined;
  return requireValue(args, "--recovery-id ID", args.recoveryId);
}

function countNonterminalV3Sessions(operator) {
  const terminal = new Set(["completed", "failed", "cancelled", "succeeded", "superseded"]);
  return listV3Sessions(operator).filter((session) => !terminal.has(session.state)).length;
}

async function readJsonFile(filePath, label) {
  if (!filePath) throw new Error(`${label} is required`);
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

function validateProductionRecoveryClassificationResponse(operator, recoveryId, responsePath) {
  const handoff = operator.controlPlane.readReceipt(`recovery:${recoveryId}:classification-handoff`);
  const artifactPath = handoff?.result?.artifactPath;
  if (!artifactPath) return;
  const result = spawnSync(process.execPath, [
    COMMENT_DATABASE_CLI,
    "validate-three-class-response",
    "--workset", artifactPath,
    "--response", path.resolve(responsePath),
  ], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`recovery classification response validation failed: ${result.stderr.trim() || result.stdout.trim()}`);
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
    } else if (args.command === "recovery") {
      const recovery = new RecoveryApplicationServiceV3(operator.controlPlane, {
        verificationBuilder: createProductionRecoveryVerificationBuilder(),
        classificationHandoffBuilder: createProductionRecoveryClassificationHandoffBuilder(args.dbPath, args.workspacePath),
      });
      const actorId = args.actorId ?? "production-operator";
      if (args.subcommand === "freeze") {
        result = recovery.freeze({ actorId, nonterminalV3Sessions: countNonterminalV3Sessions(operator) });
      } else if (args.subcommand === "plan") {
        result = recovery.plan({
          baseCorpusVersionId: requireValue(args, "--base-corpus-version-id ID", args.baseCorpusVersionId),
          brokenHeadCorpusVersionId: requireValue(args, "--broken-head-corpus-version-id ID", args.brokenHeadCorpusVersionId),
          nonterminalV3Sessions: countNonterminalV3Sessions(operator),
        });
      } else if (args.subcommand === "start") {
        result = recovery.start({
          baseCorpusVersionId: requireValue(args, "--base-corpus-version-id ID", args.baseCorpusVersionId),
          brokenHeadCorpusVersionId: requireValue(args, "--broken-head-corpus-version-id ID", args.brokenHeadCorpusVersionId),
          expectedPlanSha256: requireValue(args, "--expected-plan-sha256 SHA", args.expectedPlanSha256),
          nonterminalV3Sessions: countNonterminalV3Sessions(operator),
          actorId,
        });
      } else if (args.subcommand === "cancel") {
        result = recovery.cancel({ recoveryId: requireRecoveryId(args, true), actorId, rationale: args.rationale ?? "" });
      } else if (args.subcommand === "status") {
        result = recovery.status({ recoveryId: requireRecoveryId(args) });
      } else if (args.subcommand === "resume") {
        result = recovery.resume({ recoveryId: requireRecoveryId(args), actorId });
      } else if (args.subcommand === "classification") {
        if (args.recoverySubcommand === "open") result = recovery.classificationOpen({ recoveryId: requireRecoveryId(args), actorId });
        else if (args.recoverySubcommand === "complete") {
          const recoveryId = requireRecoveryId(args);
          const responsePath = requireValue(args, "--response PATH", args.responsePath);
          validateProductionRecoveryClassificationResponse(operator, recoveryId, responsePath);
          result = recovery.classificationComplete({ recoveryId, response: await readJsonFile(responsePath, "--response"), actorId });
        }
        else result = recovery.classificationReview({ recoveryId: requireRecoveryId(args), outcome: requireValue(args, "--outcome", args.outcome), rationale: requireValue(args, "--rationale", args.rationale), actorId });
      } else if (args.subcommand === "keyword") {
        if (args.recoverySubcommand === "open") result = recovery.keywordOpen({ recoveryId: requireRecoveryId(args), actorId });
        else if (args.recoverySubcommand === "complete") result = recovery.keywordComplete({ recoveryId: requireRecoveryId(args), proposal: await readJsonFile(args.proposalPath, "--proposal"), actorId });
        else result = recovery.keywordReview({ recoveryId: requireRecoveryId(args), outcome: requireValue(args, "--outcome", args.outcome), rationale: requireValue(args, "--rationale", args.rationale), actorId });
      } else if (args.subcommand === "verify") {
        result = recovery.verify({ recoveryId: requireRecoveryId(args) });
      } else if (args.subcommand === "complete") {
        result = recovery.complete({ recoveryId: requireRecoveryId(args), actorId });
      }
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

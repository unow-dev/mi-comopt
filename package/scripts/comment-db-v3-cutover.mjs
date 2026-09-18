#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  advancePersistedV3Cutover,
  initializeV3Cutover,
  listV3CutoverEvents,
  readV3CutoverControl,
} from "../src/migration/v3-cutover.js";
import { openCommentDatabase, openCommentDatabaseReadOnly } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";

const COMMANDS = new Set(["status", "init", "freeze-v2", "drain-v2", "disable-legacy", "enable-v3", "smoke-passed", "smoke-failed"]);

function parseArgs(argv) {
  const [command = "status", ...rest] = argv;
  if (!COMMANDS.has(command)) throw new Error(`不明なcutover commandです: ${command}`);
  const args = { command, apply: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--db") args.dbPath = rest[++index];
    else if (arg === "--target-revision") args.targetRevision = Number(rest[++index]);
    else if (arg === "--target-hash") args.targetDefinitionHash = rest[++index];
    else if (arg === "--v2-hashes-json") args.v2HashesJson = rest[++index];
    else if (arg === "--mandatory-verification-passed") args.mandatoryVerificationPassed = true;
    else if (arg === "--provider-compatible") args.providerCompatible = true;
    else if (arg === "--v2-hashes-unchanged") args.v2HashesUnchanged = true;
    else if (arg === "--evidence-json") args.evidencePath = rest[++index];
    else if (arg === "--new-v2-starts") args.newV2Starts = Number(rest[++index]);
    else if (arg === "--nonterminal-v2-sessions") args.nonterminalV2Sessions = Number(rest[++index]);
    else if (arg === "--legacy-writer-disabled") args.legacyWriterDisabled = true;
    else if (arg === "--smoke-session-id") args.smokeSessionId = rest[++index];
    else if (arg === "--authoritative-state-verified") args.authoritativeStateVerified = true;
    else if (arg === "--reviewed-release-verified") args.reviewedReleaseVerified = true;
    else if (arg === "--promotion-verified") args.promotionVerified = true;
    else if (arg === "--deployment-verified") args.deploymentVerified = true;
    else if (arg === "--evidence-ledger-written") args.evidenceLedgerWritten = true;
    else if (arg === "--failure-ref") args.failureRef = rest[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`不明な引数です: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage:
  npm run cutover:v3 -- status --db PATH
  npm run cutover:v3 -- init --apply --db PATH --target-revision 3 --target-hash SHA256 \\
    --mandatory-verification-passed --provider-compatible --v2-hashes-unchanged \\
    --v2-hashes-json JSON --evidence-json PATH
  npm run cutover:v3 -- freeze-v2 --apply --db PATH --new-v2-starts 0
  npm run cutover:v3 -- drain-v2 --apply --db PATH --nonterminal-v2-sessions 0
  npm run cutover:v3 -- disable-legacy --apply --db PATH --legacy-writer-disabled
  npm run cutover:v3 -- enable-v3 --apply --db PATH --legacy-writer-disabled --new-v2-starts 0
  npm run cutover:v3 -- smoke-passed --apply --db PATH --smoke-session-id ID \\
    --authoritative-state-verified --reviewed-release-verified --promotion-verified \\
    --deployment-verified --evidence-ledger-written
  npm run cutover:v3 -- smoke-failed --apply --db PATH --failure-ref REF`;
}

function requireDb(args) {
  if (typeof args.dbPath !== "string" || args.dbPath.length === 0) throw new Error("--db PATH is required; production cutover must name its exact database explicitly");
}

function requireApply(args) {
  if (!args.apply) throw new Error("state-changing cutover commands require --apply");
}

function requireNumber(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

async function evidenceFrom(args) {
  if (!args.evidencePath) return {};
  return JSON.parse(await readFile(args.evidencePath, "utf8"));
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  requireDb(args);
  if (args.command === "status") {
    const db = await openCommentDatabaseReadOnly(args.dbPath);
    try {
      const hasControlTable = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v3_cutover_control'").get());
      const control = hasControlTable ? db.prepare("SELECT * FROM v3_cutover_control WHERE control_id = 'comment-data-update'").get() ?? null : null;
      const events = hasControlTable ? db.prepare("SELECT event_id AS eventId, from_state AS fromState, to_state AS toState, event_name AS eventName, evidence_json AS evidenceJson, created_at AS createdAt FROM v3_cutover_events WHERE control_id = 'comment-data-update' ORDER BY rowid").all() : [];
      console.log(JSON.stringify({ control, events }, null, 2));
    } finally {
      db.close();
    }
    return;
  }
  requireApply(args);
  const db = await openCommentDatabase(args.dbPath, { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  try {
    let result;
    if (args.command === "init") {
      if (args.targetRevision === undefined || args.targetDefinitionHash === undefined || args.v2HashesJson === undefined || args.mandatoryVerificationPassed !== true || args.providerCompatible !== true || args.v2HashesUnchanged !== true) throw new Error("init requires target metadata and all three explicit precondition flags");
      result = initializeV3Cutover(controlPlane, {
        targetRevision: args.targetRevision,
        targetDefinitionHash: args.targetDefinitionHash,
        mandatoryVerificationPassed: args.mandatoryVerificationPassed,
        providerCompatible: args.providerCompatible,
        v2HashesUnchanged: args.v2HashesUnchanged,
        v2Hashes: JSON.parse(args.v2HashesJson),
        evidence: await evidenceFrom(args),
      });
    } else if (args.command === "freeze-v2") {
      result = advancePersistedV3Cutover(controlPlane, "freeze_v2", { newV2Starts: requireNumber(args.newV2Starts, "new-v2-starts") });
    } else if (args.command === "drain-v2") {
      result = advancePersistedV3Cutover(controlPlane, "drain_complete", { nonterminalV2Sessions: requireNumber(args.nonterminalV2Sessions, "nonterminal-v2-sessions") });
    } else if (args.command === "disable-legacy") {
      if (args.legacyWriterDisabled !== true) throw new Error("disable-legacy requires --legacy-writer-disabled as an explicit external confirmation");
      result = advancePersistedV3Cutover(controlPlane, "legacy_disabled", { legacyWriterEnabled: false });
    } else if (args.command === "enable-v3") {
      if (args.legacyWriterDisabled !== true) throw new Error("enable-v3 requires --legacy-writer-disabled");
      result = advancePersistedV3Cutover(controlPlane, "enable_v3", { legacyWriterEnabled: false, newV2Starts: requireNumber(args.newV2Starts, "new-v2-starts") });
    } else if (args.command === "smoke-passed") {
      result = advancePersistedV3Cutover(controlPlane, "smoke_passed", {
        smokeSessionId: args.smokeSessionId,
        authoritativeStateVerified: args.authoritativeStateVerified === true,
        reviewedReleaseVerified: args.reviewedReleaseVerified === true,
        promotionVerified: args.promotionVerified === true,
        deploymentVerified: args.deploymentVerified === true,
        evidenceLedgerWritten: args.evidenceLedgerWritten === true,
      });
    } else {
      result = advancePersistedV3Cutover(controlPlane, "smoke_failed", { failureRef: args.failureRef });
    }
    console.log(JSON.stringify({ control: result, events: listV3CutoverEvents(controlPlane) }, null, 2));
  } finally {
    controlPlane.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 1;
});

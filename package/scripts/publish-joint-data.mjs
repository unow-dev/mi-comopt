#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDataRelease, KEYWORD_ARTIFACTS, ACCOUNT_ARTIFACTS, readJsonWithBytes, serializeRelease } from "./release-utils.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function required(args, names) {
  for (const name of names) if (!args[name]) throw new Error(`missing required option --${name}`);
}

function copyArtifacts(source, destination, names) {
  for (const name of names) fs.copyFileSync(path.join(source, name), path.join(destination, name));
}

function replaceAtomically({ stageDir, dataDir, releaseBytes, releasePath }) {
  const targetDataDir = path.resolve(dataDir);
  const targetRelease = path.resolve(releasePath);
  fs.mkdirSync(targetDataDir, { recursive: true });
  fs.mkdirSync(path.dirname(targetRelease), { recursive: true });
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "joint-release-backup-"));
  const moved = [];
  try {
    for (const name of [...KEYWORD_ARTIFACTS, ...ACCOUNT_ARTIFACTS]) {
      const destination = path.join(targetDataDir, name);
      if (fs.existsSync(destination)) {
        const backup = path.join(backupDir, name);
        fs.renameSync(destination, backup);
        moved.push({ destination, backup });
      }
    }
    if (fs.existsSync(targetRelease)) {
      const backup = path.join(backupDir, "data-release.json");
      fs.renameSync(targetRelease, backup);
      moved.push({ destination: targetRelease, backup });
    }
    for (const name of [...KEYWORD_ARTIFACTS, ...ACCOUNT_ARTIFACTS]) fs.renameSync(path.join(stageDir, name), path.join(targetDataDir, name));
    fs.writeFileSync(targetRelease, releaseBytes);
  } catch (caught) {
    for (const name of [...KEYWORD_ARTIFACTS, ...ACCOUNT_ARTIFACTS]) {
      const destination = path.join(targetDataDir, name);
      if (fs.existsSync(destination) && !moved.some((item) => item.destination === destination)) fs.rmSync(destination, { force: true });
    }
    if (fs.existsSync(targetRelease) && !moved.some((item) => item.destination === targetRelease)) fs.rmSync(targetRelease, { force: true });
    for (const item of moved.reverse()) if (fs.existsSync(item.backup)) fs.renameSync(item.backup, item.destination);
    throw caught;
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function run(args) {
  required(args, ["keyword-dir", "account-dir", "data-dir", "raw", "stage13", "stage13-reference", "three-class", "scope-id", "source-ref", "release-out"]);
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "joint-release-stage-"));
  try {
    copyArtifacts(path.resolve(args["keyword-dir"]), stageDir, KEYWORD_ARTIFACTS);
    copyArtifacts(path.resolve(args["account-dir"]), stageDir, ACCOUNT_ARTIFACTS);
    const release = buildDataRelease({
      rawInput: readJsonWithBytes(args.raw, "raw"),
      stage13Input: readJsonWithBytes(args.stage13, "stage13"),
      stage13ReferenceInput: readJsonWithBytes(args["stage13-reference"], "stage13 reference"),
      threeClassInput: readJsonWithBytes(args["three-class"], "three-class"),
      dataDir: stageDir,
      scopeId: args["scope-id"],
      sourceRef: args["source-ref"],
      updatedAt: args["updated-at"] ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    replaceAtomically({
      stageDir,
      dataDir: args["data-dir"],
      releaseBytes: Buffer.from(serializeRelease(release), "utf8"),
      releasePath: args["release-out"],
    });
    console.log(JSON.stringify({ valid: true, data_dir: path.resolve(args["data-dir"]), release: path.resolve(args["release-out"]), keyword_run_id: release.keyword.run_id, account_run_id: release.account.run_id }));
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (caught) {
  console.error(caught.stack ?? caught.message ?? caught);
  process.exitCode = 1;
}

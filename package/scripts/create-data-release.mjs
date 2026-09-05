#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildDataRelease, readJsonWithBytes, serializeRelease } from "./release-utils.mjs";

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

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function run(args) {
  required(args, ["raw", "stage13", "stage13-reference", "three-class", "scope-id", "source-ref", "data-dir", "out"]);
  const release = buildDataRelease({
    rawInput: readJsonWithBytes(args.raw, "raw"),
    stage13Input: readJsonWithBytes(args.stage13, "stage13"),
    stage13ReferenceInput: readJsonWithBytes(args["stage13-reference"], "stage13 reference"),
    threeClassInput: readJsonWithBytes(args["three-class"], "three-class"),
    dataDir: args["data-dir"],
    scopeId: args["scope-id"],
    sourceRef: args["source-ref"],
    updatedAt: args["updated-at"] ?? utcNow(),
  });
  const output = path.resolve(args.out);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serializeRelease(release), "utf8");
  console.log(JSON.stringify({ valid: true, out: output, raw_record_count: release.raw.record_count, three_class_sha256: release.three_class.sha256 }));
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (caught) {
  console.error(caught.stack ?? caught.message ?? caught);
  process.exitCode = 1;
}

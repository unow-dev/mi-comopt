#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { verifyRelease, readJsonWithBytes } from "./release-utils.mjs";

const PACKAGE_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_DATA_DIR = path.join(PACKAGE_ROOT, "src/data");
const DEFAULT_RELEASE = path.join(PACKAGE_ROOT, "public/data-release.json");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item !== "--data-dir" && item !== "--release") throw new Error(`unexpected argument: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${item}`);
    args[item.slice(2)] = value;
    index += 1;
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const releasePath = path.resolve(args.release ?? DEFAULT_RELEASE);
  const release = readJsonWithBytes(releasePath, "data-release.json").value;
  verifyRelease({ release, dataDir: args["data-dir"] ?? DEFAULT_DATA_DIR });
  console.log(JSON.stringify({ valid: true, release: releasePath, keyword_run_id: release.keyword.run_id, account_run_id: release.account.run_id }));
} catch (caught) {
  console.error(caught.stack ?? caught.message ?? caught);
  process.exitCode = 1;
}

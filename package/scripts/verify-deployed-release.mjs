#!/usr/bin/env node

import fs from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item !== "--url" && item !== "--expected" && item !== "--retries" && item !== "--delay-ms") throw new Error(`unexpected argument: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${item}`);
    args[item.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.expected) throw new Error("--url and --expected are required");
const expected = fs.readFileSync(args.expected);
const retries = Number(args.retries ?? 10);
const delayMs = Number(args["delay-ms"] ?? 3000);
const releaseUrl = new URL("data-release.json", args.url.endsWith("/") ? args.url : `${args.url}/`);

let lastFailure = "unknown failure";
for (let attempt = 1; attempt <= retries; attempt += 1) {
  try {
    const response = await fetch(releaseUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const actual = Buffer.from(await response.arrayBuffer());
    if (!actual.equals(expected)) throw new Error("deployed data-release.json bytes differ from repository/build bytes");
    console.log(JSON.stringify({ valid: true, url: releaseUrl.toString(), attempts: attempt }));
    process.exit(0);
  } catch (caught) {
    lastFailure = caught.message ?? String(caught);
    if (attempt < retries) await sleep(delayMs);
  }
}

console.error(`deployed data-release.json verification failed: ${lastFailure}`);
process.exitCode = 1;

#!/usr/bin/env node

import path from "node:path";
import { importNormalizedPayloadFile } from "../src/database/comment-database.js";

class CliArgumentError extends Error {}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }
  if (argv[0] !== "import") {
    throw new CliArgumentError("usage: npm run comment-db -- import --input path/to/normalized-comments.json [--db path.sqlite3]");
  }

  let input;
  let db;
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== "--input" && option !== "--db") {
      throw new CliArgumentError(`unknown option: ${option}`);
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      throw new CliArgumentError(`${option} requires a value`);
    }
    const value = argv[index + 1];
    if (option === "--input") {
      if (input !== undefined) throw new CliArgumentError("--input may be specified only once");
      input = value;
    } else {
      if (db !== undefined) throw new CliArgumentError("--db may be specified only once");
      db = value;
    }
    index += 1;
  }
  if (input === undefined) {
    throw new CliArgumentError("--input is required");
  }
  return { input, db };
}

function printUsage() {
  console.log("Usage: npm run comment-db -- import --input path/to/normalized-comments.json [--db path.sqlite3]");
}

function resolveInvocationPath(value) {
  if (path.isAbsolute(value)) return value;
  const npmInvocationDirectory = process.env.npm_lifecycle_event === "comment-db"
    ? process.env.INIT_CWD
    : undefined;
  return path.resolve(npmInvocationDirectory ?? process.cwd(), value);
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printUsage();
  } else {
    const result = await importNormalizedPayloadFile(resolveInvocationPath(args.input), {
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
    });
    if (result.status === "already-imported") {
      console.log(`already imported payload=${result.payloadSha256} observations=${result.observationCount}`);
    } else {
      console.log(`imported payload=${result.payloadSha256} observations=${result.observationCount}`);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CliArgumentError) {
    console.error(`CLI_ERROR: ${message}`);
    printUsage();
    process.exitCode = 2;
  } else {
    console.error(message);
    process.exitCode = 1;
  }
}

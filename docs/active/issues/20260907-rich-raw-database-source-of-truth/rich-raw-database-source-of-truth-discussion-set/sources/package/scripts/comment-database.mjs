#!/usr/bin/env node

import { access, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CommentDatabaseError,
  importNormalizedPayloadFile,
  importRawSnapshotFile,
  openCommentDatabase,
} from "../src/database/comment-database.js";
import { readSelectedSnapshots, verifyRawStore } from "../src/database/raw-snapshot-repository.js";
import { buildAnalysisArtifacts } from "../src/processing/analysis-input/raw-snapshot-projection.js";

class CliArgumentError extends Error {}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function usageFor(command = undefined) {
  if (command === "import") {
    return "Usage: npm run comment-db -- import --input path/to/normalized-comments.json [--db path.sqlite3]";
  }
  if (command === "import-raw-snapshot") {
    return "Usage: npm run comment-db -- import-raw-snapshot --input path/to/rich-raw-snapshot.json [--db path.sqlite3] [--raw-root directory]";
  }
  if (command === "export-analysis-input") {
    return "Usage: npm run comment-db -- export-analysis-input --snapshot-sha <sha> [--snapshot-sha <sha> ...] --output path.json --manifest path.json [--db path.sqlite3]";
  }
  if (command === "verify-raw-store") {
    return "Usage: npm run comment-db -- verify-raw-store [--snapshot-sha <sha> ...] [--db path.sqlite3] [--raw-root directory]";
  }
  return [
    "Usage:",
    "  npm run comment-db -- import --input path/to/normalized-comments.json [--db path.sqlite3]",
    "  npm run comment-db -- import-raw-snapshot --input path/to/rich-raw-snapshot.json [--db path.sqlite3] [--raw-root directory]",
    "  npm run comment-db -- export-analysis-input --snapshot-sha <sha> --output path.json --manifest path.json [--db path.sqlite3]",
    "  npm run comment-db -- verify-raw-store [--snapshot-sha <sha> ...] [--db path.sqlite3] [--raw-root directory]",
  ].join("\n");
}

function requireOptionValue(argv, index, option) {
  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
    throw new CliArgumentError(option + " requires a value");
  }
  return argv[index + 1];
}

function setOnce(args, key, value, option) {
  if (args[key] !== undefined) throw new CliArgumentError(option + " may be specified only once");
  args[key] = value;
}

function parseSnapshotSha(args, value) {
  if (!SHA256_PATTERN.test(value)) {
    throw new CliArgumentError("--snapshot-sha must be 64 lowercase hexadecimal characters");
  }
  if (args.snapshotShas.includes(value)) {
    throw new CliArgumentError("--snapshot-sha may not contain duplicates");
  }
  args.snapshotShas.push(value);
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }

  const command = argv[0];
  const supportedCommands = new Set([
    "import",
    "import-raw-snapshot",
    "export-analysis-input",
    "verify-raw-store",
  ]);
  if (!supportedCommands.has(command)) {
    throw new CliArgumentError("unknown command: " + command);
  }
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    return { help: true, command };
  }

  const allowedOptions = {
    import: new Set(["--input", "--db"]),
    "import-raw-snapshot": new Set(["--input", "--db", "--raw-root"]),
    "export-analysis-input": new Set(["--snapshot-sha", "--output", "--manifest", "--db"]),
    "verify-raw-store": new Set(["--snapshot-sha", "--db", "--raw-root"]),
  }[command];
  const args = { command, snapshotShas: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (!allowedOptions.has(option)) {
      throw new CliArgumentError("unknown option: " + option);
    }
    if (option === "--input") {
      setOnce(args, "input", requireOptionValue(argv, index, option), option);
    } else if (option === "--db") {
      setOnce(args, "db", requireOptionValue(argv, index, option), option);
    } else if (option === "--raw-root") {
      setOnce(args, "rawRoot", requireOptionValue(argv, index, option), option);
    } else if (option === "--output") {
      setOnce(args, "output", requireOptionValue(argv, index, option), option);
    } else if (option === "--manifest") {
      setOnce(args, "manifest", requireOptionValue(argv, index, option), option);
    } else if (option === "--snapshot-sha") {
      parseSnapshotSha(args, requireOptionValue(argv, index, option));
    } else {
      throw new CliArgumentError("unknown option: " + option);
    }
    if (["--input", "--db", "--raw-root", "--output", "--manifest", "--snapshot-sha"].includes(option)) {
      index += 1;
    }
  }

  if (command === "import" || command === "import-raw-snapshot") {
    if (args.input === undefined) throw new CliArgumentError("--input is required");
  }
  if (command === "export-analysis-input") {
    if (args.snapshotShas.length === 0) throw new CliArgumentError("at least one --snapshot-sha is required");
    if (args.output === undefined) throw new CliArgumentError("--output is required");
    if (args.manifest === undefined) throw new CliArgumentError("--manifest is required");
  }
  return args;
}

function resolveInvocationPath(value) {
  if (path.isAbsolute(value)) return value;
  const npmInvocationDirectory = process.env.npm_lifecycle_event === "comment-db"
    ? process.env.INIT_CWD
    : undefined;
  return path.resolve(npmInvocationDirectory ?? process.cwd(), value);
}

async function assertExportTargetsAbsent(targets) {
  for (const target of targets) {
    try {
      await access(target);
      throw new CommentDatabaseError("EXPORT_WRITE_FAILED", "refusing to overwrite existing export target: " + target);
    } catch (error) {
      if (error instanceof CommentDatabaseError) throw error;
      if (error.code !== "ENOENT") {
        throw new CommentDatabaseError("EXPORT_WRITE_FAILED", target + ": " + error.message);
      }
    }
  }
}

async function writeExportArtifacts(outputPath, manifestPath, artifacts) {
  await assertExportTargetsAbsent([outputPath, manifestPath]);
  let outputCreated = false;
  let manifestCreated = false;
  try {
    await writeFile(outputPath, Buffer.from(artifacts.outputJson, "utf8"), { flag: "wx" });
    outputCreated = true;
    await writeFile(manifestPath, Buffer.from(artifacts.manifestJson, "utf8"), { flag: "wx" });
    manifestCreated = true;
  } catch (error) {
    if (outputCreated && !manifestCreated) {
      try {
        await unlink(outputPath);
      } catch {
        // Preserve the export error if cleanup cannot be completed.
      }
    }
    throw new CommentDatabaseError("EXPORT_WRITE_FAILED", error.message, { cause: error });
  }
}

async function exportAnalysisInput(args) {
  const outputPath = resolveInvocationPath(args.output);
  const manifestPath = resolveInvocationPath(args.manifest);
  if (outputPath === manifestPath) {
    throw new CliArgumentError("--output and --manifest must be different paths");
  }
  const db = await openCommentDatabase(args.db === undefined ? undefined : resolveInvocationPath(args.db));
  try {
    const selectedSnapshots = readSelectedSnapshots(db, args.snapshotShas);
    const artifacts = buildAnalysisArtifacts(selectedSnapshots);
    await writeExportArtifacts(outputPath, manifestPath, artifacts);
    return {
      recordCount: artifacts.records.length,
      outputPath,
      manifestPath,
    };
  } finally {
    db.close();
  }
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usageFor(args.command));
  } else if (args.command === "import") {
    const result = await importNormalizedPayloadFile(resolveInvocationPath(args.input), {
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
    });
    if (result.status === "already-imported") {
      console.log("already imported payload=" + result.payloadSha256 + " observations=" + result.observationCount);
    } else {
      console.log("imported payload=" + result.payloadSha256 + " observations=" + result.observationCount);
    }
  } else if (args.command === "import-raw-snapshot") {
    const result = await importRawSnapshotFile(resolveInvocationPath(args.input), {
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
      rawRoot: args.rawRoot === undefined ? undefined : resolveInvocationPath(args.rawRoot),
    });
    const status = result.status === "already-imported" ? "already imported" : "imported";
    console.log(status + " payload=" + result.payloadSha256 + " comments=" + result.commentCount);
  } else if (args.command === "export-analysis-input") {
    const result = await exportAnalysisInput(args);
    console.log("exported records=" + result.recordCount + " output=" + result.outputPath + " manifest=" + result.manifestPath);
  } else if (args.command === "verify-raw-store") {
    const db = await openCommentDatabase(args.db === undefined ? undefined : resolveInvocationPath(args.db));
    try {
      const result = await verifyRawStore(db, {
        snapshotShas: args.snapshotShas.length === 0 ? undefined : args.snapshotShas,
        rawRoot: args.rawRoot === undefined ? undefined : resolveInvocationPath(args.rawRoot),
      });
      console.log("verified snapshots=" + result.snapshotCount);
    } finally {
      db.close();
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CliArgumentError) {
    console.error("CLI_ERROR: " + message);
    console.error(usageFor());
    process.exitCode = 2;
  } else {
    console.error(message);
    process.exitCode = 1;
  }
}

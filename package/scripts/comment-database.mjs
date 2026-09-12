#!/usr/bin/env node

import { access, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CommentDatabaseError,
  backfillRawInputs,
  importNormalizedPayloadFile,
  importRawSnapshotFile,
  migrateCommentDatabase,
  openCommentDatabase,
} from "../src/database/comment-database.js";
import { importNewCommentsWrapperFile } from "./adapters/new-comments-wrapper.js";
import { importCommentBatchFile } from "./adapters/comment-batch.js";
import {
  readSelectedSnapshots,
  resolveSelectedSnapshotRefs,
  verifyRawInputs,
} from "../src/database/raw-snapshot-repository.js";
import { buildAnalysisArtifacts } from "../src/processing/analysis-input/raw-snapshot-projection.js";
import {
  applyThreeClassResponse,
  generateThreeClassWorkset,
  validateThreeClassResponse,
} from "./adapters/three-class-workset.js";
import {
  applyKeywordCandidatePublication,
  exportKeywordCandidatesUi,
  generateKeywordCandidateHandoff,
} from "./adapters/keyword-candidate-comment-db.js";
import { exportThreeClassLabelSummaryUi } from "./adapters/three-class-label-summary.js";
import { syncThreeClassFinal } from "./adapters/three-class-final-sync.js";

class CliArgumentError extends Error {}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SNAPSHOT_REF_PATTERN = /^([0-9a-f]{64}):([0-9]+)$/;

function usageFor(command = undefined) {
  if (command === "migrate") {
    return "Usage: npm run comment-db -- migrate [--db path.sqlite3]";
  }
  if (command === "import") {
    return "Usage: npm run comment-db -- import --input path/to/normalized-comments.json [--db path.sqlite3]";
  }
  if (command === "import-raw-snapshot") {
    return "Usage: npm run comment-db -- import-raw-snapshot --input path/to/rich-raw-snapshot.json [--db path.sqlite3]";
  }
  if (command === "import-new-comments" || command === "import-new-comments-wrapper") {
    return "Usage: npm run comment-db -- import-new-comments --input path/to/new-comments.json [--db path.sqlite3]";
  }
  if (command === "import-comment-batch") {
    return "Usage: npm run comment-db -- import-comment-batch --input path/to/comment-batch.json [--db path.sqlite3]";
  }
  if (command === "backfill-raw-inputs") {
    return "Usage: npm run comment-db -- backfill-raw-inputs --db path.sqlite3 --raw-root legacy/raw/root";
  }
  if (command === "export-analysis-input") {
    return "Usage: npm run comment-db -- export-analysis-input --snapshot-ref <sha:index> [--snapshot-ref <sha:index> ...] --output path.json --manifest path.json [--db path.sqlite3]";
  }
  if (command === "verify-raw-inputs") {
    return "Usage: npm run comment-db -- verify-raw-inputs [--snapshot-ref <sha:index> ...] [--db path.sqlite3]";
  }
  if (command === "generate-three-class-workset") {
    return "Usage: npm run comment-db -- generate-three-class-workset (--snapshot-ref <sha:index> ... | --snapshot-sha <sha256> ...) --history path.json --output path.zip [--db path.sqlite3]";
  }
  if (command === "validate-three-class-response") {
    return "Usage: npm run comment-db -- validate-three-class-response --workset path.zip --response path.json";
  }
  if (command === "apply-three-class-response") {
    return "Usage: npm run comment-db -- apply-three-class-response --workset path.zip --response path.json [--db path.sqlite3]";
  }
  if (command === "generate-keyword-candidate-handoff") {
    return "Usage: npm run comment-db -- generate-keyword-candidate-handoff --snapshot-ref <sha:index> --publication-root path --output path.zip [--db path.sqlite3]";
  }
  if (command === "apply-keyword-candidate-publication") {
    return "Usage: npm run comment-db -- apply-keyword-candidate-publication --handoff-manifest path/handoff_manifest.json --publication-root path [--db path.sqlite3]";
  }
  if (command === "export-keyword-candidates-ui") {
    return "Usage: npm run comment-db -- export-keyword-candidates-ui --output path/filterKeywordCandidates.json [--db path.sqlite3]";
  }
  if (command === "export-three-class-label-summary-ui") {
    return "Usage: npm run comment-db -- export-three-class-label-summary-ui --snapshot-ref <sha:index> --output path/threeClassLabelSummary.json [--db path.sqlite3]";
  }
  if (command === "sync-three-class-final") {
    return "Usage: npm run comment-db -- sync-three-class-final --input path/to/three_class_labeled.json --snapshot-ref <sha:index> [--db path.sqlite3]";
  }
  return [
    "Usage:",
    "  npm run comment-db -- migrate [--db path.sqlite3]",
    "  npm run comment-db -- import --input path/to/normalized-comments.json [--db path.sqlite3]",
    "  npm run comment-db -- import-raw-snapshot --input path/to/rich-raw-snapshot.json [--db path.sqlite3]",
    "  npm run comment-db -- import-new-comments --input path/to/new-comments.json [--db path.sqlite3]",
    "  npm run comment-db -- import-comment-batch --input path/to/comment-batch.json [--db path.sqlite3]",
    "  npm run comment-db -- backfill-raw-inputs --db path.sqlite3 --raw-root legacy/raw/root",
    "  npm run comment-db -- export-analysis-input --snapshot-ref <sha:index> --output path.json --manifest path.json [--db path.sqlite3]",
    "  npm run comment-db -- verify-raw-inputs [--snapshot-ref <sha:index> ...] [--db path.sqlite3]",
    "  npm run comment-db -- generate-three-class-workset (--snapshot-ref <sha:index> ... | --snapshot-sha <sha256> ...) --history path.json --output path.zip [--db path.sqlite3]",
    "  npm run comment-db -- validate-three-class-response --workset path.zip --response path.json",
    "  npm run comment-db -- apply-three-class-response --workset path.zip --response path.json [--db path.sqlite3]",
    "  npm run comment-db -- generate-keyword-candidate-handoff --snapshot-ref <sha:index> --publication-root path --output path.zip [--db path.sqlite3]",
    "  npm run comment-db -- apply-keyword-candidate-publication --handoff-manifest path/handoff_manifest.json --publication-root path [--db path.sqlite3]",
    "  npm run comment-db -- export-keyword-candidates-ui --output path/filterKeywordCandidates.json [--db path.sqlite3]",
    "  npm run comment-db -- export-three-class-label-summary-ui --snapshot-ref <sha:index> --output path/threeClassLabelSummary.json [--db path.sqlite3]",
    "  npm run comment-db -- sync-three-class-final --input path/to/three_class_labeled.json --snapshot-ref <sha:index> [--db path.sqlite3]",
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

function parseSnapshotRef(args, value) {
  const match = SNAPSHOT_REF_PATTERN.exec(value);
  if (!match) {
    throw new CliArgumentError("--snapshot-ref must match <64 lowercase hex SHA>:<non-negative integer>");
  }
  const snapshotIndex = Number(match[2]);
  if (!Number.isSafeInteger(snapshotIndex)) {
    throw new CliArgumentError("--snapshot-ref snapshot index must be a safe non-negative integer");
  }
  const reference = { payloadSha256: match[1], snapshotIndex };
  const referenceKey = `${reference.payloadSha256}:${reference.snapshotIndex}`;
  if (args.snapshotRefKeys.includes(referenceKey)) {
    throw new CliArgumentError("--snapshot-ref may not contain duplicates");
  }
  args.snapshotRefKeys.push(referenceKey);
  args.snapshotRefs.push(reference);
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }

  const command = argv[0];
  const supportedCommands = new Set([
    "migrate",
    "import",
    "import-raw-snapshot",
    "import-new-comments",
    "import-new-comments-wrapper",
    "import-comment-batch",
    "backfill-raw-inputs",
    "export-analysis-input",
    "verify-raw-inputs",
    "generate-three-class-workset",
    "validate-three-class-response",
    "apply-three-class-response",
    "generate-keyword-candidate-handoff",
    "apply-keyword-candidate-publication",
    "export-keyword-candidates-ui",
    "export-three-class-label-summary-ui",
    "sync-three-class-final",
  ]);
  if (!supportedCommands.has(command)) {
    throw new CliArgumentError("unknown command: " + command);
  }
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    return { help: true, command };
  }

  const allowedOptions = {
    migrate: new Set(["--db"]),
    import: new Set(["--input", "--db"]),
    "import-raw-snapshot": new Set(["--input", "--db"]),
    "import-new-comments": new Set(["--input", "--db"]),
    "import-new-comments-wrapper": new Set(["--input", "--db"]),
    "import-comment-batch": new Set(["--input", "--db"]),
    "backfill-raw-inputs": new Set(["--db", "--raw-root"]),
    "export-analysis-input": new Set(["--snapshot-ref", "--snapshot-sha", "--output", "--manifest", "--db"]),
    "verify-raw-inputs": new Set(["--snapshot-ref", "--snapshot-sha", "--db"]),
    "generate-three-class-workset": new Set(["--snapshot-ref", "--snapshot-sha", "--history", "--output", "--db"]),
    "validate-three-class-response": new Set(["--workset", "--response"]),
    "apply-three-class-response": new Set(["--workset", "--response", "--db"]),
    "generate-keyword-candidate-handoff": new Set(["--snapshot-ref", "--publication-root", "--output", "--db"]),
    "apply-keyword-candidate-publication": new Set(["--handoff-manifest", "--publication-root", "--db"]),
    "export-keyword-candidates-ui": new Set(["--output", "--db"]),
    "export-three-class-label-summary-ui": new Set(["--snapshot-ref", "--output", "--db"]),
    "sync-three-class-final": new Set(["--input", "--snapshot-ref", "--db"]),
  }[command];
  const args = { command, snapshotRefs: [], snapshotRefKeys: [], snapshotShas: [] };
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
    } else if (option === "--history") {
      setOnce(args, "history", requireOptionValue(argv, index, option), option);
    } else if (option === "--workset") {
      setOnce(args, "workset", requireOptionValue(argv, index, option), option);
    } else if (option === "--response") {
      setOnce(args, "response", requireOptionValue(argv, index, option), option);
    } else if (option === "--publication-root") {
      setOnce(args, "publicationRoot", requireOptionValue(argv, index, option), option);
    } else if (option === "--handoff-manifest") {
      setOnce(args, "handoffManifest", requireOptionValue(argv, index, option), option);
    } else if (option === "--snapshot-sha") {
      parseSnapshotSha(args, requireOptionValue(argv, index, option));
    } else if (option === "--snapshot-ref") {
      parseSnapshotRef(args, requireOptionValue(argv, index, option));
    } else {
      throw new CliArgumentError("unknown option: " + option);
    }
    if (["--input", "--db", "--raw-root", "--output", "--manifest", "--history", "--workset", "--response", "--publication-root", "--handoff-manifest", "--snapshot-sha", "--snapshot-ref"].includes(option)) {
      index += 1;
    }
  }

  if (command === "import" || command === "import-raw-snapshot" || command === "import-new-comments" || command === "import-new-comments-wrapper" || command === "import-comment-batch") {
    if (args.input === undefined) throw new CliArgumentError("--input is required");
  }
  if (command === "migrate" && args.db === "") throw new CliArgumentError("--db requires a value");
  if (command === "backfill-raw-inputs") {
    if (args.db === undefined) throw new CliArgumentError("--db is required");
    if (args.rawRoot === undefined) throw new CliArgumentError("--raw-root is required");
  }
  if (args.snapshotRefs.length > 0 && args.snapshotShas.length > 0) {
    throw new CliArgumentError("--snapshot-ref and --snapshot-sha may not be combined");
  }
  if (command === "export-analysis-input") {
    if (args.snapshotRefs.length === 0 && args.snapshotShas.length === 0) {
      throw new CliArgumentError("at least one --snapshot-ref or --snapshot-sha is required");
    }
    if (args.output === undefined) throw new CliArgumentError("--output is required");
    if (args.manifest === undefined) throw new CliArgumentError("--manifest is required");
  }
  if (command === "generate-three-class-workset") {
    if (args.snapshotRefs.length === 0 && args.snapshotShas.length === 0) {
      throw new CliArgumentError("at least one --snapshot-ref or --snapshot-sha is required");
    }
    if (args.history === undefined) throw new CliArgumentError("--history is required");
    if (args.output === undefined) throw new CliArgumentError("--output is required");
  }
  if (command === "validate-three-class-response") {
    if (args.workset === undefined) throw new CliArgumentError("--workset is required");
    if (args.response === undefined) throw new CliArgumentError("--response is required");
  }
  if (command === "apply-three-class-response") {
    if (args.workset === undefined) throw new CliArgumentError("--workset is required");
    if (args.response === undefined) throw new CliArgumentError("--response is required");
  }
  if (command === "generate-keyword-candidate-handoff") {
    if (args.snapshotRefs.length !== 1) throw new CliArgumentError("exactly one --snapshot-ref is required");
    if (args.publicationRoot === undefined) throw new CliArgumentError("--publication-root is required");
    if (args.output === undefined) throw new CliArgumentError("--output is required");
  }
  if (command === "apply-keyword-candidate-publication") {
    if (args.handoffManifest === undefined) throw new CliArgumentError("--handoff-manifest is required");
    if (args.publicationRoot === undefined) throw new CliArgumentError("--publication-root is required");
  }
  if (command === "export-keyword-candidates-ui") {
    if (args.output === undefined) throw new CliArgumentError("--output is required");
  }
  if (command === "export-three-class-label-summary-ui") {
    if (args.snapshotRefs.length !== 1) throw new CliArgumentError("exactly one --snapshot-ref is required");
    if (args.output === undefined) throw new CliArgumentError("--output is required");
  }
  if (command === "sync-three-class-final") {
    if (args.input === undefined) throw new CliArgumentError("--input is required");
    if (args.snapshotRefs.length !== 1) throw new CliArgumentError("exactly one --snapshot-ref is required");
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

function resolveCliSelectedSnapshotRefs(db, args) {
  return resolveSelectedSnapshotRefs(db, {
    snapshotRefs: args.snapshotRefs,
    snapshotShas: args.snapshotShas,
  });
}

async function exportAnalysisInput(args) {
  const outputPath = resolveInvocationPath(args.output);
  const manifestPath = resolveInvocationPath(args.manifest);
  if (outputPath === manifestPath) {
    throw new CliArgumentError("--output and --manifest must be different paths");
  }
  const db = await openCommentDatabase(args.db === undefined ? undefined : resolveInvocationPath(args.db));
  try {
    const selectedSnapshots = readSelectedSnapshots(db, resolveCliSelectedSnapshotRefs(db, args));
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

async function generateWorkset(args) {
  return generateThreeClassWorkset({
    dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
    snapshotRefs: args.snapshotRefs.map((reference) => ({ ...reference })),
    snapshotShas: [...args.snapshotShas],
    historyPath: resolveInvocationPath(args.history),
    outputPath: resolveInvocationPath(args.output),
  });
}

async function exportThreeClassLabelSummary(args) {
  return exportThreeClassLabelSummaryUi({
    dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
    snapshotRef: { ...args.snapshotRefs[0] },
    outputPath: resolveInvocationPath(args.output),
  });
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usageFor(args.command));
  } else if (args.command === "migrate") {
    const result = await migrateCommentDatabase(args.db === undefined ? undefined : resolveInvocationPath(args.db));
    console.log(result.status + " schema=" + result.schemaVersion + " db=" + result.dbPath);
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
    });
    const status = result.status === "already-imported" ? "already imported" : "imported";
    console.log(status + " payload=" + result.payloadSha256 + " comments=" + result.commentCount);
  } else if (args.command === "import-new-comments" || args.command === "import-new-comments-wrapper") {
    const result = await importNewCommentsWrapperFile(resolveInvocationPath(args.input), {
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
    });
    const status = result.status === "already-imported" ? "already imported" : "imported";
    console.log(status + " payload=" + result.payloadSha256 + " snapshots=" + result.snapshotCount + " comments=" + result.commentObservationCount);
  } else if (args.command === "import-comment-batch") {
    const result = await importCommentBatchFile(resolveInvocationPath(args.input), {
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
    });
    const status = result.status === "already-imported" ? "already imported" : "imported";
    console.log(status + " payload=" + result.payloadSha256 + " snapshots=" + result.snapshotCount + " comments=" + result.commentObservationCount);
  } else if (args.command === "backfill-raw-inputs") {
    const result = await backfillRawInputs({
      dbPath: resolveInvocationPath(args.db),
      rawRoot: resolveInvocationPath(args.rawRoot),
    });
    console.log(result.status + " schema=" + result.schemaVersion);
  } else if (args.command === "export-analysis-input") {
    const result = await exportAnalysisInput(args);
    console.log("exported records=" + result.recordCount + " output=" + result.outputPath + " manifest=" + result.manifestPath);
  } else if (args.command === "verify-raw-inputs") {
    const db = await openCommentDatabase(args.db === undefined ? undefined : resolveInvocationPath(args.db));
    try {
      const snapshotRefs = args.snapshotRefs.length > 0 || args.snapshotShas.length > 0
        ? resolveCliSelectedSnapshotRefs(db, args)
        : undefined;
      const result = verifyRawInputs(db, { snapshotRefs });
      console.log("verified raw_inputs=" + result.rawInputCount + " snapshots=" + result.snapshotCount);
    } finally {
      db.close();
    }
  } else if (args.command === "generate-three-class-workset") {
    const result = await generateWorkset(args);
    console.log(`generated workset=${result.worksetId} items=${result.itemCount} history=${result.historyCount} zip=${result.outputPath}`);
  } else if (args.command === "validate-three-class-response") {
    const result = await validateThreeClassResponse({
      worksetPath: resolveInvocationPath(args.workset),
      responsePath: resolveInvocationPath(args.response),
    });
    console.log(`VALID workset=${result.worksetId} decisions=${result.decisionCount}`);
  } else if (args.command === "apply-three-class-response") {
    const result = await applyThreeClassResponse({
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
      worksetPath: resolveInvocationPath(args.workset),
      responsePath: resolveInvocationPath(args.response),
    });
    console.log(`APPLIED workset=${result.worksetId} observations=${result.observations} inserted=${result.inserted} unchanged=${result.unchanged}`);
  } else if (args.command === "generate-keyword-candidate-handoff") {
    const result = await generateKeywordCandidateHandoff({
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
      snapshotRef: args.snapshotRefs[0],
      publicationRoot: resolveInvocationPath(args.publicationRoot),
      outputPath: resolveInvocationPath(args.output),
    });
    console.log(JSON.stringify(result));
  } else if (args.command === "apply-keyword-candidate-publication") {
    const result = await applyKeywordCandidatePublication({
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
      handoffManifestPath: resolveInvocationPath(args.handoffManifest),
      publicationRoot: resolveInvocationPath(args.publicationRoot),
    });
    console.log(JSON.stringify(result));
  } else if (args.command === "export-keyword-candidates-ui") {
    const result = await exportKeywordCandidatesUi({
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
      outputPath: resolveInvocationPath(args.output),
    });
    console.log(JSON.stringify(result));
  } else if (args.command === "export-three-class-label-summary-ui") {
    const result = await exportThreeClassLabelSummary(args);
    console.log(JSON.stringify(result));
  } else if (args.command === "sync-three-class-final") {
    const result = await syncThreeClassFinal({
      dbPath: args.db === undefined ? undefined : resolveInvocationPath(args.db),
      inputPath: resolveInvocationPath(args.input),
      snapshotRef: args.snapshotRefs[0],
    });
    console.log(JSON.stringify(result));
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

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readStrictJsonFile, serializeJson, LABEL_SET } from "../src/three-class-workset/protocol.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const defaultReferencePath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "Integrated_Labeling_Handoff_v1.5.0",
  "reference",
  "stage13_labeled_REFERENCE.json",
);
const defaultGoldenPath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "integrated-labeling-state",
  "three_class_golden_adjudications.json",
);
const defaultP2Path = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "integrated-labeling-state",
  "three_class_p2_adjudications.json",
);
const defaultOutputPath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "integrated-labeling-state",
  "three_class_history.json",
);

class MigrationError extends Error {}

function usage() {
  return [
    "Usage: node package/scripts/migrate-three-class-history.mjs [options]",
    "  --reference path.json  legacy Stage13 reference array",
    "  --golden path.json     golden adjudication registry",
    "  --p2 path.json         P2 adjudication registry",
    "  --output path.json     normalized v1 HISTORY output",
  ].join("\n");
}

function parseArguments(argv) {
  const args = {
    reference: defaultReferencePath,
    golden: defaultGoldenPath,
    p2: defaultP2Path,
    output: defaultOutputPath,
  };
  const keys = new Map([
    ["--reference", "reference"],
    ["--golden", "golden"],
    ["--p2", "p2"],
    ["--output", "output"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--help" || option === "-h") return { help: true };
    const key = keys.get(option);
    if (key === undefined) throw new MigrationError(`unknown option: ${option}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new MigrationError(`${option} requires a value`);
    args[key] = path.resolve(value);
    index += 1;
  }
  return args;
}

function legacyRecordKey(record) {
  const fields = ["username", "handle", "comment", "postedAt", "postedDate", "label"];
  const values = fields.map((field) => {
    if (!Object.hasOwn(record, field)) return "";
    if (record[field] === null) return "None";
    if (typeof record[field] === "boolean") return record[field] ? "True" : "False";
    return String(record[field]);
  });
  return createHash("sha256").update(values.join("\u001f"), "utf8").digest("hex").slice(0, 24);
}

function requireObject(value, description) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MigrationError(`${description} must be an object`);
  }
  return value;
}

function requireRegistryDecisions(value, description) {
  const object = requireObject(value, description);
  if (!Array.isArray(object.decisions)) throw new MigrationError(`${description}.decisions must be an array`);
  return object.decisions;
}

function buildRecordLookup(records) {
  if (!Array.isArray(records)) throw new MigrationError("legacy reference must be an array");
  const lookup = new Map();
  for (const [index, record] of records.entries()) {
    requireObject(record, `legacy reference[${index}]`);
    if (typeof record.comment !== "string") throw new MigrationError(`legacy reference[${index}].comment must be a string`);
    const key = legacyRecordKey(record);
    const existing = lookup.get(key);
    if (existing !== undefined && existing !== record.comment) {
      throw new MigrationError(`record key ${key} maps to conflicting comments`);
    }
    lookup.set(key, record.comment);
  }
  return lookup;
}

function mergeDecisions(lookup, registries) {
  const merged = [];
  const labelsByComment = new Map();
  let decisionCount = 0;
  let reverseLookupFailures = 0;
  let conflicts = 0;
  for (const registry of registries) {
    const decisions = requireRegistryDecisions(registry.value, registry.description);
    for (const [index, decision] of decisions.entries()) {
      decisionCount += 1;
      requireObject(decision, `${registry.description}.decisions[${index}]`);
      if (typeof decision.record_key !== "string") {
        throw new MigrationError(`${registry.description}.decisions[${index}].record_key must be a string`);
      }
      const comment = lookup.get(decision.record_key);
      if (comment === undefined) {
        reverseLookupFailures += 1;
        continue;
      }
      if (typeof decision.label !== "string" || !LABEL_SET.has(decision.label)) {
        throw new MigrationError(`${registry.description}.decisions[${index}].label is invalid`);
      }
      if (labelsByComment.has(comment)) {
        if (labelsByComment.get(comment) !== decision.label) conflicts += 1;
        continue;
      }
      labelsByComment.set(comment, decision.label);
      merged.push({ comment, label: decision.label });
    }
  }
  if (reverseLookupFailures > 0) throw new MigrationError(`reverse lookup failed for ${reverseLookupFailures} decision(s)`);
  if (conflicts > 0) throw new MigrationError(`same-comment label conflicts: ${conflicts}`);
  return { decisionCount, items: merged, reverseLookupFailures, conflicts };
}

async function main(argv) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const [reference, golden, p2] = await Promise.all([
    readStrictJsonFile(args.reference, "legacy Stage13 reference"),
    readStrictJsonFile(args.golden, "golden adjudications"),
    readStrictJsonFile(args.p2, "P2 adjudications"),
  ]);
  const lookup = buildRecordLookup(reference);
  const merged = mergeDecisions(lookup, [
    { value: golden, description: "golden adjudications" },
    { value: p2, description: "P2 adjudications" },
  ]);
  try {
    await writeFile(args.output, serializeJson({
      protocol_version: "three-class-workset-v1",
      items: merged.items,
    }), { flag: "wx" });
  } catch (error) {
    throw new MigrationError(`refusing to overwrite or write output ${args.output}: ${error.message}`);
  }
  const counts = Object.fromEntries([...LABEL_SET].map((label) => [
    label,
    merged.items.filter((item) => item.label === label).length,
  ]));
  console.log(JSON.stringify({
    output: args.output,
    golden_decisions: requireRegistryDecisions(golden, "golden adjudications").length,
    p2_decisions: requireRegistryDecisions(p2, "P2 adjudications").length,
    decision_count: merged.decisionCount,
    reverse_lookup_failures: merged.reverseLookupFailures,
    unique_comments: merged.items.length,
    conflicts: merged.conflicts,
    label_counts: counts,
  }));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  console.error(usage());
  process.exitCode = 1;
}

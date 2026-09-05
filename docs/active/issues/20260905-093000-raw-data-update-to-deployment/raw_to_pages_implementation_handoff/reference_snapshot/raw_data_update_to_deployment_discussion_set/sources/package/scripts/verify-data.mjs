#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prefixedSha256,
  validateArtifactBindings,
  validateKeywordMeta,
  validatePolicy,
} from "../src/lib/account-block-candidate-workflow.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(PACKAGE_ROOT, "src/data");
const DEFAULT_POLICY = path.join(PACKAGE_ROOT, "../docs/active/issues/20260827-054534-account-block-candidate-list/account_block_candidate_handoff_v1.0.0/account_block_candidate_handoff/config/accountBlockCandidatePolicy.json");
const GENERATOR = path.join(PACKAGE_ROOT, "scripts/account-block-candidate-workflow.mjs");

function readJson(file, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (caught) {
    throw new Error(`${label}を読み込めません: ${caught.message}`);
  }
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch (caught) {
    throw new Error(`${label}のJSONが不正です: ${caught.message}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item !== "--data-dir" && item !== "--policy") throw new Error(`unexpected argument: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${item}`);
    args[item.slice(2)] = value;
    index += 1;
  }
  return args;
}

function run(args) {
  const dataDir = path.resolve(args["data-dir"] ?? DEFAULT_DATA_DIR);
  const policyFile = path.resolve(args.policy ?? DEFAULT_POLICY);
  const candidatesInput = readJson(path.join(dataDir, "accountBlockCandidates.json"), "account candidates");
  const metaInput = readJson(path.join(dataDir, "accountBlockCandidates.meta.json"), "account meta");
  const manifestInput = readJson(path.join(dataDir, "accountBlockCandidateRunManifest.json"), "account run manifest");
  const keywordMetaInput = readJson(path.join(dataDir, "filterKeywordCandidates.meta.json"), "keyword meta");
  const policyInput = readJson(policyFile, "account policy");
  const generatorBytes = fs.readFileSync(GENERATOR);

  validatePolicy(policyInput.value);
  validateKeywordMeta(keywordMetaInput.value);
  validateArtifactBindings({
    candidates: candidatesInput.value,
    candidatesBytes: candidatesInput.bytes,
    meta: metaInput.value,
    metaBytes: metaInput.bytes,
    manifest: manifestInput.value,
    manifestBytes: manifestInput.bytes,
    policy: policyInput.value,
    policyBytes: policyInput.bytes,
    generatorBytes,
    keywordMeta: keywordMetaInput.value,
  });

  if (manifestInput.value.candidate_policy.version !== policyInput.value.policy_version) {
    throw new Error("manifestのcandidate policy versionがcommitted policyと一致しません");
  }
  if (metaInput.value.candidate_policy_version !== policyInput.value.policy_version) {
    throw new Error("metaのcandidate policy versionがcommitted policyと一致しません");
  }
  if (manifestInput.value.candidate_policy.content_sha256 !== prefixedSha256(policyInput.bytes)) {
    throw new Error("manifestのcandidate policy hashがcommitted policyと一致しません");
  }
  console.log(JSON.stringify({
    valid: true,
    run_id: manifestInput.value.run_id,
    candidate_count: candidatesInput.value.length,
    dataset_artifact_sha256: metaInput.value.dataset_artifact_sha256,
  }));
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (caught) {
  console.error(caught.errors ? JSON.stringify({ errors: caught.errors }, null, 2) : caught.stack ?? caught.message ?? caught);
  process.exitCode = 1;
}

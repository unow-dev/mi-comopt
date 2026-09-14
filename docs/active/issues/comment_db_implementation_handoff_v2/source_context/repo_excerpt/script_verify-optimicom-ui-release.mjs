#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "../src/database/comment-database.js";
import { contentSha256 } from "../src/processing/keyword-candidates/candidate-workflow.js";
import { prefixedSha256 } from "../src/processing/account-block-candidates/account-block-candidate-workflow.js";
import {
  releaseIdentity,
  validateOptimicomUiReleaseAtRoot,
} from "../src/processing/optimicom-ui-release/release.js";

const KEYWORD_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "evaluation-policy-1.0.0.json");
const ACCOUNT_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "account-block-candidates", "accountBlockCandidatePolicy-1.0.0.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function verifyOptimicomUiRelease(releasePath) {
  const result = validateOptimicomUiReleaseAtRoot(releasePath);
  const keywordPolicy = readJson(KEYWORD_POLICY_PATH);
  const accountPolicyBytes = fs.readFileSync(ACCOUNT_POLICY_PATH);
  const accountPolicy = JSON.parse(accountPolicyBytes.toString("utf8"));
  if (result.manifest.policies.keyword.version !== keywordPolicy.policy_version || result.manifest.policies.keyword.content_sha256 !== contentSha256(keywordPolicy)) {
    throw new Error("UI_RELEASE_POLICY_MISMATCH: keyword policy does not match canonical contract");
  }
  if (result.manifest.policies.account.version !== accountPolicy.policy_version || result.manifest.policies.account.content_sha256 !== prefixedSha256(accountPolicyBytes)) {
    throw new Error("UI_RELEASE_POLICY_MISMATCH: account policy does not match canonical contract");
  }
  return {
    status: "verified",
    releasePath: path.resolve(releasePath),
    identity: releaseIdentity(result.manifest),
    recordCounts: Object.fromEntries(Object.entries(result.manifest.artifacts).map(([key, value]) => [key, value.record_count])),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const releasePath = process.argv[process.argv.indexOf("--release") + 1];
  try {
    if (!releasePath) throw new Error("Usage: node scripts/verify-optimicom-ui-release.mjs --release <path/optimicom-ui-release.json>");
    console.log(JSON.stringify(verifyOptimicomUiRelease(releasePath)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}


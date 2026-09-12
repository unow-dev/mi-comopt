#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "../src/database/comment-database.js";
import { contentSha256 } from "../src/processing/keyword-candidates/candidate-workflow.js";
import { prefixedSha256 } from "../src/processing/account-block-candidates/account-block-candidate-workflow.js";
import {
  UI_ARTIFACT_KEYS,
  UI_RELEASE_ROOT,
  releaseIdentity,
  validateOptimicomUiArtifactBytes,
  validateOptimicomUiReleaseManifest,
} from "../src/processing/optimicom-ui-release/release.js";

const KEYWORD_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "keyword-candidates", "evaluation-policy-1.0.0.json");
const ACCOUNT_POLICY_PATH = path.join(PACKAGE_ROOT, "contracts", "account-block-candidates", "accountBlockCandidatePolicy-1.0.0.json");

async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`DEPLOYED_RELEASE_FETCH_FAILED: ${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`DEPLOYED_RELEASE_INVALID: ${label}: ${error.message}`); }
}

function readExpected(expectedPath) {
  const root = path.resolve(expectedPath);
  const manifestPath = path.basename(root) === UI_RELEASE_ROOT ? root : path.join(root, UI_RELEASE_ROOT);
  const manifest = parseJson(fs.readFileSync(manifestPath), "expected release");
  validateOptimicomUiReleaseManifest(manifest);
  return manifest;
}

export async function verifyDeployedOptimicomUiRelease({ url, expected, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("DEPLOYED_RELEASE_FETCH_FAILED: fetch is unavailable");
  const expectedManifest = readExpected(expected);
  const baseUrl = new URL(url.endsWith("/") ? url : `${url}/`);
  const deployedManifestBytes = await fetchBytes(fetchImpl, new URL(UI_RELEASE_ROOT, baseUrl).href);
  const deployedManifest = parseJson(deployedManifestBytes, "deployed release");
  validateOptimicomUiReleaseManifest(deployedManifest);
  if (releaseIdentity(deployedManifest) !== releaseIdentity(expectedManifest)) throw new Error("DEPLOYED_RELEASE_IDENTITY_MISMATCH: deployed release does not match expected release");
  const artifacts = {};
  for (const key of UI_ARTIFACT_KEYS) {
    const artifactPath = deployedManifest.artifacts[key].path;
    artifacts[key] = await fetchBytes(fetchImpl, new URL(artifactPath, baseUrl).href);
  }
  validateOptimicomUiArtifactBytes(deployedManifest, artifacts);
  const keywordPolicy = JSON.parse(fs.readFileSync(KEYWORD_POLICY_PATH, "utf8"));
  const accountPolicyBytes = fs.readFileSync(ACCOUNT_POLICY_PATH);
  if (deployedManifest.policies.keyword.content_sha256 !== contentSha256(keywordPolicy) || deployedManifest.policies.account.content_sha256 !== prefixedSha256(accountPolicyBytes)) throw new Error("DEPLOYED_RELEASE_POLICY_MISMATCH: policy identity is not canonical");
  return {
    status: "verified",
    url: baseUrl.href,
    identity: releaseIdentity(deployedManifest),
    recordCounts: Object.fromEntries(UI_ARTIFACT_KEYS.map((key) => [key, deployedManifest.artifacts[key].record_count])),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const valueFor = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  try {
    const url = valueFor("--url");
    const expected = valueFor("--expected");
    if (!url || !expected) throw new Error("Usage: node scripts/verify-deployed-optimicom-ui-release.mjs --url <deployment-base> --expected <local-release>");
    console.log(JSON.stringify(await verifyDeployedOptimicomUiRelease({ url, expected })));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}


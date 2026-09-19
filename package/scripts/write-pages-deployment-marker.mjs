#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

const argv = process.argv.slice(2);
const outputRoot = valueFor(argv, "--output-root");
const deploymentRequestId = valueFor(argv, "--deployment-request-id");
const releaseId = valueFor(argv, "--release-id");
const releaseBundleSha256 = valueFor(argv, "--release-bundle-sha256");
if (![outputRoot, deploymentRequestId, releaseId, releaseBundleSha256].every((value) => typeof value === "string" && value.length > 0)) {
  throw new Error("Usage: node scripts/write-pages-deployment-marker.mjs --output-root PATH --deployment-request-id ID --release-id ID --release-bundle-sha256 SHA256");
}
if (!HEX_SHA256.test(releaseBundleSha256)) throw new Error("--release-bundle-sha256 must be a 64-character lowercase SHA-256 hex value");

const marker = {
  schema_version: 1,
  target: "production",
  deployment_request_id: deploymentRequestId,
  release_id: releaseId,
  release_bundle_sha256: releaseBundleSha256,
  generated_at: new Date().toISOString(),
};
const root = path.resolve(outputRoot);
fs.mkdirSync(root, { recursive: true });
const markerPath = path.join(root, "comment-db-v3-deployment.json");
const temporaryPath = `${markerPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
fs.renameSync(temporaryPath, markerPath);
console.log(JSON.stringify({ status: "written", markerPath, deploymentRequestId, releaseId }));

#!/usr/bin/env node

import { prefixedSha256 } from "../src/state/canonical.js";

function valueFor(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}
export async function verifyDeployedV3Pages({ url, deploymentRequestId, releaseId, releaseBundleSha256, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const baseMarkerUrl = new URL("comment-db-v3-deployment.json", url.endsWith("/") ? url : `${url}/`);
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const markerUrl = new URL(baseMarkerUrl);
    markerUrl.searchParams.set("cachebust", `${Date.now()}-${attempt}`);
    try {
      const response = await fetchImpl(markerUrl, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`deployed v3 marker returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      let marker;
      try { marker = JSON.parse(bytes.toString("utf8")); } catch (error) { throw new Error(`deployed v3 marker is invalid JSON: ${error.message}`); }
      if (marker.schema_version !== 1 || marker.target !== "production") throw new Error("deployed v3 marker schema/target mismatch");
      if (marker.deployment_request_id !== deploymentRequestId) throw new Error("deployed v3 deployment request identity mismatch");
      if (marker.release_id !== releaseId) throw new Error("deployed v3 release identity mismatch");
      if (marker.release_bundle_sha256 !== releaseBundleSha256) throw new Error("deployed v3 release bundle SHA-256 mismatch");
      return { status: "verified", url: baseMarkerUrl.href, releaseId, deploymentRequestId, markerSha256: prefixedSha256(bytes), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw lastError;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const url = valueFor(argv, "--url");
  const deploymentRequestId = valueFor(argv, "--deployment-request-id");
  const releaseId = valueFor(argv, "--release-id");
  const releaseBundleSha256 = valueFor(argv, "--release-bundle-sha256");
  if (![url, deploymentRequestId, releaseId, releaseBundleSha256].every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Usage: node scripts/verify-deployed-v3-pages.mjs --url URL --deployment-request-id ID --release-id ID --release-bundle-sha256 SHA256");
  }
  console.log(JSON.stringify(await verifyDeployedV3Pages({ url, deploymentRequestId, releaseId, releaseBundleSha256 })));
}

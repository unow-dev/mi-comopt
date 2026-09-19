import assert from "node:assert/strict";
import test from "node:test";
import { GitHubPagesDeploymentAdapter } from "../src/deployment/github-pages-adapter.js";

const BUNDLE_SHA256 = "a".repeat(64);

function response(value, status = 200) {
  const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return bytes.toString("utf8"); },
    async arrayBuffer() { return bytes; },
  };
}

test("GitHub Pages adapter dispatches, reconciles, and verifies one deployment identity", async () => {
  const calls = [];
  const run = {
    id: 123,
    display_title: "Deploy React UI to GitHub Pages / deployment-v3-1",
    status: "completed",
    conclusion: "success",
    created_at: "2026-09-19T00:00:00Z",
  };
  let listCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/actions/workflows/")) {
      if (options.method === "POST") return response("", 204);
      listCalls += 1;
      return response({ workflow_runs: listCalls > 1 ? [run] : [] });
    }
    if (url.endsWith("comment-db-v3-deployment.json")) {
      return response({
        schema_version: 1,
        target: "production",
        deployment_request_id: "deployment-v3-1",
        release_id: "release-v3-1",
        release_bundle_sha256: BUNDLE_SHA256,
        generated_at: "2026-09-19T00:01:00.000Z",
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const adapter = new GitHubPagesDeploymentAdapter({
    token: "test-token",
    fetchImpl,
    releaseBundleSha256: () => BUNDLE_SHA256,
    verifyRetries: 1,
    pagesUrl: "https://unow-dev.github.io/mi-comopt/",
  });

  const ensured = await adapter.ensureDeployment({ deploymentRequestId: "deployment-v3-1", releaseId: "release-v3-1", target: "production" });
  assert.equal(ensured.status, "requested");
  const dispatch = calls.find((call) => call.options.method === "POST");
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    ref: "main",
    inputs: {
      deployment_request_id: "deployment-v3-1",
      release_id: "release-v3-1",
      release_bundle_sha256: BUNDLE_SHA256,
    },
  });

  const events = await adapter.pollCompletedDeployments([{
    deployment_request_id: "deployment-v3-1",
    release_id: "release-v3-1",
    target: "production",
  }]);
  assert.deepEqual(events, [{
    eventId: "github-pages-deployment-123",
    eventType: "deployment.completed",
    correlationKey: "deployment-v3-1",
    payload: {
      deploymentRequestId: "deployment-v3-1",
      target: "production",
      releaseId: "release-v3-1",
      status: "succeeded",
      externalRunRef: "github-actions-run:123",
    },
  }]);

  const verified = await adapter.verifyDeployment({
    deploymentRequestId: "deployment-v3-1",
    releaseId: "release-v3-1",
    target: "production",
    externalRunRef: "github-actions-run:123",
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.servedReleaseId, "release-v3-1");
  assert.match(verified.verificationRef, /^github-pages-marker:sha256:/);
});

test("GitHub Pages adapter fails closed without an API token", async () => {
  const adapter = new GitHubPagesDeploymentAdapter({
    token: undefined,
    releaseBundleSha256: () => BUNDLE_SHA256,
  });
  await assert.rejects(
    adapter.ensureDeployment({ deploymentRequestId: "deployment-v3-2", releaseId: "release-v3-2", target: "production" }),
    (error) => error.code === "CONFIGURATION_ERROR" && /GITHUB_TOKEN/.test(error.message),
  );
});

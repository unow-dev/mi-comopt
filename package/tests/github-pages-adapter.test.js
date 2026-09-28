import assert from "node:assert/strict";
import test from "node:test";
import { GitHubPagesDeploymentAdapter } from "../src/deployment/github-pages-adapter.js";
import { prefixedSha256 } from "../src/state/canonical.js";

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

test("GitHub Pages adapter publishes the DB-backed UI release before dispatch", async () => {
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const manifest = {
    schema_version: 2,
    generated_at: "2026-09-27T15:36:58Z",
    source: {
      db_schema_version: 8,
      corpus_version_id: "corpus-v3",
      classification_version_id: "classification-v3",
      snapshot_refs: [{ payload_sha256: "b".repeat(64), snapshot_index: 0 }],
      source_dataset_artifact_sha256: hash("c"),
      keyword_publication: {
        run_id: "run_123e4567-e89b-42d3-a456-426614174000",
        published_at: "2026-09-27T15:36:58Z",
        applied_at: "2026-09-27T15:36:58Z",
        candidates_content_sha256: hash("d"),
      },
    },
    policies: { keyword: { version: "1.0.0", content_sha256: hash("e") }, account: { version: "1.0.0", content_sha256: hash("f") } },
    artifacts: {
      comments: { path: `artifacts/source-dataset.${"c".repeat(64)}.json`, artifact_sha256: hash("c"), record_count: 0 },
      overview: { path: `artifacts/overview.${"d".repeat(64)}.json`, artifact_sha256: hash("d"), record_count: 0 },
      keywords: { path: `artifacts/filter-keyword-candidates.${"e".repeat(64)}.json`, artifact_sha256: hash("e"), record_count: 0 },
      accounts: { path: `artifacts/account-block-candidates.${"f".repeat(64)}.json`, artifact_sha256: hash("f"), record_count: 0 },
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const files = new Map([["optimicom-ui-release.json", manifestBytes]]);
  for (const artifact of Object.values(manifest.artifacts)) files.set(artifact.path, Buffer.from(artifact.path, "utf8"));
  const calls = [];
  const createdBlobs = [];
  const uiManifestSha256 = prefixedSha256(manifestBytes).slice("sha256:".length);
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("comment-db-v3-deployment.json")) {
      return response({
        schema_version: 1,
        target: "production",
        deployment_request_id: "deployment-v3-ui-1",
        release_id: "release-v3-ui-1",
        release_bundle_sha256: BUNDLE_SHA256,
        ui_release_manifest_sha256: uiManifestSha256,
        generated_at: "2026-09-27T15:40:00.000Z",
      });
    }
    if (url.includes("/actions/workflows/")) {
      if (options.method === "POST") return response("", 204);
      return response({ workflow_runs: [] });
    }
    if (url.includes("/git/ref/heads/codex/ui-release/deployment-v3-ui-1")) return response({ message: "Not Found" }, 404);
    if (url.includes("/git/ref/heads/main")) return response({ object: { sha: "base-sha" } });
    if (url.endsWith("/git/commits/base-sha")) return response({ tree: { sha: "base-tree-sha" } });
    if (url.endsWith("/git/blobs") && options.method === "POST") {
      createdBlobs.push(JSON.parse(options.body));
      return response({ sha: `blob-${createdBlobs.length}` });
    }
    if (url.endsWith("/git/trees") && options.method === "POST") return response({ sha: "ui-tree-sha" });
    if (url.endsWith("/git/commits") && options.method === "POST") return response({ sha: "ui-commit-sha" });
    if (url.endsWith("/git/refs") && options.method === "POST") return response({}, 201);
    throw new Error(`unexpected URL: ${url}`);
  };
  const adapter = new GitHubPagesDeploymentAdapter({
    token: "test-token",
    fetchImpl,
    releaseBundleSha256: () => BUNDLE_SHA256,
    releaseArtifactReader: ({ artifactKey }) => files.get(artifactKey),
    verifyRetries: 1,
    pagesUrl: "https://unow-dev.github.io/mi-comopt/",
  });

  const ensured = await adapter.ensureDeployment({ deploymentRequestId: "deployment-v3-ui-1", releaseId: "release-v3-ui-1", target: "production" });
  assert.equal(ensured.status, "requested");
  assert.equal(createdBlobs.length, 5);
  const dispatch = calls.find((call) => call.url.includes("/actions/workflows/") && call.options.method === "POST");
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    ref: "codex/ui-release/deployment-v3-ui-1",
    inputs: {
      deployment_request_id: "deployment-v3-ui-1",
      release_id: "release-v3-ui-1",
      release_bundle_sha256: BUNDLE_SHA256,
      ui_release_manifest_sha256: uiManifestSha256,
    },
  });
  const verified = await adapter.verifyDeployment({ deploymentRequestId: "deployment-v3-ui-1", releaseId: "release-v3-ui-1", target: "production" });
  assert.equal(verified.verified, true);
});

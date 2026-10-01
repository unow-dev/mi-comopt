import assert from "node:assert/strict";
import test from "node:test";
import { loadReleaseSession } from "../src/ui/release-client.js";

const sha = (value) => `sha256:${value.repeat(64)}`;

function manifest() {
  const sourceSha = sha("a");
  const artifact = (key, artifactSha = sha("b")) => ({
    path: `artifacts/${key}.json`,
    artifact_sha256: artifactSha,
    record_count: 0,
  });

  return {
    schema_version: 1,
    generated_at: "2026-10-01T00:00:00Z",
    source: {
      db_schema_version: 8,
      source_dataset_artifact_sha256: sourceSha,
      snapshot_ref: { payload_sha256: "c".repeat(64), snapshot_index: 0 },
      keyword_publication: {
        run_id: "keyword-run",
        published_at: "2026-10-01T00:00:00Z",
        applied_at: "2026-10-01T00:00:01Z",
        candidates_content_sha256: sha("d"),
      },
    },
    policies: { keyword: { content_sha256: sha("e") }, account: { content_sha256: sha("f") } },
    artifacts: {
      comments: artifact("comments", sourceSha),
      overview: artifact("overview"),
      keywords: artifact("keywords"),
      accounts: artifact("accounts"),
    },
  };
}

const response = (body) => ({ ok: true, text: async () => body });

test("release client exposes cached artifacts synchronously and reuses cache hits", async () => {
  const calls = [];
  const client = await loadReleaseSession({
    fetchImpl: async (url) => {
      calls.push(url);
      return response(url === "optimicom-ui-release.json" ? JSON.stringify(manifest()) : "[]");
    },
  });

  assert.equal(client.getCachedArtifact("keywords"), null);
  const artifact = await client.loadArtifact("keywords");
  assert.deepEqual(artifact, []);
  assert.equal(client.getCachedArtifact("keywords"), artifact);
  assert.equal(await client.loadArtifact("keywords"), artifact);
  assert.equal(calls.length, 2);
});

test("release client shares an in-flight artifact request", async () => {
  const calls = [];
  let resolveArtifact;
  const client = await loadReleaseSession({
    fetchImpl: (url) => {
      calls.push(url);
      if (url === "optimicom-ui-release.json") return Promise.resolve(response(JSON.stringify(manifest())));
      return new Promise((resolve) => { resolveArtifact = () => resolve(response("[]")); });
    },
  });

  const first = client.loadArtifact("keywords");
  const second = client.loadArtifact("keywords");
  assert.equal(first, second);
  assert.equal(calls.length, 2);
  resolveArtifact();
  assert.deepEqual(await first, []);
  assert.deepEqual(client.getCachedArtifact("keywords"), []);
});

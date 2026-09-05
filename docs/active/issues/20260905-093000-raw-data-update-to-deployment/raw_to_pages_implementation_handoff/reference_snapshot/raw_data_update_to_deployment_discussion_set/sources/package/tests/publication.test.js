import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishBundleAtomically, readCurrentPublication } from "../scripts/adapters/keyword-publication.js";

test("publication promotes a complete bundle and rejects stale parents without changing current", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-publication-test-"));
  const first = publishBundleAtomically({
    rootDir: root,
    runId: "run_123e4567-e89b-42d3-a456-426614174000",
    baseRunId: null,
    baseRegistryContentSha256: undefined,
    files: {
      "candidate_registry.json": { schema_version: 1, candidates: {} },
      "filterKeywordCandidates.json": [],
      "filterKeywordCandidates.meta.json": {
        schema_version: 1,
        run_id: "run_123e4567-e89b-42d3-a456-426614174000",
        registry_content_sha256: "sha256:" + "0".repeat(64),
      },
    },
  });
  assert.equal(fs.existsSync(path.join(first.currentDir, "candidate_registry.json")), true);
  const before = JSON.stringify(readCurrentPublication(root));
  assert.throws(
    () => publishBundleAtomically({
      rootDir: root,
      runId: "run_223e4567-e89b-42d3-a456-426614174000",
      baseRunId: "run_123e4567-e89b-42d3-a456-426614174000",
      baseRegistryContentSha256: "sha256:" + "1".repeat(64),
      files: { "candidate_registry.json": { changed: true } },
    }),
    (caught) => caught.code === "STALE_PARENT",
  );
  assert.equal(JSON.stringify(readCurrentPublication(root)), before);
});

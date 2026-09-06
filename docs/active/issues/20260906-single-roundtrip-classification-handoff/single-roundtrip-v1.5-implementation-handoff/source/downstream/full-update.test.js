import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildCandidateView,
  buildPreEvaluation,
  contentSha256,
  evaluateCandidates,
  makeGenerationRequest,
} from "../src/processing/keyword-candidates/candidate-workflow.js";
import { prepareFullUpdate } from "../src/processing/keyword-candidates/update-flow.js";

const contracts = path.resolve("contracts");
const policy = JSON.parse(fs.readFileSync(path.join(contracts, "keyword-candidates/evaluation-policy-1.0.0.json"), "utf8"));
const taxonomy = JSON.parse(fs.readFileSync(path.join(contracts, "keyword-candidates/taxonomy-1.0.0.json"), "utf8"));
const dataset = JSON.parse(fs.readFileSync("tests/fixtures/e2e-dataset.json", "utf8"));
const artifactSha256 = dataset.artifact_sha256;

test("fixture full_update issues an add ID once and records first publication", () => {
  const registry = { schema_version: 1, candidates: {} };
  const evaluation = evaluateCandidates({ registry, dataset, policy, taxonomy, artifactSha256 });
  const request = makeGenerationRequest({
    requestId: "cgr_123e4567-e89b-42d3-a456-426614174000",
    baseRunId: "run_123e4567-e89b-42d3-a456-426614174000",
    baseRegistryContentSha256: contentSha256(registry),
    sourceDatasetArtifactSha256: artifactSha256,
    sourceDatasetArtifactRef: "fixture://e2e-dataset",
    candidateView: buildCandidateView(registry),
    preEvaluation: buildPreEvaluation(evaluation),
    evaluationPolicy: { version: policy.policy_version, content_sha256: contentSha256(policy) },
    taxonomy: { version: taxonomy.taxonomy_version, content_sha256: contentSha256(taxonomy) },
  });
  const proposal = {
    schema_version: 1,
    request_id: request.request_id,
    input_fingerprint: request.input_fingerprint,
    actions: [{ action: "add", keyword: "新しい候補", variants: ["新しい候補"], category_id: "copypasta_spam" }],
  };
  const parentManifest = {
    run_id: "run_123e4567-e89b-42d3-a456-426614174000",
    registry_after_content_sha256: contentSha256(registry),
  };
  const prepared = prepareFullUpdate({
    request,
    proposal,
    registry,
    dataset,
    policy,
    taxonomy,
    publishedAt: "2026-08-25T15:54:00Z",
    runId: "run_223e4567-e89b-42d3-a456-426614174000",
    parentManifest,
    candidateIdFactory: () => "kw_223e4567-e89b-42d3-a456-426614174000",
  });
  const added = prepared.registryAfter.candidates["kw_223e4567-e89b-42d3-a456-426614174000"];
  assert.equal(prepared.changeSet.actions[0].candidate_id, "kw_223e4567-e89b-42d3-a456-426614174000");
  assert.equal(added.first_publication_state, "published_at_known");
  assert.equal(added.introduced_at, "2026-08-25T15:54:00Z");
  assert.equal(prepared.publishedCandidates[0].introduced_at, "2026-08-25T15:54:00Z");
  assert.equal(prepared.manifest.parent_manifest_content_sha256, contentSha256(parentManifest));
});

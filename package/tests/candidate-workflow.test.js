import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildCandidateView,
  buildPreEvaluation,
  buildPublishedCandidates,
  canonicalizeVariants,
  canonicalizeProposal,
  conflictSet,
  contentSha256,
  evaluateCandidates,
  makeBootstrapRegistry,
  makeGenerationRequest,
  normalizeText,
  recommendationFor,
  validateDataset,
  validateProposal,
} from "../src/processing/keyword-candidates/candidate-workflow.js";
import { isNewCandidate } from "../src/ui/new-badge.js";
import { prepareFullUpdate } from "../src/processing/keyword-candidates/update-flow.js";

const contracts = path.resolve("contracts");
const handoff = path.resolve("../docs/active/issues/20260824-065153-candidate-keyword-update-flow/candidate_keyword_update_handoff_v1.0.0");
const policy = JSON.parse(fs.readFileSync(path.join(contracts, "keyword-candidates/evaluation-policy-1.0.0.json"), "utf8"));
const taxonomy = JSON.parse(fs.readFileSync(path.join(contracts, "keyword-candidates/taxonomy-1.0.0.json"), "utf8"));
const normalizationVectors = JSON.parse(fs.readFileSync(path.join(handoff, "fixtures/normalization_vectors.json"), "utf8"));
const recommendationCases = JSON.parse(fs.readFileSync(path.join(handoff, "fixtures/recommendation_boundary_cases.json"), "utf8"));

const artifactSha256 = "sha256:" + "0".repeat(64);
const runId = "run_123e4567-e89b-42d3-a456-426614174000";

test("normalization vectors follow the fixed operation order", () => {
  for (const vector of normalizationVectors.vectors) assert.equal(normalizeText(vector.input), vector.expected);
});

test("recommendation thresholds compare exact integer ratios and ignore reactive", () => {
  for (const item of recommendationCases.cases) {
    assert.equal(recommendationFor(item.D, item.R, item.N, policy), item.expected_recommendation, item.name);
  }
});

test("variants are canonical and multiple matches in one comment count once", () => {
  assert.deepEqual(canonicalizeVariants("DM", ["dm", "DM", " ＤＭ "]), ["DM"]);
  const registry = {
    schema_version: 1,
    candidates: {
      "kw_123e4567-e89b-42d3-a456-426614174000": {
        status: "active",
        keyword: "DM",
        variants: ["DM"],
        category_id: "spam_solicitation",
        created_at: "2026-08-24T15:54:00Z",
        last_changed_at: "2026-08-24T15:54:00Z",
        first_publication_state: "published_at_unknown",
        introduced_at: null,
      },
    },
  };
  const dataset = [
    { comment: "ＤＭ dm DM", label: "direct_nuisance" },
    { comment: "ordinary", label: "normal" },
    { comment: "reference", label: "reactive" },
  ];
  const evaluation = evaluateCandidates({ registry, dataset, policy, taxonomy, artifactSha256 });
  assert.equal(evaluation.candidates[0].direct_nuisance_hits, 1);
  assert.equal(evaluation.candidates[0].reactive_hits, 0);
  assert.equal(evaluation.candidates[0].normal_hits, 0);
  const reactiveChanged = evaluateCandidates({
    registry,
    dataset: [...dataset, { comment: "DM", label: "reactive" }],
    policy,
    taxonomy,
    artifactSha256,
  });
  assert.equal(reactiveChanged.candidates[0].precision_excluding_reactive, evaluation.candidates[0].precision_excluding_reactive);
  assert.equal(reactiveChanged.candidates[0].recommendation, evaluation.candidates[0].recommendation);
});

test("bootstrap preserves 187 identities and canonicalizes only structure", () => {
  const legacy = JSON.parse(fs.readFileSync(path.join(handoff, "reference/legacy_filterKeywordCandidates.json"), "utf8"));
  const idMap = JSON.parse(fs.readFileSync(path.join(handoff, "reference/bootstrap_candidate_id_map.json"), "utf8"));
  const registry = makeBootstrapRegistry({ legacyCandidates: legacy, idMap, taxonomy, publishedAt: "2026-08-24T15:54:00Z" });
  assert.equal(Object.keys(registry.candidates).length, 187);
  assert.equal([...conflictSet(registry)].length, 1);
  assert.equal(registry.candidates[idMap.entries[0].candidate_id].introduced_at, null);
});

test("candidate view contains active and retired IDs in deterministic order", () => {
  const registry = {
    schema_version: 1,
    candidates: {
      "kw_223e4567-e89b-42d3-a456-426614174000": { status: "retired", keyword: "B", variants: ["B"], category_id: "reaction" },
      "kw_123e4567-e89b-42d3-a456-426614174000": { status: "active", keyword: "A", variants: ["A"], category_id: "reaction" },
    },
  };
  assert.deepEqual(buildCandidateView(registry).candidates.map((item) => item.candidate_id), [
    "kw_123e4567-e89b-42d3-a456-426614174000",
    "kw_223e4567-e89b-42d3-a456-426614174000",
  ]);
});

test("NEW boundary is strict and legacy null never becomes NEW", () => {
  const introduced = "2026-08-24T15:54:00Z";
  const start = new Date(introduced);
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  assert.equal(isNewCandidate(null, start), false);
  assert.equal(isNewCandidate(introduced, start), true);
  assert.equal(isNewCandidate(introduced, new Date(end.getTime() - 1000)), true);
  assert.equal(isNewCandidate(introduced, end), false);
  assert.equal(isNewCandidate(introduced, new Date(end.getTime() + 1000)), false);
});

test("empty proposal is valid and full_update remains deterministic", () => {
  const registry = {
    schema_version: 1,
    candidates: {
      "kw_123e4567-e89b-42d3-a456-426614174000": {
        status: "active",
        keyword: "DM",
        variants: ["DM"],
        category_id: "spam_solicitation",
        created_at: "2026-08-24T15:54:00Z",
        last_changed_at: "2026-08-24T15:54:00Z",
        first_publication_state: "published_at_unknown",
        introduced_at: null,
      },
    },
  };
  const dataset = [
    { comment: "DM", label: "direct_nuisance" },
    { comment: "ordinary", label: "normal" },
  ];
  const evaluation = evaluateCandidates({ registry, dataset, policy, taxonomy, artifactSha256 });
  const view = buildCandidateView(registry);
  const pre = buildPreEvaluation(evaluation);
  const request = makeGenerationRequest({
    requestId: "cgr_123e4567-e89b-42d3-a456-426614174000",
    baseRunId: runId,
    baseRegistryContentSha256: contentSha256(registry),
    sourceDatasetArtifactSha256: artifactSha256,
    sourceDatasetArtifactRef: "fixture://dataset",
    candidateView: view,
    preEvaluation: pre,
    evaluationPolicy: { version: policy.policy_version, content_sha256: contentSha256(policy) },
    taxonomy: { version: taxonomy.taxonomy_version, content_sha256: contentSha256(taxonomy) },
  });
  const proposal = { schema_version: 1, request_id: request.request_id, input_fingerprint: request.input_fingerprint, actions: [] };
  assert.equal(validateProposal(proposal, { request, registry, taxonomy }), true);
  const prepared = prepareFullUpdate({
    request,
    proposal,
    registry,
    dataset,
    policy,
    taxonomy,
    candidateView: view,
    preEvaluation: pre,
    publishedAt: "2026-08-25T15:54:00Z",
    runId: "run_223e4567-e89b-42d3-a456-426614174000",
    knownConflictKeys: [],
  });
  assert.equal(prepared.changeSet.actions.length, 0);
  assert.equal(prepared.publishedCandidates.length, 1);
  assert.equal(prepared.registryAfter.candidates["kw_123e4567-e89b-42d3-a456-426614174000"].introduced_at, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  toAccountCandidateModel,
  toKeywordCandidateModel,
  toThreeClassLabelSummaryModel,
  toWorkflowConfigModel,
} from "../src/ui/candidate-data-adapter.js";

test("keyword artifact is converted to the UI model without unused artifact fields", () => {
  const artifact = {
    candidate_id: "kw_123",
    keyword: "DM",
    variants: ["DM", "ｄｍ"],
    category_id: "spam",
    category: "スパム",
    recommendation: "高推奨",
    match_type: "normalized_substring",
    direct_nuisance_hits: 3,
    reactive_hits: 1,
    normal_hits: 0,
    precision_excluding_reactive: 1,
    direct_recall_contribution: 0.1,
    normal_hit_rate: 0,
    utility_score: 3,
    introduced_at: "2026-09-01T00:00:00Z",
  };

  const model = toKeywordCandidateModel(artifact);
  assert.deepEqual(model, {
    candidateId: "kw_123",
    keyword: "DM",
    variants: ["DM", "ｄｍ"],
    category: "スパム",
    recommendation: "高推奨",
    matchType: "normalized_substring",
    directNuisanceHits: 3,
    reactiveHits: 1,
    normalHits: 0,
    precisionExcludingReactive: 1,
    introducedAt: "2026-09-01T00:00:00Z",
  });
  assert.equal("candidate_id" in model, false);
  assert.equal("utilityScore" in model, false);
  assert.notEqual(model.variants, artifact.variants);
});

test("account artifact is converted to a focused UI evidence model", () => {
  const artifact = {
    handle: "alice",
    direct_nuisance_count: 2,
    evidence_sample: [{ comment: "DM", postedAt: "9-1", postedDate: "2026-09-01", ignored: true }],
  };

  const model = toAccountCandidateModel(artifact);
  assert.deepEqual(model, {
    handle: "alice",
    directNuisanceCount: 2,
    evidence: [{ comment: "DM", postedAt: "9-1", postedDate: "2026-09-01" }],
  });
  assert.equal("evidence_sample" in model, false);
});

test("workflow config is converted to the UI model", () => {
  assert.deepEqual(toWorkflowConfigModel({ new_keyword_display_days: 14 }), {
    newKeywordDisplayDays: 14,
  });
});

test("three-class label summary is converted to the UI model", () => {
  assert.deepEqual(toThreeClassLabelSummaryModel({
    schema_version: 1,
    snapshot_ref: {
      payload_sha256: "a".repeat(64),
      snapshot_index: 0,
    },
    total: 10,
    counts: {
      direct_nuisance: 2,
      reactive: 3,
      normal: 5,
    },
  }), {
    snapshotRef: `${"a".repeat(64)}:0`,
    total: 10,
    counts: {
      directNuisance: 2,
      reactive: 3,
      normal: 5,
    },
  });
});

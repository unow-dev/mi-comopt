export function toKeywordCandidateModel(candidate) {
  return {
    candidateId: candidate.candidate_id,
    keyword: candidate.keyword,
    variants: [...candidate.variants],
    category: candidate.category,
    recommendation: candidate.recommendation,
    matchType: candidate.match_type,
    directNuisanceHits: candidate.direct_nuisance_hits,
    reactiveHits: candidate.reactive_hits,
    normalHits: candidate.normal_hits,
    precisionExcludingReactive: candidate.precision_excluding_reactive,
    introducedAt: candidate.introduced_at,
  };
}

export function toAccountCandidateModel(candidate) {
  return {
    handle: candidate.handle,
    directNuisanceCount: candidate.direct_nuisance_count,
    evidence: candidate.evidence_sample.map(({ comment, postedAt, postedDate }) => ({
      comment,
      postedAt,
      postedDate,
    })),
  };
}

export function toWorkflowConfigModel(config) {
  return {
    newKeywordDisplayDays: config.new_keyword_display_days,
  };
}

export function toThreeClassLabelSummaryModel(summary) {
  return {
    snapshotRef: `${summary.snapshot_ref.payload_sha256}:${summary.snapshot_ref.snapshot_index}`,
    total: summary.total,
    counts: {
      directNuisance: summary.counts.direct_nuisance,
      reactive: summary.counts.reactive,
      normal: summary.counts.normal,
    },
  };
}

export function adaptKeywordCandidates(candidates) {
  return candidates.map(toKeywordCandidateModel);
}

export function adaptAccountCandidates(candidates) {
  return candidates.map(toAccountCandidateModel);
}

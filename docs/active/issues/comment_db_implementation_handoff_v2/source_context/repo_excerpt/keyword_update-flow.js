import {
  applyChangeSet,
  advanceFirstPublicationHistory,
  buildCandidateView,
  buildCurrentMeta,
  buildPreEvaluation,
  buildPublishedCandidates,
  canonicalizeProposal,
  contentSha256,
  evaluateCandidates,
  makeArtifactRef,
  makeRunManifest,
  validateProposal,
} from "./candidate-workflow.js";

export function validateParentManifest({ parentManifest, request }) {
  if (!parentManifest || typeof parentManifest !== "object" || Array.isArray(parentManifest)) {
    const error = new Error("parent manifest must be a JSON object");
    error.code = "PARENT_MANIFEST_MISMATCH";
    throw error;
  }
  if (parentManifest.run_id !== request.base_publication?.run_id) {
    const error = new Error("parent manifest run_id does not match request base publication");
    error.code = "PARENT_MANIFEST_MISMATCH";
    throw error;
  }
  if (parentManifest.registry_after_content_sha256 !== request.base_publication?.registry_content_sha256) {
    const error = new Error("parent manifest registry_after_content_sha256 does not match request base publication");
    error.code = "PARENT_MANIFEST_MISMATCH";
    throw error;
  }
  return true;
}

export function prepareFullUpdate({
  request,
  proposal,
  registry,
  dataset,
  policy,
  taxonomy,
  candidateView,
  preEvaluation,
  publishedAt,
  startedAt = publishedAt,
  completedAt = publishedAt,
  runId,
  parentManifestContentSha256 = null,
  parentManifest,
  evaluator,
  candidateIdFactory,
  knownConflictKeys = [],
}) {
  if (parentManifest) {
    validateParentManifest({ parentManifest, request });
    parentManifestContentSha256 = contentSha256(parentManifest);
  }
  validateProposal(proposal, { request, registry, taxonomy });
  if (contentSha256(registry) !== request.base_publication.registry_content_sha256) {
    const staleError = new Error("base registry content hash does not match request");
    staleError.code = "STALE_PARENT";
    throw staleError;
  }

  if (
    policy.policy_version !== request.evaluation_policy.version ||
    contentSha256(policy) !== request.evaluation_policy.content_sha256 ||
    taxonomy.taxonomy_version !== request.taxonomy.version ||
    contentSha256(taxonomy) !== request.taxonomy.content_sha256
  ) {
    const bindingError = new Error("policy or taxonomy does not match request");
    bindingError.code = "REQUEST_ARTIFACT_MISMATCH";
    throw bindingError;
  }

  const canonicalChangeSet = canonicalizeProposal(
    proposal,
    { request, registry, taxonomy },
    { candidateIdFactory },
  );
  const actualCandidateView = candidateView ?? buildCandidateView(registry);
  const baseEvaluation = evaluateCandidates({
    registry,
    dataset,
    policy,
    policyContentSha256: request.evaluation_policy.content_sha256,
    taxonomy,
    artifactSha256: request.source_dataset.artifact_sha256,
    knownConflictKeys,
  });
  const actualPreEvaluation = preEvaluation ?? buildPreEvaluation(baseEvaluation);
  if (contentSha256(actualCandidateView) !== request.candidate_view.content_sha256) {
    const bindingError = new Error("candidate_view does not match request fingerprint");
    bindingError.code = "REQUEST_ARTIFACT_MISMATCH";
    throw bindingError;
  }
  if (contentSha256(actualPreEvaluation) !== request.pre_evaluation.content_sha256) {
    const bindingError = new Error("pre_evaluation does not match request fingerprint");
    bindingError.code = "REQUEST_ARTIFACT_MISMATCH";
    throw bindingError;
  }
  const semanticRegistryAfter = applyChangeSet(registry, canonicalChangeSet, {
    publishedAt,
    taxonomy,
    knownConflictKeys,
  });
  const evaluation = evaluateCandidates({
    registry: semanticRegistryAfter,
    dataset,
    policy,
    policyContentSha256: request.evaluation_policy.content_sha256,
    taxonomy,
    artifactSha256: request.source_dataset.artifact_sha256,
    knownConflictKeys,
  });
  const registryAfter = advanceFirstPublicationHistory(semanticRegistryAfter, evaluation, publishedAt);
  const publishedCandidates = buildPublishedCandidates({ registry: registryAfter, evaluation, taxonomy });
  const artifacts = {
    candidate_view: makeArtifactRef("candidate_view.json", actualCandidateView),
    pre_evaluation: makeArtifactRef("pre_evaluation.json", actualPreEvaluation),
    candidate_generation_request: makeArtifactRef("candidate_generation_request.json", request),
    candidate_proposal: makeArtifactRef("candidate_proposal.json", proposal),
    candidate_change_set: makeArtifactRef("candidate_change_set.json", canonicalChangeSet),
    candidate_evaluation: makeArtifactRef("candidate_evaluation.json", evaluation),
  };
  const sourceDataset = request.source_dataset;
  const evaluationPolicy = request.evaluation_policy;
  const requestTaxonomy = request.taxonomy;
  const manifest = makeRunManifest({
    runId,
    runType: "full_update",
    baseRunId: request.base_publication.run_id,
    parentManifestContentSha256,
    startedAt,
    completedAt,
    publishedAt,
    sourceDataset,
    evaluationPolicy,
    taxonomy: requestTaxonomy,
    registryBefore: registry,
    registryAfter,
    artifacts,
    evaluator,
    publishedCandidates,
  });
  const currentMeta = buildCurrentMeta({
    runId,
    runManifest: manifest,
    publishedAt,
    publishedCandidates,
    registry: registryAfter,
    datasetArtifactSha256: request.source_dataset.artifact_sha256,
    evaluationPolicy,
    taxonomy: requestTaxonomy,
  });
  return {
    runId,
    registryBefore: registry,
    registryAfter,
    candidateView: actualCandidateView,
    preEvaluation: actualPreEvaluation,
    request,
    proposal,
    changeSet: canonicalChangeSet,
    evaluation,
    publishedCandidates,
    manifest,
    currentMeta,
    files: {
      "candidate_registry.json": registryAfter,
      "filterKeywordCandidates.json": publishedCandidates,
      "filterKeywordCandidates.meta.json": currentMeta,
      "run_manifest.json": manifest,
      "candidate_evaluation.json": evaluation,
      "candidate_view.json": actualCandidateView,
      "pre_evaluation.json": actualPreEvaluation,
      "candidate_generation_request.json": request,
      "candidate_proposal.json": proposal,
      "candidate_change_set.json": canonicalChangeSet,
    },
  };
}

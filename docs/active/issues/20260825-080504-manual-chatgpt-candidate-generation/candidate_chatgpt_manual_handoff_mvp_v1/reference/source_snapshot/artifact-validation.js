import {
  buildPublishedCandidates,
  contentSha256,
  conflictSet,
  validateRegistry,
  WorkflowValidationError,
} from "./candidate-workflow.js";

function issue(code, path, message) {
  return { code, path, message };
}
function exactKeys(value, expected, path, errors) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (actual.join("\u001f") !== wanted.join("\u001f")) errors.push(issue("ADDITIONAL_PROPERTY", path, `フィールドが契約と一致しません: ${actual.join(", ")}`));
}

function checkSha(value, path, errors) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) errors.push(issue("INVALID_SHA256", path, "sha256:<64 lowercase hex> が必要です"));
}

function checkTimestamp(value, path, errors) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) errors.push(issue("INVALID_TIMESTAMP", path, "UTC秒精度のtimestampが必要です"));
}

export function validateGeneratedArtifacts({ registry, evaluation, publishedCandidates, currentMeta, manifest, taxonomy }) {
  const errors = [];
  try {
    validateRegistry(registry, taxonomy, { knownConflictKeys: [...conflictSet(registry)] });
  } catch (caught) {
    if (caught instanceof WorkflowValidationError) errors.push(...caught.errors);
    else throw caught;
  }
  if (evaluation?.schema_version !== 1 || !Array.isArray(evaluation?.candidates)) errors.push(issue("INVALID_EVALUATION", "candidate_evaluation", "evaluation artifactが不正です"));
  else {
    const activeIds = Object.entries(registry.candidates).filter(([, candidate]) => candidate.status === "active").map(([id]) => id).sort();
    const evaluationIds = evaluation.candidates.map((candidate) => candidate.candidate_id).sort();
    if (activeIds.join("\u001f") !== evaluationIds.join("\u001f")) errors.push(issue("EVALUATION_CANDIDATE_SET_MISMATCH", "candidate_evaluation.candidates", "active candidate全件の評価結果が必要です"));
    checkSha(evaluation.dataset?.artifact_sha256, "candidate_evaluation.dataset.artifact_sha256", errors);
    checkSha(evaluation.evaluation_policy?.content_sha256, "candidate_evaluation.evaluation_policy.content_sha256", errors);
  }
  if (!Array.isArray(publishedCandidates)) errors.push(issue("INVALID_PUBLISHED_CANDIDATES", "filterKeywordCandidates", "published candidatesは配列である必要があります"));
  else {
    try {
      const expected = buildPublishedCandidates({ registry, evaluation, taxonomy });
      if (JSON.stringify(expected) !== JSON.stringify(publishedCandidates)) errors.push(issue("DERIVED_ARTIFACT_MISMATCH", "filterKeywordCandidates", "registry + evaluation + taxonomyからの再構成結果と一致しません"));
    } catch (caught) {
      if (caught instanceof WorkflowValidationError) errors.push(...caught.errors);
      else throw caught;
    }
  }
  if (!manifest || manifest.schema_version !== 1) errors.push(issue("INVALID_RUN_MANIFEST", "run_manifest", "run manifestが不正です"));
  else {
    checkSha(manifest.registry_after_content_sha256, "run_manifest.registry_after_content_sha256", errors);
    checkSha(manifest.published_candidates_content_sha256, "run_manifest.published_candidates_content_sha256", errors);
    if (manifest.registry_after_content_sha256 !== contentSha256(registry)) errors.push(issue("REGISTRY_HASH_MISMATCH", "run_manifest.registry_after_content_sha256", "registry hashが一致しません"));
    if (manifest.published_candidates_content_sha256 !== contentSha256(publishedCandidates)) errors.push(issue("PUBLISHED_HASH_MISMATCH", "run_manifest.published_candidates_content_sha256", "published candidates hashが一致しません"));
  }
  if (!currentMeta || currentMeta.schema_version !== 1) errors.push(issue("INVALID_CURRENT_META", "filterKeywordCandidates.meta", "current metaが不正です"));
  else {
    for (const [key, value] of Object.entries({
      run_manifest_content_sha256: contentSha256(manifest),
      candidates_content_sha256: contentSha256(publishedCandidates),
      registry_content_sha256: contentSha256(registry),
    })) if (currentMeta[key] !== value) errors.push(issue("CURRENT_META_HASH_MISMATCH", `current_meta.${key}`, "current metaのhashが一致しません"));
    checkTimestamp(currentMeta.published_at, "current_meta.published_at", errors);
  }
  if (errors.length) throw new WorkflowValidationError(errors, "生成成果物の再構成検証に失敗しました");
  return true;
}

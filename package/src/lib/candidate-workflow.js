import crypto from "node:crypto";

export const ALLOWED_LABELS = ["direct_nuisance", "reactive", "normal"];
export const RECOMMENDATION_ORDER = { "高推奨": 0, "中推奨": 1, 任意: 2 };
export const DEFAULT_NEW_KEYWORD_DISPLAY_DAYS = 14;

const REMOVED_CODE_POINTS = /[\u200B\u200C\u200D\u2060\uFEFF]/gu;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_PATTERN = /^kw_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_ID_PATTERN = /^cgr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_ID_PATTERN = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class WorkflowValidationError extends Error {
  constructor(errors, message = "候補キーワード契約の検証に失敗しました") {
    super(message);
    this.name = "WorkflowValidationError";
    this.errors = errors;
  }
}

function error(code, path, message, details = undefined) {
  return { code, path, message, ...(details ? { details } : {}) };
}

function fail(errors) {
  if (errors.length) throw new WorkflowValidationError(errors);
}

function assertSha256(value, path, errors) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    errors.push(error("INVALID_SHA256", path, "sha256:<64 lowercase hex> が必要です"));
  }
}

function assertCandidateId(value, path, errors) {
  if (typeof value !== "string" || !CANDIDATE_ID_PATTERN.test(value)) {
    errors.push(error("INVALID_CANDIDATE_ID", path, "UUIDv4形式のcandidate_idが必要です"));
  }
}

function assertRunId(value, path, errors) {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    errors.push(error("INVALID_RUN_ID", path, "UUIDv4形式のrun_idが必要です"));
  }
}

function assertRequestId(value, path, errors) {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    errors.push(error("INVALID_REQUEST_ID", path, "UUIDv4形式のrequest_idが必要です"));
  }
}

function assertTimestamp(value, path, errors) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    errors.push(error("INVALID_TIMESTAMP", path, "UTC秒精度のtimestampが必要です"));
  }
}

/**
 * RFC 8785で使うJSON Canonicalization Schemeの、JSON値に対する実装です。
 * リポジトリの契約ではJSONの数値は有限値だけなので、ECMAScriptのJSON数値表現を利用します。
 */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON number must be finite");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
}

export function contentSha256(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function assertJsonFinite(value, path = "$") {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`JSON number must be finite at ${path}`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => assertJsonFinite(item, `${path}[${index}]`));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, item]) => assertJsonFinite(item, `${path}.${key}`));
  }
}

export function prettyJson(value) {
  assertJsonFinite(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function normalizeText(value) {
  if (typeof value !== "string") throw new TypeError("normalizeText expects a string");
  return value
    .replace(REMOVED_CODE_POINTS, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function codePointLength(value) {
  return Array.from(value).length;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * `variants`を実際のmatch集合へ正規化します。keywordのraw exact値は常に先頭に保持します。
 */
export function canonicalizeVariants(keyword, variants) {
  if (typeof keyword !== "string" || keyword.length === 0) {
    throw new WorkflowValidationError([error("EMPTY_KEYWORD", "keyword", "keywordは空にできません")]);
  }
  if (normalizeText(keyword).length === 0) {
    throw new WorkflowValidationError([error("EMPTY_NORMALIZED_KEYWORD", "keyword", "keywordの正規化結果が空です")]);
  }
  if (!Array.isArray(variants)) {
    throw new WorkflowValidationError([error("INVALID_VARIANTS", "variants", "variantsは配列である必要があります")]);
  }

  const rawValues = [keyword, ...variants];
  const seenRaw = new Set();
  const seenNormalized = new Set();
  const others = [];
  for (const raw of rawValues) {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new WorkflowValidationError([error("EMPTY_VARIANT", "variants", "variantは空にできません")]);
    }
    const normalized = normalizeText(raw);
    if (normalized.length === 0) {
      throw new WorkflowValidationError([error("EMPTY_NORMALIZED_VARIANT", "variants", "variantの正規化結果が空です")]);
    }
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    if (seenNormalized.has(normalized)) continue;
    seenNormalized.add(normalized);
    if (raw !== keyword) others.push({ raw, normalized });
  }

  others.sort((left, right) => compareStrings(left.normalized, right.normalized) || compareStrings(left.raw, right.raw));
  return [keyword, ...others.map((item) => item.raw)];
}

function taxonomyMap(taxonomy) {
  const categories = taxonomy?.categories;
  if (!Array.isArray(categories)) throw new WorkflowValidationError([error("INVALID_TAXONOMY", "taxonomy.categories", "taxonomy.categoriesが必要です")]);
  return new Map(categories.map((category) => [category.category_id, category]));
}

export function canonicalizeCandidate(candidate, taxonomy) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    throw new WorkflowValidationError([error("INVALID_CANDIDATE", "candidate", "candidateはobjectである必要があります")]);
  }
  if (candidate.candidate_id !== undefined) assertCandidateId(candidate.candidate_id, "candidate_id", errors);
  if (typeof candidate.keyword !== "string" || candidate.keyword.length === 0) errors.push(error("EMPTY_KEYWORD", "keyword", "keywordは空にできません"));
  if (typeof candidate.category_id !== "string") errors.push(error("INVALID_CATEGORY_ID", "category_id", "category_idが必要です"));
  const categories = taxonomy ? taxonomyMap(taxonomy) : null;
  if (categories && typeof candidate.category_id === "string" && !categories.has(candidate.category_id)) {
    errors.push(error("UNKNOWN_CATEGORY_ID", "category_id", "taxonomyに存在しないcategory_idです"));
  }
  fail(errors);

  try {
    return {
      ...(candidate.candidate_id ? { candidate_id: candidate.candidate_id } : {}),
      keyword: candidate.keyword,
      variants: canonicalizeVariants(candidate.keyword, candidate.variants),
      category_id: candidate.category_id,
    };
  } catch (caught) {
    if (caught instanceof WorkflowValidationError) throw caught;
    throw new WorkflowValidationError([error("INVALID_CANDIDATE", "candidate", caught.message)]);
  }
}

function collectVariantInvariantErrors(candidate, path, errors) {
  if (!Array.isArray(candidate.variants)) {
    errors.push(error("INVALID_VARIANTS", `${path}.variants`, "variantsは配列である必要があります"));
    return;
  }
  if (!candidate.variants.includes(candidate.keyword)) errors.push(error("KEYWORD_NOT_IN_VARIANTS", `${path}.variants`, "keywordのraw exact値がvariantsに必要です"));
  const raw = new Set();
  const normalized = new Set();
  candidate.variants.forEach((variant, index) => {
    if (typeof variant !== "string" || variant.length === 0) {
      errors.push(error("EMPTY_VARIANT", `${path}.variants[${index}]`, "variantは空にできません"));
      return;
    }
    if (raw.has(variant)) errors.push(error("DUPLICATE_VARIANT", `${path}.variants[${index}]`, "raw variant重複は禁止です"));
    raw.add(variant);
    const normalizedVariant = normalizeText(variant);
    if (normalizedVariant.length === 0) errors.push(error("EMPTY_NORMALIZED_VARIANT", `${path}.variants[${index}]`, "variantの正規化結果が空です"));
    if (normalized.has(normalizedVariant)) errors.push(error("NORMALIZED_VARIANT_DUPLICATE", `${path}.variants[${index}]`, "candidate内normalized variant重複は禁止です"));
    normalized.add(normalizedVariant);
  });
}

function extractRecords(dataset) {
  if (Array.isArray(dataset)) return { records: dataset, metadata: {} };
  if (dataset && Array.isArray(dataset.records)) return { records: dataset.records, metadata: dataset };
  throw new WorkflowValidationError([error("INVALID_DATASET", "dataset", "datasetはrecords配列または配列である必要があります")]);
}

export function validateDataset(dataset, options = {}) {
  const { records, metadata } = extractRecords(dataset);
  const errors = [];
  const counts = Object.fromEntries(ALLOWED_LABELS.map((label) => [label, 0]));
  records.forEach((record, index) => {
    if (!record || typeof record !== "object") {
      errors.push(error("INVALID_RECORD", `records[${index}]`, "recordはobjectである必要があります"));
      return;
    }
    if (typeof record.comment !== "string") errors.push(error("INVALID_COMMENT", `records[${index}].comment`, "commentはstringである必要があります"));
    if (!ALLOWED_LABELS.includes(record.label)) errors.push(error("INVALID_LABEL", `records[${index}].label`, "labelが3-class契約外です"));
    else counts[record.label] += 1;
  });

  const artifactSha256 = options.artifactSha256 ?? metadata.artifact_sha256 ?? metadata.manifest?.artifact_sha256;
  if (artifactSha256 !== undefined) assertSha256(artifactSha256, "dataset.artifact_sha256", errors);
  if (options.artifactSha256 && metadata.artifact_sha256 && options.artifactSha256 !== metadata.artifact_sha256) {
    errors.push(error("DATASET_ARTIFACT_HASH_MISMATCH", "dataset.artifact_sha256", "source artifact SHAが一致しません"));
  }
  if (metadata.labeling_status !== undefined && metadata.labeling_status !== "published") {
    errors.push(error("DATASET_NOT_PUBLISHED", "dataset.labeling_status", "publication済みdatasetだけを受け付けます"));
  }
  if (metadata.records !== undefined && typeof metadata.records === "number" && metadata.records !== records.length) {
    errors.push(error("RECORD_COUNT_MISMATCH", "dataset.records", "record countが一致しません"));
  }
  if (counts.direct_nuisance < 1) errors.push(error("EMPTY_DIRECT_DATASET", "dataset", "direct_nuisanceが1件以上必要です"));
  if (counts.normal < 1) errors.push(error("EMPTY_NORMAL_DATASET", "dataset", "normalが1件以上必要です"));
  fail(errors);
  return {
    records,
    artifactSha256,
    counts,
    direct_nuisance_total: counts.direct_nuisance,
    reactive_total: counts.reactive,
    normal_total: counts.normal,
  };
}

function roundRatioHalfEven(numerator, denominator, decimalPlaces = 6) {
  if (denominator === 0) return null;
  const scale = 10n ** BigInt(decimalPlaces);
  const n = BigInt(numerator) * scale;
  const d = BigInt(denominator);
  let quotient = n / d;
  const remainder = n % d;
  const twice = remainder * 2n;
  if (twice > d || (twice === d && quotient % 2n === 1n)) quotient += 1n;
  return Number(quotient) / Number(scale);
}

export function ratioAtLeast(numerator, denominator, thresholdNumerator, thresholdDenominator) {
  return BigInt(numerator) * BigInt(thresholdDenominator) >= BigInt(denominator) * BigInt(thresholdNumerator);
}

export function recommendationFor(directHits, _reactiveHits, normalHits, policy) {
  const tiers = policy.recommendation_tiers ?? [];
  for (const tier of tiers) {
    if (directHits < tier.min_direct_nuisance_hits) continue;
    if (tier.max_normal_hits !== undefined && normalHits > tier.max_normal_hits) continue;
    if (tier.min_precision) {
      const denominator = directHits + normalHits;
      if (!denominator || !ratioAtLeast(directHits, denominator, tier.min_precision.numerator, tier.min_precision.denominator)) continue;
    }
    return tier.name;
  }
  return directHits > 0 ? "任意" : null;
}

function compareExactPrecision(left, right) {
  const leftDenominator = left.direct_nuisance_hits + left.normal_hits;
  const rightDenominator = right.direct_nuisance_hits + right.normal_hits;
  if (leftDenominator === 0 && rightDenominator === 0) return 0;
  if (leftDenominator === 0) return -1;
  if (rightDenominator === 0) return 1;
  const difference = BigInt(right.direct_nuisance_hits) * BigInt(leftDenominator) - BigInt(left.direct_nuisance_hits) * BigInt(rightDenominator);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function evaluationSort(left, right) {
  return compareStrings(left.candidate_id, right.candidate_id);
}

function publishedSort(left, right) {
  const recommendationDifference = (RECOMMENDATION_ORDER[left.recommendation] ?? 99) - (RECOMMENDATION_ORDER[right.recommendation] ?? 99);
  if (recommendationDifference) return recommendationDifference;
  const precisionDifference = compareExactPrecision(left, right);
  if (precisionDifference) return precisionDifference;
  if (right.direct_nuisance_hits !== left.direct_nuisance_hits) return right.direct_nuisance_hits - left.direct_nuisance_hits;
  if (left.normal_hits !== right.normal_hits) return left.normal_hits - right.normal_hits;
  const leftKeyword = normalizeText(left.keyword);
  const rightKeyword = normalizeText(right.keyword);
  const lengthDifference = codePointLength(rightKeyword) - codePointLength(leftKeyword);
  return lengthDifference || compareStrings(leftKeyword, rightKeyword) || compareStrings(left.candidate_id, right.candidate_id);
}

export function conflictSet(registry) {
  const ownersByVariant = new Map();
  for (const [candidateId, candidate] of Object.entries(registry.candidates ?? {})) {
    if (candidate.status !== "active") continue;
    for (const variant of candidate.variants) {
      const normalized = normalizeText(variant);
      const owners = ownersByVariant.get(normalized) ?? new Set();
      owners.add(candidateId);
      ownersByVariant.set(normalized, owners);
    }
  }
  return new Set(
    [...ownersByVariant.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([normalized, owners]) => `${normalized}\u001f${[...owners].sort().join(",")}`),
  );
}

export function validateRegistry(registry, taxonomy, options = {}) {
  const errors = [];
  if (!registry || registry.schema_version !== 1 || !registry.candidates || typeof registry.candidates !== "object" || Array.isArray(registry.candidates)) {
    throw new WorkflowValidationError([error("INVALID_REGISTRY", "registry", "schema_version=1とcandidates objectが必要です")]);
  }
  const categories = taxonomyMap(taxonomy);
  const canonicalById = {};
  if (Object.keys(registry).some((key) => key !== "schema_version" && key !== "candidates")) errors.push(error("REGISTRY_ADDITIONAL_PROPERTY", "registry", "registryの追加フィールドは禁止です"));
  for (const [candidateId, candidate] of Object.entries(registry.candidates)) {
    assertCandidateId(candidateId, `candidates.${candidateId}`, errors);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(error("INVALID_CANDIDATE", `candidates.${candidateId}`, "candidateはobjectである必要があります"));
      continue;
    }
    const expectedCandidateKeys = ["status", "keyword", "variants", "category_id", "created_at", "last_changed_at", "first_publication_state", "introduced_at"];
    if (Object.keys(candidate).some((key) => !expectedCandidateKeys.includes(key))) errors.push(error("CANDIDATE_ADDITIONAL_PROPERTY", `candidates.${candidateId}`, "candidateの追加フィールドは禁止です"));
    if (!candidate || !["active", "retired"].includes(candidate.status)) errors.push(error("INVALID_STATUS", `candidates.${candidateId}.status`, "statusはactive/retiredです"));
    if (!categories.has(candidate.category_id)) errors.push(error("UNKNOWN_CATEGORY_ID", `candidates.${candidateId}.category_id`, "taxonomyに存在しないcategory_idです"));
    for (const field of ["created_at", "last_changed_at"]) assertTimestamp(candidate[field], `candidates.${candidateId}.${field}`, errors);
    if (!["never_published", "published_at_known", "published_at_unknown"].includes(candidate.first_publication_state)) errors.push(error("INVALID_FIRST_PUBLICATION_STATE", `candidates.${candidateId}.first_publication_state`, "first publication stateが不正です"));
    if (candidate.first_publication_state === "published_at_known") assertTimestamp(candidate.introduced_at, `candidates.${candidateId}.introduced_at`, errors);
    else if (candidate.introduced_at !== null) errors.push(error("INVALID_INTRODUCED_AT", `candidates.${candidateId}.introduced_at`, "このpublication stateではintroduced_atはnullです"));
    collectVariantInvariantErrors(candidate, `candidates.${candidateId}`, errors);
    try {
      canonicalById[candidateId] = canonicalizeCandidate({ candidate_id: candidateId, keyword: candidate.keyword, variants: candidate.variants, category_id: candidate.category_id }, taxonomy);
    } catch (caught) {
      if (caught instanceof WorkflowValidationError) errors.push(...caught.errors.map((item) => ({ ...item, path: `candidates.${candidateId}.${item.path}` })));
      else errors.push(error("INVALID_CANDIDATE", `candidates.${candidateId}`, caught.message));
    }
  }
  const conflicts = conflictSet({ candidates: Object.fromEntries(Object.entries(registry.candidates).map(([id, candidate]) => [id, { ...candidate, ...(canonicalById[id] ?? {}) }])) });
  const baseline = new Set(options.knownConflictKeys ?? []);
  for (const conflict of conflicts) {
    if (!baseline.has(conflict)) errors.push(error("CROSS_CANDIDATE_VARIANT_CONFLICT", "registry.candidates", "新しいnormalized variant conflictです", { conflict }));
  }
  fail(errors);
  return { canonicalById, conflicts };
}

export function evaluateCandidates({ registry, dataset, policy, policyContentSha256 = contentSha256(policy), taxonomy, artifactSha256, knownConflictKeys = [] }) {
  validateRegistry(registry, taxonomy, { knownConflictKeys });
  const validated = validateDataset(dataset, { artifactSha256 });
  const normalizedRecords = validated.records.map((record) => ({ label: record.label, comment: normalizeText(record.comment) }));
  const activeCandidates = Object.entries(registry.candidates)
    .filter(([, candidate]) => candidate.status === "active")
    .sort(([left], [right]) => compareStrings(left, right));
  const candidateResults = activeCandidates.map(([candidateId, candidate]) => {
    const variants = canonicalizeVariants(candidate.keyword, candidate.variants).map(normalizeText);
    const hits = Object.fromEntries(ALLOWED_LABELS.map((label) => [label, 0]));
    for (const record of normalizedRecords) {
      if (variants.some((variant) => record.comment.includes(variant))) hits[record.label] += 1;
    }
    const direct = hits.direct_nuisance;
    const reactive = hits.reactive;
    const normal = hits.normal;
    const precisionDenominator = direct + normal;
    return {
      candidate_id: candidateId,
      direct_nuisance_hits: direct,
      reactive_hits: reactive,
      normal_hits: normal,
      precision_excluding_reactive: precisionDenominator === 0 ? null : roundRatioHalfEven(direct, precisionDenominator),
      direct_recall_contribution: roundRatioHalfEven(direct, validated.direct_nuisance_total),
      normal_hit_rate: roundRatioHalfEven(normal, validated.normal_total),
      utility_score: direct - normal,
      recommendation: recommendationFor(direct, reactive, normal, policy),
      publication_status: direct >= policy.publication.min_direct_nuisance_hits ? "published" : "suppressed_no_direct_hits",
    };
  });
  return {
    schema_version: 1,
    dataset: {
      artifact_sha256: artifactSha256 ?? validated.artifactSha256,
      direct_nuisance_total: validated.direct_nuisance_total,
      reactive_total: validated.reactive_total,
      normal_total: validated.normal_total,
    },
    evaluation_policy: { version: policy.policy_version, content_sha256: policyContentSha256 },
    candidates: candidateResults.sort(evaluationSort),
  };
}

export function buildPublishedCandidates({ registry, evaluation, taxonomy }) {
  const categoryById = taxonomyMap(taxonomy);
  const evaluationById = new Map(evaluation.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  return Object.entries(registry.candidates)
    .filter(([, candidate]) => candidate.status === "active")
    .map(([candidateId, candidate]) => {
      const metrics = evaluationById.get(candidateId);
      if (!metrics || metrics.publication_status !== "published") return null;
      const category = categoryById.get(candidate.category_id);
      return {
        candidate_id: candidateId,
        keyword: candidate.keyword,
        variants: canonicalizeVariants(candidate.keyword, candidate.variants),
        category_id: candidate.category_id,
        category: category.label,
        recommendation: metrics.recommendation,
        match_type: "normalized_substring",
        direct_nuisance_hits: metrics.direct_nuisance_hits,
        reactive_hits: metrics.reactive_hits,
        normal_hits: metrics.normal_hits,
        precision_excluding_reactive: metrics.precision_excluding_reactive,
        direct_recall_contribution: metrics.direct_recall_contribution,
        normal_hit_rate: metrics.normal_hit_rate,
        utility_score: metrics.utility_score,
        introduced_at: candidate.introduced_at,
      };
    })
    .filter(Boolean)
    .sort(publishedSort);
}

export function buildCandidateView(registry) {
  return {
    schema_version: 1,
    candidates: Object.entries(registry.candidates)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([candidateId, candidate]) => ({
        candidate_id: candidateId,
        status: candidate.status,
        keyword: candidate.keyword,
        variants: canonicalizeVariants(candidate.keyword, candidate.variants),
        category_id: candidate.category_id,
      })),
  };
}

export function buildPreEvaluation(evaluation) {
  return {
    schema_version: evaluation.schema_version,
    dataset: evaluation.dataset,
    evaluation_policy: evaluation.evaluation_policy,
    candidates: evaluation.candidates,
  };
}

export function makeBootstrapRegistry({ legacyCandidates, idMap, taxonomy, publishedAt, expectedLegacySourceSha256 }) {
  if (!Array.isArray(legacyCandidates)) throw new WorkflowValidationError([error("INVALID_LEGACY_SOURCE", "legacyCandidates", "legacy candidatesは配列である必要があります")]);
  if (!idMap || !Array.isArray(idMap.entries)) throw new WorkflowValidationError([error("INVALID_BOOTSTRAP_MAP", "idMap.entries", "bootstrap ID mapが必要です")]);
  const categoryByLabel = new Map(taxonomy.categories.map((category) => [category.label, category.category_id]));
  const errors = [];
  assertSha256(idMap.legacy_source_artifact_sha256, "legacy_source_artifact_sha256", errors);
  if (legacyCandidates.length !== idMap.entries.length) errors.push(error("BOOTSTRAP_COUNT_MISMATCH", "entries", "legacy candidateとID mapの件数が一致しません"));
  const seenIndexes = new Set();
  const seenCandidateIds = new Set();
  const candidates = {};
  for (const entry of idMap.entries) {
    if (!Number.isInteger(entry.legacy_index) || seenIndexes.has(entry.legacy_index)) errors.push(error("BOOTSTRAP_INDEX_DUPLICATE", `entries.${entry.legacy_index}`, "legacy indexは一意な整数である必要があります"));
    seenIndexes.add(entry.legacy_index);
    assertCandidateId(entry.candidate_id, `entries.${entry.legacy_index}.candidate_id`, errors);
    if (seenCandidateIds.has(entry.candidate_id)) errors.push(error("BOOTSTRAP_CANDIDATE_ID_DUPLICATE", `entries.${entry.legacy_index}.candidate_id`, "bootstrap candidate_idは一意である必要があります"));
    seenCandidateIds.add(entry.candidate_id);
    const legacy = legacyCandidates[entry.legacy_index];
    if (!legacy) {
      errors.push(error("BOOTSTRAP_INDEX_MISSING", `entries.${entry.legacy_index}`, "legacy indexが存在しません"));
      continue;
    }
    const semanticHash = contentSha256({ keyword: legacy.keyword, variants: legacy.variants, category: legacy.category });
    if (semanticHash !== entry.legacy_candidate_semantic_sha256) errors.push(error("BOOTSTRAP_SEMANTIC_HASH_MISMATCH", `entries.${entry.legacy_index}`, "legacy candidate semantic hashが一致しません"));
    const categoryId = categoryByLabel.get(legacy.category);
    if (!categoryId) {
      errors.push(error("UNKNOWN_LEGACY_CATEGORY", `entries.${entry.legacy_index}`, `legacy category ${legacy.category} をtaxonomyへ変換できません`));
      continue;
    }
    try {
      const canonical = canonicalizeCandidate({ keyword: legacy.keyword, variants: legacy.variants, category_id: categoryId }, taxonomy);
      candidates[entry.candidate_id] = {
        status: "active",
        keyword: canonical.keyword,
        variants: canonical.variants,
        category_id: canonical.category_id,
        created_at: publishedAt,
        last_changed_at: publishedAt,
        first_publication_state: "published_at_unknown",
        introduced_at: null,
      };
    } catch (caught) {
      if (caught instanceof WorkflowValidationError) errors.push(...caught.errors.map((item) => ({ ...item, path: `entries.${entry.legacy_index}.${item.path}` })));
      else errors.push(error("BOOTSTRAP_CANDIDATE_INVALID", `entries.${entry.legacy_index}`, caught.message));
    }
  }
  for (let index = 0; index < legacyCandidates.length; index += 1) if (!seenIndexes.has(index)) errors.push(error("BOOTSTRAP_INDEX_MISSING", `entries.${index}`, "legacy indexが連番で存在しません"));
  if (expectedLegacySourceSha256 && idMap.legacy_source_artifact_sha256 !== expectedLegacySourceSha256) errors.push(error("LEGACY_SOURCE_HASH_MISMATCH", "legacy_source_artifact_sha256", "bootstrap source SHAが期待値と一致しません"));
  fail(errors);
  const registry = { schema_version: 1, candidates };
  // bootstrapはlegacy由来の既存conflictをgrandfatherする。以後の更新で増加させない境界は
  // publication側がこのsnapshotのconflictSetをbaseとして渡すことで固定する。
  validateRegistry(registry, taxonomy, { knownConflictKeys: [...conflictSet(registry)] });
  return registry;
}

function actionShape(action, index, errors, type) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    errors.push(error("INVALID_ACTION", `actions[${index}]`, `${type} actionはobjectである必要があります`));
    return;
  }
  const allowed = type === "add" ? ["action", "keyword", "variants", "category_id"] : type === "retire" ? ["action", "candidate_id"] : ["action", "candidate_id", "keyword", "variants", "category_id"];
  const actual = Object.keys(action).sort();
  if (actual.join("\u001f") !== [...allowed].sort().join("\u001f")) errors.push(error("PROPOSAL_ADDITIONAL_PROPERTY", `actions[${index}]`, `${type} actionのフィールドが契約と一致しません`));
  if (action.action !== type) errors.push(error("INVALID_ACTION_TYPE", `actions[${index}].action`, `actionは${type}である必要があります`));
}

export function validateProposal(proposal, { request, registry, taxonomy }) {
  const errors = [];
  if (!proposal || proposal.schema_version !== 1 || !Array.isArray(proposal.actions)) {
    throw new WorkflowValidationError([error("INVALID_PROPOSAL", "proposal", "schema_version=1とactions配列が必要です")]);
  }
  if (Object.keys(proposal).some((key) => !["schema_version", "request_id", "input_fingerprint", "actions"].includes(key))) errors.push(error("PROPOSAL_ADDITIONAL_PROPERTY", "proposal", "proposalの追加フィールドは禁止です"));
  assertRequestId(proposal.request_id, "request_id", errors);
  assertSha256(proposal.input_fingerprint, "input_fingerprint", errors);
  if (request) {
    if (proposal.request_id !== request.request_id) errors.push(error("REQUEST_ID_MISMATCH", "request_id", "proposalのrequest_idがrequestと一致しません"));
    if (proposal.input_fingerprint !== request.input_fingerprint) errors.push(error("INPUT_FINGERPRINT_MISMATCH", "input_fingerprint", "proposalのinput_fingerprintがrequestと一致しません"));
  }
  const categories = taxonomyMap(taxonomy);
  const touched = new Set();
  proposal.actions.forEach((action, index) => {
    const type = action?.action;
    if (!["add", "update", "retire", "reactivate"].includes(type)) {
      errors.push(error("INVALID_ACTION_TYPE", `actions[${index}].action`, "actionはadd/update/retire/reactivateのいずれかです"));
      return;
    }
    actionShape(action, index, errors, type);
    if (type !== "add") {
      assertCandidateId(action.candidate_id, `actions[${index}].candidate_id`, errors);
      if (touched.has(action.candidate_id)) errors.push(error("DUPLICATE_CANDIDATE_ACTION", `actions[${index}].candidate_id`, "同一candidateへの複数actionは禁止です"));
      touched.add(action.candidate_id);
      const current = registry?.candidates?.[action.candidate_id];
      if (!current) errors.push(error("UNKNOWN_CANDIDATE_ID", `actions[${index}].candidate_id`, "registryに存在しないcandidate_idです"));
      else if (type === "update" && current.status !== "active") errors.push(error("INVALID_LIFECYCLE", `actions[${index}]`, "update対象はactive candidateだけです"));
      else if (type === "retire" && current.status !== "active") errors.push(error("INVALID_LIFECYCLE", `actions[${index}]`, "retire対象はactive candidateだけです"));
      else if (type === "reactivate" && current.status !== "retired") errors.push(error("INVALID_LIFECYCLE", `actions[${index}]`, "reactivate対象はretired candidateだけです"));
      if (current && ["update", "reactivate"].includes(type)) {
        try {
          const canonical = canonicalizeCandidate({ keyword: action.keyword, variants: action.variants, category_id: action.category_id }, taxonomy);
          if (type === "update" && current.keyword === canonical.keyword && JSON.stringify(current.variants) === JSON.stringify(canonical.variants) && current.category_id === canonical.category_id) errors.push(error("NOOP_UPDATE", `actions[${index}]`, "updateはsemantic no-opにできません"));
        } catch (caught) {
          if (caught instanceof WorkflowValidationError) errors.push(...caught.errors.map((item) => ({ ...item, path: `actions[${index}].${item.path}` })));
        }
      }
    } else {
      if (action.candidate_id !== undefined) errors.push(error("ADD_CANDIDATE_ID_FORBIDDEN", `actions[${index}].candidate_id`, "add proposalでcandidate_idは返せません"));
    }
    if (["add", "update", "reactivate"].includes(type)) {
      if (!categories.has(action.category_id)) errors.push(error("UNKNOWN_CATEGORY_ID", `actions[${index}].category_id`, "taxonomyに存在しないcategory_idです"));
      collectVariantInvariantErrors(action, `actions[${index}]`, errors);
      try {
        canonicalizeCandidate({ keyword: action.keyword, variants: action.variants, category_id: action.category_id }, taxonomy);
      } catch (caught) {
        if (caught instanceof WorkflowValidationError) errors.push(...caught.errors.map((item) => ({ ...item, path: `actions[${index}].${item.path}` })));
      }
    }
  });
  fail(errors);
  return true;
}

export function makeGenerationRequest({ requestId, baseRunId, baseRegistryContentSha256, sourceDatasetArtifactSha256, sourceDatasetArtifactRef, candidateView, preEvaluation, evaluationPolicy, taxonomy, outputSchemaVersion = 1 }) {
  const candidateViewContentSha256 = contentSha256(candidateView);
  const preEvaluationContentSha256 = contentSha256(preEvaluation);
  const inputObject = {
    prompt_contract_version: 1,
    output_schema_version: outputSchemaVersion,
    base_run_id: baseRunId,
    base_registry_content_sha256: baseRegistryContentSha256,
    source_dataset_artifact_sha256: sourceDatasetArtifactSha256,
    candidate_view_content_sha256: candidateViewContentSha256,
    pre_evaluation_content_sha256: preEvaluationContentSha256,
    evaluation_policy_version: evaluationPolicy.version,
    evaluation_policy_content_sha256: evaluationPolicy.content_sha256,
    taxonomy_version: taxonomy.version,
    taxonomy_content_sha256: taxonomy.content_sha256,
  };
  return {
    schema_version: 1,
    request_id: requestId,
    prompt_contract_version: 1,
    base_publication: { run_id: baseRunId, registry_content_sha256: baseRegistryContentSha256 },
    source_dataset: { artifact_ref: sourceDatasetArtifactRef, artifact_sha256: sourceDatasetArtifactSha256 },
    candidate_view: { artifact_ref: "candidate_view.json", content_sha256: candidateViewContentSha256 },
    pre_evaluation: { artifact_ref: "pre_evaluation.json", content_sha256: preEvaluationContentSha256 },
    evaluation_policy: evaluationPolicy,
    taxonomy,
    output_schema_version: outputSchemaVersion,
    input_fingerprint: contentSha256(inputObject),
  };
}

export function canonicalizeProposal(proposal, context, options = {}) {
  validateProposal(proposal, context);
  const makeId = options.candidateIdFactory ?? (() => `kw_${crypto.randomUUID()}`);
  const actions = proposal.actions.map((action, index) => {
    const base = {
      action_id: `act_${String(index + 1).padStart(4, "0")}`,
      action: action.action,
      candidate_id: action.action === "add" ? makeId(action, index) : action.candidate_id,
    };
    if (["add", "update", "reactivate"].includes(action.action)) {
      const canonical = canonicalizeCandidate({ keyword: action.keyword, variants: action.variants, category_id: action.category_id }, context.taxonomy);
      return { ...base, ...canonical };
    }
    return base;
  });
  return {
    schema_version: 1,
    request_id: proposal.request_id,
    input_fingerprint: proposal.input_fingerprint,
    base_run_id: context.request.base_publication.run_id,
    base_registry_content_sha256: context.request.base_publication.registry_content_sha256,
    source_dataset_artifact_sha256: context.request.source_dataset.artifact_sha256,
    evaluation_policy_content_sha256: context.request.evaluation_policy.content_sha256,
    taxonomy_content_sha256: context.request.taxonomy.content_sha256,
    actions,
  };
}

export function applyChangeSet(registry, changeSet, { publishedAt, taxonomy, knownConflictKeys = [] }) {
  const next = structuredClone(registry);
  const errors = [];
  const touched = new Set();
  for (const action of changeSet.actions) {
    if (touched.has(action.candidate_id)) {
      errors.push(error("DUPLICATE_CANDIDATE_ACTION", `actions.${action.action_id}`, "同一candidateへの複数actionは禁止です"));
      continue;
    }
    touched.add(action.candidate_id);
    const current = next.candidates[action.candidate_id];
    if (action.action === "add") {
      if (current) errors.push(error("CANDIDATE_ALREADY_EXISTS", `actions.${action.action_id}`, "add対象candidate_idが既に存在します"));
      else {
        const canonical = canonicalizeCandidate(action, taxonomy);
        const { candidate_id: _candidateId, ...semantic } = canonical;
        next.candidates[action.candidate_id] = {
          status: "active",
          ...semantic,
          created_at: publishedAt,
          last_changed_at: publishedAt,
          first_publication_state: "never_published",
          introduced_at: null,
        };
      }
      continue;
    }
    if (!current) {
      errors.push(error("UNKNOWN_CANDIDATE_ID", `actions.${action.action_id}`, "change set対象candidate_idがregistryにありません"));
      continue;
    }
    if (action.action === "retire") {
      if (current.status !== "active") errors.push(error("INVALID_LIFECYCLE", `actions.${action.action_id}`, "retire対象はactiveだけです"));
      else {
        current.status = "retired";
        current.last_changed_at = publishedAt;
      }
    } else if (action.action === "reactivate") {
      if (current.status !== "retired") errors.push(error("INVALID_LIFECYCLE", `actions.${action.action_id}`, "reactivate対象はretiredだけです"));
      else {
        const canonical = canonicalizeCandidate(action, taxonomy);
        const { candidate_id: _candidateId, ...semantic } = canonical;
        Object.assign(current, semantic, { status: "active", last_changed_at: publishedAt });
      }
    } else if (action.action === "update") {
      if (current.status !== "active") errors.push(error("INVALID_LIFECYCLE", `actions.${action.action_id}`, "update対象はactiveだけです"));
      else {
        const canonical = canonicalizeCandidate(action, taxonomy);
        if (current.keyword === canonical.keyword && JSON.stringify(current.variants) === JSON.stringify(canonical.variants) && current.category_id === canonical.category_id) errors.push(error("NOOP_UPDATE", `actions.${action.action_id}`, "updateはsemantic no-opにできません"));
        else {
          const { candidate_id: _candidateId, ...semantic } = canonical;
          Object.assign(current, semantic, { last_changed_at: publishedAt });
        }
      }
    } else errors.push(error("INVALID_ACTION_TYPE", `actions.${action.action_id}`, "未知のactionです"));
  }
  fail(errors);
  validateRegistry(next, taxonomy, { knownConflictKeys });
  return next;
}

export function advanceFirstPublicationHistory(registry, evaluation, publishedAt) {
  const next = structuredClone(registry);
  const metricsById = new Map(evaluation.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  for (const [candidateId, candidate] of Object.entries(next.candidates)) {
    const metrics = metricsById.get(candidateId);
    if (
      candidate.status === "active" &&
      candidate.first_publication_state === "never_published" &&
      metrics?.direct_nuisance_hits >= 1
    ) {
      candidate.first_publication_state = "published_at_known";
      candidate.introduced_at = publishedAt;
    }
  }
  return next;
}

export function isNewCandidate(introducedAt, now = new Date(), displayDays = DEFAULT_NEW_KEYWORD_DISPLAY_DAYS) {
  if (introducedAt === null || introducedAt === undefined) return false;
  const start = Date.parse(introducedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(current) || !Number.isFinite(displayDays) || displayDays < 0) return false;
  return current < start + displayDays * 24 * 60 * 60 * 1000;
}

export function makeArtifactRef(artifactRef, value) {
  return { artifact_ref: artifactRef, content_sha256: contentSha256(value) };
}

export function buildCurrentMeta({ runId, runManifest, publishedAt, publishedCandidates, registry, datasetArtifactSha256, evaluationPolicy, taxonomy }) {
  return {
    schema_version: 1,
    run_id: runId,
    run_manifest_content_sha256: contentSha256(runManifest),
    published_at: publishedAt,
    candidates_content_sha256: contentSha256(publishedCandidates),
    registry_content_sha256: contentSha256(registry),
    dataset_artifact_sha256: datasetArtifactSha256,
    evaluation_policy_version: evaluationPolicy.version,
    evaluation_policy_content_sha256: evaluationPolicy.content_sha256,
    taxonomy_version: taxonomy.version,
    taxonomy_content_sha256: taxonomy.content_sha256,
  };
}

export function makeRunManifest({ runId, runType, baseRunId = null, parentManifestContentSha256 = null, startedAt, completedAt, publishedAt, sourceDataset, evaluationPolicy, taxonomy, registryBefore, registryAfter, artifacts, evaluator = { version: "1.0.0", source_revision: "local" }, publishedCandidates }) {
  return {
    schema_version: 1,
    run_id: runId,
    run_type: runType,
    base_run_id: baseRunId,
    parent_manifest_content_sha256: parentManifestContentSha256,
    started_at: startedAt,
    completed_at: completedAt,
    published_at: publishedAt,
    outcome: "published",
    source_dataset: sourceDataset,
    evaluation_policy: evaluationPolicy,
    taxonomy,
    registry_before_content_sha256: registryBefore ? contentSha256(registryBefore) : null,
    registry_after_content_sha256: contentSha256(registryAfter),
    artifacts,
    evaluator,
    published_candidates_content_sha256: contentSha256(publishedCandidates),
  };
}

export function createRunId(randomUuid = crypto.randomUUID()) {
  return `run_${randomUuid}`;
}

export function createRequestId(randomUuid = crypto.randomUUID()) {
  return `cgr_${randomUuid}`;
}

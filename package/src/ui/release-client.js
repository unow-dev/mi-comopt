export const RELEASE_ROOT = 'optimicom-ui-release.json'
export const ARTIFACT_KEYS = ['comments', 'overview', 'keywords', 'accounts']

const LABELS = ['normal', 'reactive', 'direct_nuisance']
const RECOMMENDATIONS = ['高推奨', '中推奨', '任意']

function invalid(message) {
  throw new Error(`release validation failed: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSha(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validateManifestArtifact(artifact, key) {
  if (!isObject(artifact) || typeof artifact.path !== 'string' || !isSha(artifact.artifact_sha256) || !Number.isSafeInteger(artifact.record_count) || artifact.record_count < 0) invalid(`artifacts.${key}`)
  if (!artifact.path.startsWith('artifacts/') || artifact.path.includes('..') || artifact.path.includes('?') || artifact.path.includes('#')) invalid(`artifacts.${key}.path`)
}

export function validateReleaseManifest(manifest) {
  if (!isObject(manifest) || manifest.schema_version !== 1 || typeof manifest.generated_at !== 'string' || Number.isNaN(Date.parse(manifest.generated_at))) invalid('manifest')
  if (!isObject(manifest.source) || manifest.source.db_schema_version !== 8 || !isSha(manifest.source.source_dataset_artifact_sha256)) invalid('source')
  if (!isObject(manifest.source.snapshot_ref) || !/^[0-9a-f]{64}$/.test(manifest.source.snapshot_ref.payload_sha256) || !Number.isSafeInteger(manifest.source.snapshot_ref.snapshot_index) || manifest.source.snapshot_ref.snapshot_index < 0) invalid('source.snapshot_ref')
  const publication = manifest.source.keyword_publication
  if (!isObject(publication) || typeof publication.run_id !== 'string' || typeof publication.published_at !== 'string' || typeof publication.applied_at !== 'string' || !isSha(publication.candidates_content_sha256)) invalid('source.keyword_publication')
  if (!isObject(manifest.policies) || !isObject(manifest.policies.keyword) || !isObject(manifest.policies.account) || !isSha(manifest.policies.keyword.content_sha256) || !isSha(manifest.policies.account.content_sha256)) invalid('policies')
  if (!isObject(manifest.artifacts)) invalid('artifacts')
  for (const key of ARTIFACT_KEYS) validateManifestArtifact(manifest.artifacts[key], key)
  if (manifest.artifacts.comments.artifact_sha256 !== manifest.source.source_dataset_artifact_sha256) invalid('comments source binding')
  return manifest
}

function validateComments(value) {
  if (!isObject(value) || value.schema_version !== 1 || value.labeling_status !== 'published' || !isObject(value.snapshot_ref) || !Array.isArray(value.records)) invalid('comments artifact')
  value.records.forEach((record, index) => {
    if (!isObject(record) || record.source_index !== index || !['username', 'handle', 'comment', 'postedAt', 'postedDate'].every((key) => typeof record[key] === 'string') || !isDate(record.postedDate) || !LABELS.includes(record.label)) invalid(`comments.records[${index}]`)
  })
  return value
}

function validateOverview(value) {
  if (!isObject(value) || value.schema_version !== 1 || !isDate(value.data_start_date) || !isDate(value.data_end_date) || !Array.isArray(value.daily) || value.daily.length !== 30) invalid('overview artifact')
  for (const row of value.daily) {
    if (!isObject(row) || !isDate(row.date)) invalid('overview.daily')
    if (row.observation_count === null) {
      if (row.counts !== null) invalid('overview gap')
    } else if (!Number.isSafeInteger(row.observation_count) || row.observation_count < 1 || !isObject(row.counts) || LABELS.some((label) => !Number.isSafeInteger(row.counts[label]) || row.counts[label] < 0)) invalid('overview daily counts')
  }
  for (const key of ['1d', '7d', '30d']) {
    const period = value.periods?.[key]
    if (!isObject(period) || !['complete', 'partial'].includes(period.coverage) || !Number.isSafeInteger(period.observation_count) || !isObject(period.counts)) invalid(`overview.periods.${key}`)
  }
  return value
}

function validateKeywords(value) {
  if (!Array.isArray(value)) invalid('keywords artifact')
  value.forEach((candidate, index) => {
    if (!isObject(candidate) || typeof candidate.candidate_id !== 'string' || typeof candidate.keyword !== 'string' || !Array.isArray(candidate.variants) || candidate.variants.some((variant) => typeof variant !== 'string') || typeof candidate.category !== 'string' || !RECOMMENDATIONS.includes(candidate.recommendation) || candidate.match_type !== 'normalized_substring') invalid(`keywords[${index}]`)
  })
  return value
}

function validateAccounts(value) {
  if (!Array.isArray(value)) invalid('accounts artifact')
  value.forEach((candidate, index) => {
    if (!isObject(candidate) || typeof candidate.handle !== 'string' || !Number.isSafeInteger(candidate.direct_nuisance_count) || candidate.direct_nuisance_count < 2 || !Array.isArray(candidate.evidence_sample)) invalid(`accounts[${index}]`)
  })
  return value
}

export function validateArtifactShape(key, value, expectedCount) {
  const validated = key === 'comments' ? validateComments(value) : key === 'overview' ? validateOverview(value) : key === 'keywords' ? validateKeywords(value) : validateAccounts(value)
  const actualCount = key === 'comments' ? validated.records.length : key === 'overview' ? validated.daily.length : validated.length
  if (actualCount !== expectedCount) invalid(`${key} record_count`)
  return validated
}

async function responseBytes(response, url) {
  if (!response || response.ok === false) invalid(`${url} could not be fetched`)
  if (typeof response.arrayBuffer === 'function') return new Uint8Array(await response.arrayBuffer())
  if (typeof response.text === 'function') return new TextEncoder().encode(await response.text())
  invalid(`${url} has no response body reader`)
}

function parseJson(bytes, url) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    invalid(`${url}: ${error.message}`)
  }
}

export async function loadReleaseSession({ fetchImpl = globalThis.fetch, rootUrl = RELEASE_ROOT } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('release root cannot be loaded because fetch is unavailable')
  const rootResponse = await fetchImpl(rootUrl, { cache: 'no-store' })
  const rootBytes = await responseBytes(rootResponse, rootUrl)
  const release = validateReleaseManifest(parseJson(rootBytes, rootUrl))
  const cache = new Map()
  const loading = new Map()
  const loadArtifact = (key) => {
    if (!ARTIFACT_KEYS.includes(key)) return Promise.reject(new Error(`unknown artifact: ${key}`))
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (loading.has(key)) return loading.get(key)
    let rootLocation = globalThis.location?.href ?? 'http://optimicom.local/'
    if (!/^https?:/i.test(rootLocation)) rootLocation = 'http://optimicom.local/'
    const artifactUrl = new URL(release.artifacts[key].path, new URL(rootUrl, rootLocation)).href
    const request = fetchImpl(artifactUrl, { cache: 'no-store' })
      .then((response) => responseBytes(response, artifactUrl))
      .then((bytes) => parseJson(bytes, artifactUrl))
      .then((value) => validateArtifactShape(key, value, release.artifacts[key].record_count))
      .then((value) => {
        cache.set(key, value)
        loading.delete(key)
        return value
      })
      .catch((error) => {
        loading.delete(key)
        throw error
      })
    loading.set(key, request)
    return request
  }
  return { release, loadArtifact, cache }
}

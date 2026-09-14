export const ACTION_STATE_KEY = 'optimicom.actionState.v1'

export function emptyActionState() {
  return { schema_version: 1, keywords: {}, accounts: {} }
}

function isTimestamp(value) {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
}

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== 1 || !value.keywords || typeof value.keywords !== 'object' || !value.accounts || typeof value.accounts !== 'object') return false
  for (const item of Object.values(value.keywords)) {
    if (!item || typeof item !== 'object' || typeof item.copied_at !== 'string' || typeof item.keyword_publication_run_id !== 'string') return false
  }
  for (const item of Object.values(value.accounts)) {
    if (!item || typeof item !== 'object' || !isTimestamp(item.copied_at) || !isTimestamp(item.blocked_marked_at) || typeof item.source_dataset_artifact_sha256 !== 'string') return false
  }
  return true
}

export function readActionState(storage) {
  const fallback = emptyActionState()
  if (!storage) return { state: fallback, enabled: false, warning: 'ブラウザのローカル状態を利用できません。' }
  let raw
  try {
    raw = storage.getItem(ACTION_STATE_KEY)
  } catch (error) {
    return { state: fallback, enabled: false, warning: `ローカル状態を読み取れませんでした: ${error.message}` }
  }
  if (raw === null) return { state: fallback, enabled: true, warning: null }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: fallback, enabled: true, warning: '保存されたローカル状態を読み込めなかったため、空の状態で開始しました。' }
  }
  if (parsed?.schema_version !== 1) return { state: fallback, enabled: false, warning: '未知のローカル状態は変更せず、永続化を無効にしました。' }
  if (!validateState(parsed)) return { state: fallback, enabled: true, warning: '保存されたローカル状態が不正なため、空の状態で開始しました。' }
  return { state: parsed, enabled: true, warning: null }
}

export function saveActionState(storage, state) {
  if (!storage || !validateState(state)) return false
  try {
    const existing = storage.getItem(ACTION_STATE_KEY)
    if (existing !== null) {
      let parsed
      try { parsed = JSON.parse(existing) } catch { parsed = null }
      if (parsed?.schema_version !== undefined && parsed.schema_version !== 1) return false
    }
    storage.setItem(ACTION_STATE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function markKeywordCopied(state, candidateId, copiedAt, publicationRunId) {
  return { ...state, keywords: { ...state.keywords, [candidateId]: { copied_at: new Date(copiedAt).toISOString(), keyword_publication_run_id: publicationRunId } } }
}

export function markAccountCopied(state, handle, copiedAt, sourceDatasetArtifactSha256) {
  const current = state.accounts[handle] ?? { copied_at: null, blocked_marked_at: null, source_dataset_artifact_sha256: sourceDatasetArtifactSha256 }
  return { ...state, accounts: { ...state.accounts, [handle]: { ...current, copied_at: new Date(copiedAt).toISOString(), source_dataset_artifact_sha256: sourceDatasetArtifactSha256 } } }
}

export function toggleAccountBlocked(state, handle, blockedAt, sourceDatasetArtifactSha256) {
  const current = state.accounts[handle] ?? { copied_at: null, blocked_marked_at: null, source_dataset_artifact_sha256: sourceDatasetArtifactSha256 }
  return { ...state, accounts: { ...state.accounts, [handle]: { ...current, blocked_marked_at: current.blocked_marked_at === null ? new Date(blockedAt).toISOString() : null, source_dataset_artifact_sha256: sourceDatasetArtifactSha256 } } }
}

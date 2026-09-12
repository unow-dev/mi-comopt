import { describe, expect, it } from 'vitest'
import {
  emptyActionState,
  markAccountCopied,
  markKeywordCopied,
  readActionState,
  saveActionState,
  toggleAccountBlocked,
} from './local-state.js'

function storageWith(value) {
  return {
    value,
    getItem() { return this.value },
    setItem(_key, next) { this.value = next },
  }
}

describe('local action state', () => {
  it('uses empty state for malformed JSON without blocking future persistence', () => {
    const storage = storageWith('{')
    const loaded = readActionState(storage)
    expect(loaded.enabled).toBe(true)
    expect(loaded.state).toEqual(emptyActionState())
    expect(loaded.warning).toBeTruthy()
  })

  it('does not overwrite unknown schema data', () => {
    const storage = storageWith(JSON.stringify({ schema_version: 99, keep: true }))
    const loaded = readActionState(storage)
    expect(loaded.enabled).toBe(false)
    expect(saveActionState(storage, loaded.state)).toBe(false)
    expect(JSON.parse(storage.value).schema_version).toBe(99)
  })

  it('keeps copy and blocked mark independent', () => {
    const storage = storageWith(null)
    let state = readActionState(storage).state
    state = markAccountCopied(state, '@account', '2026-09-13T00:00:00Z', 'sha256:' + 'a'.repeat(64))
    state = toggleAccountBlocked(state, '@account', '2026-09-13T00:01:00Z', 'sha256:' + 'a'.repeat(64))
    state = toggleAccountBlocked(state, '@account', '2026-09-13T00:02:00Z', 'sha256:' + 'a'.repeat(64))
    state = markKeywordCopied(state, 'kw_1', '2026-09-13T00:03:00Z', 'run_1')
    expect(state.accounts['@account'].copied_at).toBe('2026-09-13T00:00:00.000Z')
    expect(state.accounts['@account'].blocked_marked_at).toBeNull()
    expect(state.keywords.kw_1.copied_at).toBe('2026-09-13T00:03:00.000Z')
  })
})

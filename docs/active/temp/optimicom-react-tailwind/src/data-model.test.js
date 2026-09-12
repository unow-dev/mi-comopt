import { describe, expect, it } from 'vitest'
import { filterComments, isNewCandidate, paginate } from './data-model.js'

describe('data-model', () => {
  it('filters all searchable fields before paginating in deterministic order', () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      source_index: index,
      username: index === 50 ? 'target user' : 'user',
      handle: index === 50 ? '@target' : '@user',
      comment: index === 50 ? 'needle' : 'ordinary',
      postedDate: index === 50 ? '2026-09-01' : '2026-09-02',
      label: index % 2 ? 'reactive' : 'normal',
    }))
    expect(filterComments(records, { query: 'target' })).toHaveLength(1)
    expect(filterComments(records, { label: 'reactive' })[0].source_index).toBe(1)
    expect(paginate(filterComments(records), 2).records).toHaveLength(1)
  })

  it('keeps NEW boundaries strict and treats future values as not new', () => {
    const now = new Date('2026-09-13T00:00:00Z')
    expect(isNewCandidate('2026-08-30T00:00:01Z', now)).toBe(true)
    expect(isNewCandidate('2026-08-30T00:00:00Z', now)).toBe(false)
    expect(isNewCandidate('2026-09-14T00:00:00Z', now)).toBe(false)
    expect(isNewCandidate(null, now)).toBe(false)
  })
})

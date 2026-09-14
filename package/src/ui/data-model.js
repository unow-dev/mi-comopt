export const LABELS = [
  { key: 'normal', label: '通常', tone: 'green' },
  { key: 'reactive', label: '二次反応', tone: 'yellow' },
  { key: 'direct_nuisance', label: '一次迷惑', tone: 'pink' },
]

export const LABEL_KEYS = LABELS.map(({ key }) => key)
export const RECOMMENDATIONS = ['高推奨', '中推奨', '任意']

export function labelName(value) {
  return LABELS.find(({ key }) => key === value)?.label ?? value
}

export function isNewCandidate(introducedAt, now) {
  if (introducedAt === null || introducedAt === undefined) return false
  const introduced = Date.parse(introducedAt)
  const current = now instanceof Date ? now.getTime() : Date.parse(now)
  const age = current - introduced
  return Number.isFinite(age) && age >= 0 && age < 14 * 24 * 60 * 60 * 1000
}

export function sortComments(records) {
  return [...records].sort((left, right) => right.postedDate.localeCompare(left.postedDate) || left.source_index - right.source_index)
}

export function filterComments(records, { label = 'all', query = '' } = {}) {
  const normalized = query.trim().toLocaleLowerCase()
  return sortComments(records).filter((record) => {
    const matchesLabel = label === 'all' || record.label === label
    const searchable = `${record.comment} ${record.username} ${record.handle}`.toLocaleLowerCase()
    return matchesLabel && (!normalized || searchable.includes(normalized))
  })
}

export function paginate(records, page, pageSize = 50) {
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  return { page: safePage, totalPages, records: records.slice((safePage - 1) * pageSize, safePage * pageSize) }
}


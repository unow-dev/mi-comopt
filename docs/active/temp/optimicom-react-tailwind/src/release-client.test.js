import { describe, expect, it, vi } from 'vitest'
import { loadReleaseSession } from './release-client.js'

const sha = 'sha256:' + 'a'.repeat(64)
const release = {
  schema_version: 1,
  generated_at: '2026-09-13T00:00:00Z',
  source: { db_schema_version: 8, snapshot_ref: { payload_sha256: 'b'.repeat(64), snapshot_index: 0 }, source_dataset_artifact_sha256: sha, keyword_publication: { run_id: 'run_123', published_at: '2026-09-13T00:00:00Z', applied_at: '2026-09-13T00:00:00Z', candidates_content_sha256: sha } },
  policies: { keyword: { version: '1.0.0', content_sha256: sha }, account: { version: '1.0.0', content_sha256: sha } },
  artifacts: Object.fromEntries(['comments', 'overview', 'keywords', 'accounts'].map((key) => [key, { path: `artifacts/${key}.json`, artifact_sha256: sha, record_count: key === 'overview' ? 30 : 0 }])),
}

describe('release client', () => {
  it('pins the root and caches successful screen loads', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(release), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    const client = await loadReleaseSession({ fetchImpl, rootUrl: 'https://example.test/optimicom-ui-release.json' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await client.loadArtifact('keywords')
    await client.loadArtifact('keywords')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed artifact request so retry can recover', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(release), { status: 200 }))
      .mockResolvedValueOnce(new Response('broken', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    const client = await loadReleaseSession({ fetchImpl, rootUrl: 'https://example.test/optimicom-ui-release.json' })
    await expect(client.loadArtifact('keywords')).rejects.toThrow()
    await expect(client.loadArtifact('keywords')).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})


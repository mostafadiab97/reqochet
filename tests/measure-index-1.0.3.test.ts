// 1.0.3 measurement (CTO, 23 Nov 2026): the SQLite page cache (`cache_size` 128 MB, `mmap_size` 256 MB) against
// SQLite's defaults, on the same 50,000-item index — the queries the window asks most, each timed as the median of
// several runs, plus the process memory (RSS) after the queries.
// By hand only: MEASURE_INDEX=1 npx vitest run tests/measure-index-1.0.3.test.ts (MEASURE_INDEX_COUNT=10000 for a smaller run).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSqliteIndexCache } from '../src/modules/index-cache'
import type { ItemQuery } from '../src/modules/index-cache'
import { createFileRepositoryStore } from '../src/modules/repository-store'
import { generateItems } from '../src/modules/sample-data'

const RUN = process.env['MEASURE_INDEX'] === '1' || process.env['MEASURE'] === '1'
const COUNT = Number(process.env['MEASURE_INDEX_COUNT'] ?? 50_000)
const ROUNDS = 7
const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const mb = (n: number): number => Math.round(n / 1e6)

describe.skipIf(!RUN)('SQLite page cache at 50,000 items (1.0.3 measurement)', () => {
  it('times the common queries with and without the page cache', { timeout: 1_800_000 }, async () => {
    const base = await mkdtemp(join(tmpdir(), 'rq-idx-'))
    try {
      const store = createFileRepositoryStore(schemaFile)
      const repo = await store.initialize(join(base, 'repo'))
      for (const item of generateItems(repo.schema, { count: COUNT })) await repo.writeItem(item)
      const types = repo.schema.itemTypes.map((t) => t.id)
      const rules = repo.schema.rules ?? []
      const queries: [string, ItemQuery][] = [
        ['first page by order', { sort: { by: 'order' }, limit: 100, brief: true }],
        ['deep page by order', { sort: { by: 'order' }, limit: 100, offset: Math.floor(COUNT * 0.8), brief: true }],
        ['sort by title', { sort: { by: 'title' }, limit: 100, brief: true }],
        ['text search', { text: 'system', sort: { by: 'relevance' }, limit: 100, brief: true }],
        ['type filter', { types: types.slice(0, 1), limit: 100, brief: true }],
        ['suspect links', { links: 'suspect', limit: 100, brief: true }],
        ['gap count', { gaps: true, rules, limit: 0 }],
        ['count all', { limit: 0 }]
      ]

      const results: Record<string, Record<string, number>> = {}
      // MEASURE_VARIANT=default|cache runs one setting only (a clean process for the memory figure)
      const only = process.env['MEASURE_VARIANT']
      const passes = only ? [only === 'cache', only === 'cache'] : [false, true, false, true]
      for (const pageCache of passes) {
        const label = pageCache ? 'cache' : 'default'
        const cache = createSqliteIndexCache(join(base, `idx-${label}.sqlite`), { pageCache })
        const t0 = performance.now()
        await cache.sync(repo)
        const row: Record<string, number> = { sync: Math.round(performance.now() - t0) }
        for (const [name, q] of queries) {
          const times: number[] = []
          for (let r = 0; r < ROUNDS; r++) {
            const t = performance.now()
            const res = cache.query(q)
            times.push(performance.now() - t)
            expect(res.total).toBeGreaterThanOrEqual(0)
          }
          row[name] = Math.round(median(times) * 10) / 10
        }
        row['rss MB'] = mb(process.memoryUsage().rss)
        cache.close()
        const prev = results[label]
        // the second pass of each setting counts (the first warms the disk cache for both alike)
        results[label] = row
        void prev
      }
      const lines = Object.keys(results['default'] ?? results['cache'] ?? {}).map(
        (k) => `${k.padEnd(22)} default ${String(results['default']?.[k]).padStart(8)}   cache ${String(results['cache']?.[k]).padStart(8)}`
      )
      console.log(`[measure-index] ${COUNT} items, median of ${ROUNDS} (ms)\n${lines.join('\n')}`)
      if (process.env['GITHUB_ACTIONS']) console.log(`::notice title=measure-index::${lines.join(' | ')}`)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

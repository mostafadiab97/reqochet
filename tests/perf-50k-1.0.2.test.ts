// 1.0.2 speed at 50,000 items (open items PW-03, PW-08, PW21-01): the actions measured through the workspace service.
// By hand only: PERF_50K=1 npx vitest run tests/perf-50k-1.0.2.test.ts (PERF_COUNT=10000 for a smaller run).
// The limits are the reviewer's targets with room for a slower PC; the printed line is the evidence.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSystemGitAdapter } from '../src/modules/git-adapter'
import { createSqliteIndexCache } from '../src/modules/index-cache'
import { createFileRepositoryStore } from '../src/modules/repository-store'
import { generateItems } from '../src/modules/sample-data'
import { cacheFileName, createWorkspace } from '../src/modules/workspace'

const RUN = process.env['PERF_50K'] === '1'
const COUNT = Number(process.env['PERF_COUNT'] ?? 50_000)
const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }

const time = async <T>(f: () => Promise<T> | T): Promise<[T, number]> => {
  const t = performance.now()
  const r = await f()
  return [r, Math.round(performance.now() - t)]
}

/** Runs `f` and samples the process memory every 20 ms: the highest heap + external (the export's string) in MB. */
async function peakMemory<T>(f: () => Promise<T>): Promise<[T, number, number]> {
  global.gc?.()
  const base = process.memoryUsage()
  let peak = 0
  const sample = (): void => {
    const m = process.memoryUsage()
    peak = Math.max(peak, m.heapUsed + m.external + m.arrayBuffers - base.heapUsed - base.external - base.arrayBuffers)
  }
  const timer = setInterval(sample, 20)
  const t = performance.now()
  try {
    const r = await f()
    sample()
    return [r, Math.round(performance.now() - t), Math.round(peak / 1e6)]
  } finally {
    clearInterval(timer)
  }
}

describe.skipIf(!RUN)(`speed at ${COUNT.toLocaleString('en')} items (1.0.2)`, () => {
  it('sort by number, coverage gap count, exports', { timeout: 1_800_000 }, async () => {
    const base = await mkdtemp(join(tmpdir(), 'rq-perf50k-'))
    try {
      const root = join(base, 'repo')
      const store = createFileRepositoryStore(schemaFile)
      const repo = await store.initialize(root)
      for (const item of generateItems(repo.schema, { count: COUNT })) await repo.writeItem(item)
      const sh = (...a: string[]): string => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
      sh('init', '-q', '-b', 'main')
      sh('-c', 'user.name=Perf', '-c', 'user.email=perf@example.invalid', 'add', '-A')
      sh('-c', 'user.name=Perf', '-c', 'user.email=perf@example.invalid', 'commit', '-q', '-m', 'all')
      const userDir = join(base, 'user')
      const ws = createWorkspace({
        store,
        git: createSystemGitAdapter(),
        openIndex: (r: string) => createSqliteIndexCache(join(userDir, 'cache', cacheFileName(r))),
        userDir,
        log: quiet,
        watchFiles: false
      } as Parameters<typeof createWorkspace>[0])
      const [, openMs] = await time(() => ws.open(root))

      // PW21-01: the first page sorted by outline number (first call after a change, then again)
      const [sorted, sortFirstMs] = await time(() => ws.query({ sort: { by: 'number' }, limit: 100 }))
      const [, sortAgainMs] = await time(() => ws.query({ sort: { by: 'number' }, limit: 100, offset: 100 }))
      const [desc, sortDescMs] = await time(() => ws.query({ sort: { by: 'number', descending: true }, limit: 100 }))
      expect(sorted.total).toBe(COUNT)
      expect(sorted.items[0]?.number).toBe('1')
      expect(desc.items[0]?.number).not.toBe('1')

      // PW-03: the status bar's gap count, as the window asks it after every change
      const [gaps, gapFirstMs] = await time(() => ws.query({ gaps: true, limit: 0 }))
      const [, gapAgainMs] = await time(() => ws.query({ gaps: true, limit: 0 }))
      const one = ws.query({ limit: 1, offset: 777 }).items[0]
      const got = one ? await ws.getItem(one.id) : null
      if (!got) throw new Error('no item')
      const saved = await ws.saveItem({ ...got.item, title: `${got.item.title} (changed)` }, got.revision)
      expect(saved.ok).toBe(true)
      const [gapsAfter, gapAfterSaveMs] = await time(() => ws.query({ gaps: true, limit: 0 }))
      expect(gapsAfter.total).toBe(gaps.total)

      // PW-08: exporting every item (the string is held until the window writes the file)
      const columns = ['id', 'title', 'type', 'parent', 'text', 'links']
      const [reqif, reqifMs, reqifMb] = await peakMemory(() => ws.exportItems({ scope: 'all', columns, format: 'reqif' }))
      const [xlsx, xlsxMs, xlsxMb] = await peakMemory(() => ws.exportItems({ scope: 'all', columns, format: 'xlsx' }))
      expect(reqif.count).toBe(COUNT)
      expect(xlsx.count).toBe(COUNT)
      const size = (c: string | Uint8Array): number => Math.round((typeof c === 'string' ? Buffer.byteLength(c) : c.byteLength) / 1e6)

      console.log(
        `[perf-50k] ${COUNT} items — open ${openMs} ms; sort by number ${sortFirstMs} ms first, ${sortAgainMs} ms next page, ` +
          `${sortDescMs} ms descending; gap count (${gaps.total} gaps) ${gapFirstMs} ms first, ${gapAgainMs} ms again, ` +
          `${gapAfterSaveMs} ms after a save; ReqIF ${reqifMs} ms, ${size(reqif.content)} MB, peak +${reqifMb} MB; ` +
          `Excel ${xlsxMs} ms, ${size(xlsx.content)} MB, peak +${xlsxMb} MB`
      )
      await ws.close?.()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

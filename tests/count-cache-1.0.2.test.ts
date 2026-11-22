// 1.0.2 (PW-03): count-only queries (limit 0, e.g. the status bar's gap count) are kept per index state. The same
// question on an unchanged index is answered from memory; any change to the index gives a fresh count.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createSystemGitAdapter } from '../src/modules/git-adapter'
import { createSqliteIndexCache } from '../src/modules/index-cache'
import { createFileRepositoryStore } from '../src/modules/repository-store'
import { generateItems } from '../src/modules/sample-data'
import { cacheFileName, createWorkspace } from '../src/modules/workspace'

const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
const bases: string[] = []
afterAll(async () => {
  for (const b of bases) await rm(b, { recursive: true, force: true })
})

describe('count-only queries (1.0.2)', () => {
  it('are fresh after every change and the same as a full query', async () => {
    const base = await mkdtemp(join(tmpdir(), 'rq-count-'))
    bases.push(base)
    const root = join(base, 'repo')
    const store = createFileRepositoryStore(schemaFile)
    const repo = await store.initialize(root)
    for (const item of generateItems(repo.schema, { count: 200 })) await repo.writeItem(item)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
    const userDir = join(base, 'user')
    const ws = createWorkspace({
      store,
      git: createSystemGitAdapter(),
      openIndex: (r: string) => createSqliteIndexCache(join(userDir, 'cache', cacheFileName(r))),
      userDir,
      log: quiet,
      watchFiles: false
    } as Parameters<typeof createWorkspace>[0])
    await ws.open(root)

    // the cached gap count equals the count of a normal query
    const gaps = ws.query({ gaps: true, limit: 0 })
    expect(gaps.items).toEqual([])
    expect(gaps.total).toBe(ws.query({ gaps: true, limit: 10 }).total)
    expect(ws.query({ gaps: true, limit: 0 }).total).toBe(gaps.total)

    // different questions do not share an answer
    expect(ws.query({ text: 'zebracornword', limit: 0 }).total).toBe(0)
    const one = ws.query({ limit: 1, offset: 5 }).items[0]
    const got = one ? await ws.getItem(one.id) : null
    if (!got) throw new Error('no item')
    expect((await ws.saveItem({ ...got.item, title: 'zebracornword here' }, got.revision)).ok).toBe(true)
    // after the save the same question gets a new answer
    expect(ws.query({ text: 'zebracornword', limit: 0 }).total).toBe(1)
    expect(ws.query({ text: 'zebracornword', limit: 0, offset: 30, sort: { by: 'title' } }).total).toBe(1)
    await ws.close?.()
  }, 60_000)
})

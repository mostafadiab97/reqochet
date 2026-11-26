// 1.0.2 (release run): flushing every file to the disk made bulk writes ~7x slower on Windows (10,000 items 9 s → 76 s).
// The editor's save — what the user just typed — is flushed; bulk writes (import, change many…) are not.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => [] as { file: string; flush: boolean | undefined }[])
vi.mock('../src/modules/safe-files', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/modules/safe-files')>()
  return {
    ...real,
    writeFileAtomic: async (...args: Parameters<typeof real.writeFileAtomic>) => {
      seen.push({ file: String(args[0]).split('\\').join('/'), flush: args[2]?.flush })
      return real.writeFileAtomic(...args)
    }
  }
})

const { createSystemGitAdapter } = await import('../src/modules/git-adapter')
const { createSqliteIndexCache } = await import('../src/modules/index-cache')
const { createFileRepositoryStore } = await import('../src/modules/repository-store')
const { generateItems } = await import('../src/modules/sample-data')
const { cacheFileName, createWorkspace } = await import('../src/modules/workspace')

const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
const base = mkdtempSync(join(tmpdir(), 'rq-flush-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('which writes are flushed (1.0.2)', () => {
  it('bulk writes are not flushed; the editor save is', async () => {
    const root = join(base, 'repo')
    const store = createFileRepositoryStore(schemaFile)
    const repo = await store.initialize(root)
    seen.length = 0
    for (const item of generateItems(repo.schema, { count: 5 })) await repo.writeItem(item)
    const items = seen.filter((w) => w.file.endsWith('.md'))
    expect(items).toHaveLength(5)
    expect(items.every((w) => w.flush === false)).toBe(true)

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
    try {
      const one = ws.query({ limit: 1 }).items[0]!
      const got = await ws.getItem(one.id)
      if (!got) throw new Error('no item')
      seen.length = 0
      expect((await ws.saveItem({ ...got.item, title: 'typed by the user' }, got.revision)).ok).toBe(true)
      expect(seen.filter((w) => w.file.endsWith(`${one.id}.md`)).map((w) => w.flush)).toEqual([true])
    } finally {
      await ws.close?.()
    }
  }, 60_000)
})

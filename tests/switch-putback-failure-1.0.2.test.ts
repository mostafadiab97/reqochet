// 1.0.2 (review CR102-04 / CR102-14): after a refused branch switch with "discard", the files are put back. A file that
// cannot be put back is named in the message (it used to be lost without a word).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const fail = vi.hoisted(() => ({ on: '' }))
vi.mock('../src/modules/safe-files', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/modules/safe-files')>()
  return {
    ...real,
    writeFileAtomic: async (...args: Parameters<typeof real.writeFileAtomic>) => {
      if (fail.on && String(args[0]).split('\\').join('/').endsWith(fail.on)) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
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
const base = mkdtempSync(join(tmpdir(), 'rq-putback-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('a file that cannot be put back after a refused switch (1.0.2, CR102-04)', () => {
  it('is named in the message', async () => {
    const root = join(base, 'repo')
    const store = createFileRepositoryStore(schemaFile)
    const repo = await store.initialize(root)
    for (const item of generateItems(repo.schema, { count: 10 })) await repo.writeItem(item)
    const sh = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: root, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    sh('add', '-A')
    sh('commit', '-q', '-m', 'all')
    // the other branch tracks a file outside requirements/ that is untracked here: Git refuses the switch
    sh('switch', '-q', '-c', 'other')
    writeFileSync(join(root, 'notes.txt'), 'on other\n')
    sh('add', 'notes.txt')
    sh('commit', '-q', '-m', 'notes')
    sh('switch', '-q', 'main')
    writeFileSync(join(root, 'notes.txt'), 'mine\n')
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
      const one = ws.query({ limit: 1, offset: 2 }).items[0]!
      const got = await ws.getItem(one.id)
      if (!got) throw new Error('no item')
      expect((await ws.saveItem({ ...got.item, title: 'edited' }, got.revision)).ok).toBe(true)
      fail.on = `requirements/${one.path}`
      const r = await ws.switchBranch('other', 'discard')
      fail.on = ''
      expect(r.ok).toBe(false)
      expect(r.ok ? '' : r.message).toContain(`requirements/${one.path}`)
    } finally {
      fail.on = ''
      await ws.close?.()
    }
  }, 60_000)
})

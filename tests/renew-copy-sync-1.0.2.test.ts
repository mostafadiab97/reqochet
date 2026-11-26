// 1.0.2 (review A-13): "give the copy a new ID" writes the copy under a new ID and then removes the old copy file. If a
// later step fails (here: the removal, with an error that is not a passing Windows lock), what was already written must
// still reach the table — the sync now runs in a `finally`.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const fail = vi.hoisted(() => ({ on: '' }))
vi.mock('../src/modules/safe-files', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/modules/safe-files')>()
  return {
    ...real,
    removeFile: async (file: string, waits?: readonly number[]) => {
      // compared with forward slashes: Windows paths use backslashes (the first Windows run never failed here)
      if (fail.on && file.split('\\').join('/').endsWith(fail.on)) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      return real.removeFile(file, waits)
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
const base = mkdtempSync(join(tmpdir(), 'rq-renew-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('give the copy a new ID (1.0.2, A-13)', () => {
  it('a failure after the new file was written still shows it in the table', async () => {
    const root = join(base, 'repo')
    const store = createFileRepositoryStore(schemaFile)
    const repo = await store.initialize(root)
    const items = generateItems(repo.schema, { count: 10 })
    for (const item of items) await repo.writeItem(item)
    const sh = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: root, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    sh('add', '-A')
    sh('commit', '-q', '-m', 'all')
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
      // a file copied by hand into another document: the same ID twice, the copy not yet known to Git
      const original = ws.query({ limit: 1, offset: 2 }).items[0]!
      mkdirSync(join(root, 'requirements', 'other'), { recursive: true })
      const copy = `other/${original.id}.md`
      copyFileSync(join(root, 'requirements', original.path), join(root, 'requirements', copy))
      await ws.refresh?.()
      expect(ws.query({ text: original.title, limit: 0 }).total).toBe(2)

      fail.on = copy
      const r = await ws.renewCopyId(original.id)
      expect(r.ok).toBe(false)
      // on disk: the original, the copy (its removal failed) and the copy under its new ID — all three in the table
      expect(ws.query({ text: original.title, limit: 10 }).items.map((i) => i.id).filter((id) => id !== original.id)).toHaveLength(1)
    } finally {
      fail.on = ''
      await ws.close?.()
    }
  }, 60_000)
})

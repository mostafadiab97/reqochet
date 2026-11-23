// 1.0.2 (review CR102-02): before a branch switch with "discard", every changed file is copied so it can be put back if
// the switch fails. A file that cannot be read then (a Windows lock — EBUSY) must stop the switch BEFORE anything is
// thrown away; before the fix it counted as "absent", was discarded, and putting back deleted it.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const lock = vi.hoisted(() => ({ path: '' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const readFile = (async (file: Parameters<typeof real.readFile>[0], ...rest: unknown[]) => {
    if (lock.path && String(file).split('\\').join('/').endsWith(lock.path)) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    return (real.readFile as (...a: unknown[]) => unknown)(file, ...rest)
  }) as typeof real.readFile
  return { ...real, readFile, default: { ...real, readFile } }
})

const { createSystemGitAdapter } = await import('../src/modules/git-adapter')
const { createSqliteIndexCache } = await import('../src/modules/index-cache')
const { createFileRepositoryStore } = await import('../src/modules/repository-store')
const { generateItems } = await import('../src/modules/sample-data')
const { cacheFileName, createWorkspace } = await import('../src/modules/workspace')

const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
const base = mkdtempSync(join(tmpdir(), 'rq-switch-lock-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('switch with "discard" and a locked file (1.0.2, CR102-02)', () => {
  it('stops before discarding; the edit stays', async () => {
    const root = join(base, 'repo')
    const store = createFileRepositoryStore(schemaFile)
    const repo = await store.initialize(root)
    for (const item of generateItems(repo.schema, { count: 10 })) await repo.writeItem(item)
    const sh = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: root, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    sh('add', '-A')
    sh('commit', '-q', '-m', 'all')
    sh('branch', 'other')
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
      expect((await ws.saveItem({ ...got.item, title: 'edit that must survive' }, got.revision)).ok).toBe(true)
      const file = join(root, 'requirements', one.path)
      const edited = readFileSync(file, 'utf8')
      lock.path = `requirements/${one.path}`
      const r = await ws.switchBranch('other', 'discard')
      lock.path = ''
      expect(r.ok).toBe(false)
      expect(readFileSync(file, 'utf8')).toBe(edited)
      expect(sh('branch', '--show-current').trim()).toBe('main')
    } finally {
      lock.path = ''
      await ws.close?.()
    }
  }, 60_000)
})

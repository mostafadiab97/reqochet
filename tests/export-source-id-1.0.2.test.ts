// 1.0.2 (PW-08): the ReqIF export finds an imported item's own identifier (`source-id`) without parsing every file —
// each file is read as text and parsed only when it mentions source-id. The identifier must survive, in the live folder
// and while an old version is shown (its files come from Git, not from the folder).
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

describe('ReqIF export keeps source-id (1.0.2)', () => {
  it('uses the other tool’s identifier for imported items only — live and in an old version', async () => {
    const base = await mkdtemp(join(tmpdir(), 'rq-srcid-'))
    bases.push(base)
    const root = join(base, 'repo')
    const store = createFileRepositoryStore(schemaFile)
    const repo = await store.initialize(root)
    const items = generateItems(repo.schema, { count: 30 })
    const imported = items[7]!
    imported.extra = { ...imported.extra, 'source-id': 'EXT-OBJ-42' }
    for (const item of items) await repo.writeItem(item)
    const sh = (...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: root, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    // the repository's own identity: CI runners have no global one, and the workspace commits too
    sh('config', 'user.name', 't')
    sh('config', 'user.email', 't@example.invalid')
    sh('add', '-A')
    sh('commit', '-q', '-m', 'all')
    const first = sh('rev-parse', 'HEAD').trim()
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
    try {      const exportXml = async (): Promise<string> => String((await ws.exportItems({ scope: 'all', columns: ['id', 'title'], format: 'reqif' })).content)

      const live = await exportXml()
      expect(live).toContain('IDENTIFIER="EXT-OBJ-42"')
      expect(live).toContain(`IDENTIFIER="${items[3]!.id}"`) // the others keep their reqochet ID
      expect(live).not.toContain(`IDENTIFIER="${imported.id}"`)

      // a later commit drops the source-id from the file; the old version still has it
      const got = await ws.getItem(imported.id)
      if (!got) throw new Error('no item')
      const rest = { ...got.item.extra }
      delete rest['source-id']
      expect((await ws.saveItem({ ...got.item, extra: rest }, got.revision)).ok).toBe(true)
      expect((await ws.commit('drop source id')).ok).toBe(true)
      expect(await exportXml()).not.toContain('EXT-OBJ-42')
      expect((await ws.openVersion(first)).ok).toBe(true)
      expect(await exportXml()).toContain('IDENTIFIER="EXT-OBJ-42"')
      await ws.closeVersion()
    } finally {
      await ws.close?.() // closed in any case: an open index file cannot be removed on Windows (EBUSY)
    }
  }, 60_000)
})

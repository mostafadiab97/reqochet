// 1.0.2 (SEC-WP3-02, SEC-WP3-22): reading one item by path, and Compare's working-folder side, apply the folder listing's
// checks — a link is not followed and a file over 5 MB is not read whole.
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFileRepositoryStore } from '../src/modules/repository-store'
import { generateItems } from '../src/modules/sample-data'
import { readChecked } from '../src/modules/workspace'

const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const base = mkdtempSync(join(tmpdir(), 'rq-checked-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const big = 'x'.repeat(6_000_000)

describe('checked reads (1.0.2)', () => {
  it('SEC-WP3-02: readItem refuses a file over 5 MB and does not follow a link', async () => {
    const root = join(base, 'repo')
    const repo = await createFileRepositoryStore(schemaFile).initialize(root)
    const [a, b] = generateItems(repo.schema, { count: 2 })
    await repo.writeItem(a!)
    await repo.writeItem(b!)
    const pathA = join(repo.folder, repo.itemPath(a!.id))
    // a valid item file, made larger than 5 MB by its text (it would parse fine if it were read)
    writeFileSync(pathA, readFileSync(pathA, 'utf8') + big)
    const r = await repo.readItem(a!.id)
    expect(r?.ok).toBe(false)
    if (process.platform !== 'win32') {
      const secret = join(base, 'outside.md')
      const pathB = join(repo.folder, repo.itemPath(b!.id))
      // the item's own valid file, moved outside the project; the project keeps only a link to it
      writeFileSync(secret, readFileSync(pathB, 'utf8'))
      rmSync(pathB)
      symlinkSync(secret, pathB)
      const l = await repo.readItem(b!.id)
      expect(l?.ok).toBe(false)
    }
  })

  it('SEC-WP3-22: Compare reads only plain files of at most 5 MB', async () => {
    const small = join(base, 'small.md')
    writeFileSync(small, 'hello')
    expect(await readChecked(small)).toBe('hello')
    const large = join(base, 'large.md')
    writeFileSync(large, big)
    expect(await readChecked(large)).toBeNull()
    expect(await readChecked(join(base, 'missing.md'))).toBeNull()
    if (process.platform !== 'win32') {
      const link = join(base, 'link.md')
      symlinkSync(small, link)
      expect(await readChecked(link)).toBeNull()
    }
  })
})

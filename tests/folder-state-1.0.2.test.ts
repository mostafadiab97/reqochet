// 1.0.2 (CRA-15): a folder chosen for a new project that cannot be read is reported, not taken as empty.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { folderState } from '../src/main/folderState'

const base = mkdtempSync(join(tmpdir(), 'rq-folder-'))
afterAll(() => {
  chmodSync(join(base, 'locked'), 0o700)
  rmSync(base, { recursive: true, force: true })
})

describe('folder for a new project (1.0.2, CRA-15)', () => {
  it('empty, not there yet, holding files', async () => {
    mkdirSync(join(base, 'empty'))
    mkdirSync(join(base, 'full'))
    writeFileSync(join(base, 'full', 'x.txt'), 'x')
    expect(await folderState(join(base, 'empty'))).toEqual({ kind: 'empty' })
    expect(await folderState(join(base, 'new'))).toEqual({ kind: 'empty' })
    expect(await folderState(join(base, 'full'))).toEqual({ kind: 'full' })
  })
  it('a file instead of a folder, or a folder without read rights: unreadable, with the reason', async () => {
    const file = join(base, 'a-file')
    writeFileSync(file, 'x')
    const r = await folderState(file)
    expect(r.kind).toBe('unreadable')
    mkdirSync(join(base, 'locked'))
    chmodSync(join(base, 'locked'), 0o000)
    // root and Windows ignore the folder mode
    if (process.getuid?.() !== 0 && process.platform !== 'win32') expect((await folderState(join(base, 'locked'))).kind).toBe('unreadable')
  })
})

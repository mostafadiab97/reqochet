// 1.0.2: saving theme.json while Windows holds the file (EPERM/EBUSY — another program or a reader has it open; the
// intermittent "two saves in parallel" failure on the Windows runner). The rename is retried briefly; before each retry
// the file must still be the one the editor read; still locked at the end → a conflict. Never a silent overwrite, never
// a half-written or missing theme.json, no temporary file left.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lock = vi.hoisted(() => ({ failures: 0, code: 'EPERM', onFail: null as null | (() => void), calls: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const rename = async (from: string, to: string): Promise<void> => {
    if (String(to).endsWith('theme.json')) {
      lock.calls++
      if (lock.failures > 0) {
        lock.failures--
        lock.onFail?.()
        throw Object.assign(new Error(`${lock.code}: operation not permitted, rename`), { code: lock.code })
      }
    }
    return real.rename(from, to)
  }
  return { ...real, rename, default: { ...real, rename } }
})

const { createFileThemeService } = await import('../src/modules/theme')

let usr: string, cfg: string
const svc = () => createFileThemeService(cfg, join(usr, '..', 'res'), usr, { renameWaits: [1, 1, 1, 1] })
const file = () => join(usr, 'theme.json')
const tmps = () => readdirSync(usr).filter((n) => n.endsWith('.tmp'))

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'rq-theme-lock-'))
  cfg = join(root, 'cfg')
  usr = join(root, 'usr')
  for (const d of [cfg, usr, join(root, 'res')]) mkdirSync(d)
  writeFileSync(join(cfg, 'theme.json'), JSON.stringify({ modes: { light: { primary: '#111111' } } }))
  writeFileSync(file(), JSON.stringify({ spacing: { lg: '7px' } }))
  Object.assign(lock, { failures: 0, code: 'EPERM', onFail: null, calls: 0 })
})

describe('saving theme.json while Windows holds it (1.0.2)', () => {
  it('a short lock: retried, saved', async () => {
    const s = svc()
    const rev = (await s.layers()).revision
    lock.failures = 2
    await s.saveUser({ spacing: { lg: '1px' } }, rev)
    expect(lock.calls).toBe(3)
    expect(JSON.parse(readFileSync(file(), 'utf8')).spacing.lg).toBe('1px')
    expect(tmps()).toEqual([])
  })

  it('a lock that does not go away (EBUSY): a conflict, the old file stays, no temporary file', async () => {
    const s = svc()
    const rev = (await s.layers()).revision
    lock.failures = 99
    lock.code = 'EBUSY'
    await expect(s.saveUser({ spacing: { lg: '1px' } }, rev)).rejects.toThrow('THEME_FILE_CHANGED')
    expect(lock.calls).toBe(5) // the first try and four retries
    expect(JSON.parse(readFileSync(file(), 'utf8')).spacing.lg).toBe('7px')
    expect(tmps()).toEqual([])
  })

  it('the file changes while it is locked: a conflict at once, the other change is kept', async () => {
    const s = svc()
    const rev = (await s.layers()).revision
    lock.failures = 1
    // another program writes theme.json while it holds it
    lock.onFail = () => writeFileSync(file(), JSON.stringify({ spacing: { lg: '9px' } }))
    await expect(s.saveUser({ spacing: { lg: '1px' } }, rev)).rejects.toThrow('THEME_FILE_CHANGED')
    expect(lock.calls).toBe(1) // no second rename over the newer file
    expect(JSON.parse(readFileSync(file(), 'utf8')).spacing.lg).toBe('9px')
    expect(tmps()).toEqual([])
  })

  it('other errors are not retried', async () => {
    const s = svc()
    const rev = (await s.layers()).revision
    lock.failures = 1
    lock.code = 'ENOSPC'
    await expect(s.saveUser({ spacing: { lg: '1px' } }, rev)).rejects.toThrow(/ENOSPC/)
    expect(lock.calls).toBe(1)
    expect(tmps()).toEqual([])
  })
})

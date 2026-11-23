// 1.0.2 (security review 1.0.1: S5, S8, S11): "go back to an earlier version" with a fake network and a fake
// installer start. The installer may run only when it is this app's own release, matches its published SHA-512 and
// stays within its size; otherwise nothing is started and nothing is left on disk. Once it runs, a failed "updates
// paused" note must not stop the app from quitting for it.
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const APP = `rqtest${process.pid}`
const fake = vi.hoisted(() => ({
  routes: new Map<string, () => Response>(),
  fetched: [] as string[],
  quit: vi.fn(),
  spawn: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.1', getName: () => `rqtest${process.pid}`, quit: fake.quit },
  net: {
    fetch: async (url: string) => {
      fake.fetched.push(url)
      const route = fake.routes.get(url)
      return route ? route() : new Response('not found', { status: 404 })
    }
  }
}))
vi.mock('electron-updater', () => ({ autoUpdater: { on: () => undefined, setFeedURL: () => undefined, checkForUpdates: async () => undefined } }))
vi.mock('node:child_process', () => ({ spawn: fake.spawn }))

const { createGithubUpdater } = await import('../src/modules/updater/githubUpdater')
const { listedSize, readCapped } = await import('../src/modules/updater')

const work = mkdtempSync(join(tmpdir(), 'rq-install-earlier-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))
const feedFile = join(work, 'app-update.yml')
writeFileSync(feedFile, 'provider: github\nowner: own\nrepo: rq\n')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
const rollbackDirs = (): string[] => readdirSync(tmpdir()).filter((d) => d.startsWith(`${APP}-rollback-`))

const V = '0.28.0'
const NAME = `reqochet-Setup-${V}.exe`
const base = (repo = 'own/rq'): string => `https://github.com/${repo}/releases/download/v${V}`

/** One earlier release on the fake network; `opts` bend it into the cases to refuse. */
function release(opts: { installer?: Uint8Array; listed?: Uint8Array; listSize?: number; repo?: string; sumsLength?: string } = {}): Uint8Array {
  const real = new TextEncoder().encode('MZ pretend installer')
  const served = opts.installer ?? real
  const listed = opts.listed ?? real
  const sha = createHash('sha512').update(listed).digest('base64')
  const yml = `version: ${V}\nfiles:\n  - url: ${NAME}\n    sha512: ${sha}\n    size: ${opts.listSize ?? listed.byteLength}\npath: ${NAME}\nsha512: ${sha}\n`
  fake.routes.clear()
  fake.routes.set('https://api.github.com/repos/own/rq/releases?per_page=100', () =>
    Response.json([
      {
        tag_name: `v${V}`,
        published_at: '2026-11-16T00:00:00Z',
        assets: [
          { name: NAME, browser_download_url: `${base(opts.repo)}/${NAME}` },
          { name: 'latest.yml', browser_download_url: `${base(opts.repo)}/latest.yml` }
        ]
      }
    ])
  )
  fake.routes.set(`${base(opts.repo)}/${NAME}`, () => new Response(served))
  fake.routes.set(`${base(opts.repo)}/latest.yml`, () => new Response(yml, opts.sumsLength ? { headers: { 'content-length': opts.sumsLength } } : {}))
  return real
}

function updater(holdFile = join(work, `hold-${Math.random().toString(36).slice(2)}.json`)) {
  return { holdFile, u: createGithubUpdater({ enabled: true, log: quiet, holdFile, updateConfigFile: feedFile }) }
}

/** A started installer: emits 'spawn' as a real child process does. */
function childThatStarts(): EventEmitter & { unref: () => void } {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  setImmediate(() => child.emit('spawn'))
  return child
}

beforeEach(() => {
  fake.fetched.length = 0
  fake.quit.mockClear()
  fake.spawn.mockReset()
  fake.spawn.mockImplementation(childThatStarts)
})

describe('going back to an earlier version (1.0.2: S5, S8, S11)', () => {
  it('installs a matching installer of its own release, pauses updates and quits', async () => {
    release()
    const { u, holdFile } = updater()
    const r = await u.installEarlier(V, async () => true)
    expect(r).toEqual({ ok: true })
    expect(fake.spawn).toHaveBeenCalledTimes(1)
    const [file, args] = fake.spawn.mock.calls[0] as [string, string[]]
    expect(file.endsWith(NAME)).toBe(true)
    expect(args).toEqual(['/S', '--force-run'])
    expect(existsSync(holdFile)).toBe(true)
    await new Promise((res) => setTimeout(res, 600))
    expect(fake.quit).toHaveBeenCalled()
    rmSync(join(file, '..'), { recursive: true, force: true })
  })

  it('refuses an installer that does not match its SHA-512: nothing started, nothing left, no pause', async () => {
    release({ installer: new TextEncoder().encode('MZ tampered installer!') })
    const before = rollbackDirs().length
    const { u, holdFile } = updater()
    const r = await u.installEarlier(V, async () => true)
    expect(r.ok).toBe(false)
    expect(fake.spawn).not.toHaveBeenCalled()
    expect(rollbackDirs().length).toBe(before)
    expect(existsSync(holdFile)).toBe(false)
  })

  it('refuses a release whose downloads belong to another repository before downloading anything', async () => {
    release({ repo: 'someone/else' })
    const { u, holdFile } = updater()
    const r = await u.installEarlier(V, async () => true)
    expect(r.ok).toBe(false)
    expect(fake.fetched.some((f) => f.includes('/releases/download/'))).toBe(false)
    expect(fake.spawn).not.toHaveBeenCalled()
    expect(existsSync(holdFile)).toBe(false)
  })

  it('refuses an installer larger than latest.yml lists (S5)', async () => {
    const real = new TextEncoder().encode('MZ pretend installer')
    const bigger = new Uint8Array(real.byteLength + 1000)
    bigger.set(real)
    // the checksum matches the bigger file: only the listed size can refuse it
    release({ installer: bigger, listed: bigger, listSize: real.byteLength })
    const { u } = updater()
    expect((await u.installEarlier(V, async () => true)).ok).toBe(false)
    expect(fake.spawn).not.toHaveBeenCalled()
  })

  it('refuses a latest.yml that says it is larger than 64 KB (S5)', async () => {
    release({ sumsLength: String(10 * 1024 * 1024) })
    const { u } = updater()
    expect((await u.installEarlier(V, async () => true)).ok).toBe(false)
    expect(fake.fetched.some((f) => f.endsWith(`/${NAME}`))).toBe(false) // the installer was never downloaded
    expect(fake.spawn).not.toHaveBeenCalled()
  })

  it('stops without starting anything when the user keeps editing', async () => {
    release()
    const { u, holdFile } = updater()
    const r = await u.installEarlier(V, async () => false)
    expect(r).toMatchObject({ ok: false, canceled: true })
    expect(fake.spawn).not.toHaveBeenCalled()
    expect(existsSync(holdFile)).toBe(false)
  })

  it('still quits for the running installer when "updates paused" cannot be written (S8)', async () => {
    release()
    const blocker = join(work, 'a-file')
    writeFileSync(blocker, 'x')
    const { u } = updater(join(blocker, 'hold.json')) // its folder is a file: the write fails
    const r = await u.installEarlier(V, async () => true)
    expect(r).toEqual({ ok: true })
    expect(fake.spawn).toHaveBeenCalledTimes(1)
    await new Promise((res) => setTimeout(res, 600))
    expect(fake.quit).toHaveBeenCalled()
    const [file] = fake.spawn.mock.calls[0] as [string]
    rmSync(join(file, '..'), { recursive: true, force: true })
  })
})

describe('size helpers (1.0.2, S5)', () => {
  it('readCapped refuses more than the cap, by header or by what arrives', async () => {
    expect(await readCapped(new Response('abc'), 3)).toEqual(new TextEncoder().encode('abc'))
    await expect(readCapped(new Response('abcd'), 3)).rejects.toThrow(/larger than allowed/)
    await expect(readCapped(new Response('ab', { headers: { 'content-length': '999' } }), 100)).rejects.toThrow(/999/)
  })
  it('listedSize reads the size of the named file only', () => {
    const yml = 'files:\n  - url: a.exe\n    size: 120\n  - url: b.exe\n    size: -4\n'
    expect(listedSize(yml, 'a.exe')).toBe(120)
    expect(listedSize(yml, 'b.exe')).toBeNull()
    expect(listedSize(yml, 'c.exe')).toBeNull()
    expect(listedSize(': not yaml : [', 'a.exe')).toBeNull()
  })
})

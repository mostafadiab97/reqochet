// "Go back to an earlier version": which published versions a user may install instead of the
// current one. Pure functions, unit-tested in tests/versions-0.14.1.test.ts and tests/rollback-check-1.0.1.test.ts.
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'

/**
 * The oldest version one can go back to. Older versions do not know "updates paused", so they would update
 * themselves straight back to the newest one — and versions before 0.16 are ReqMan, another app (the rename).
 */
export const OLDEST_REVERT_TARGET = '0.16.0'

export interface ReleaseInfo {
  version: string
  date: string
  /** Download address of the Windows installer. */
  installerUrl: string
  /** The installer's file name (as listed in the release's latest.yml). */
  installerName: string
  /** Download address of the release's latest.yml: the installer's SHA-512, checked before it runs (1.0.1). */
  checksumsUrl: string
}

/**
 * Compares "1.2.3" versions: negative when a < b. A pre-release ranks below its release ("1.0.2-next.1" < "1.0.2"),
 * so a PC with a test build from the public `next` branch still sees the real release as newer; two pre-releases
 * of one version compare by their number ("next.2" > "next.1").
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): { core: number[]; pre: string | null } => {
    const s = v.trim().replace(/^v/, '').split('+')[0] ?? ''
    const dash = s.indexOf('-')
    const core = (dash < 0 ? s : s.slice(0, dash)).split('.').map((x) => Number.parseInt(x, 10) || 0)
    return { core, pre: dash < 0 ? null : s.slice(dash + 1) }
  }
  const pa = split(a)
  const pb = split(b)
  for (let i = 0; i < 3; i++) if ((pa.core[i] ?? 0) !== (pb.core[i] ?? 0)) return (pa.core[i] ?? 0) - (pb.core[i] ?? 0)
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  // semver: dot-separated parts, numbers by value and below words, words by text
  const xa = pa.pre.split('.')
  const xb = pb.pre.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const x = xa[i]
    const y = xb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) - Number(y)
    if (nx) return -1
    if (ny) return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Reads the GitHub "list releases" answer: published (not draft, not pre-release) versions with an installer. */
export function parseReleases(json: unknown): ReleaseInfo[] {
  if (!Array.isArray(json)) return []
  const out: ReleaseInfo[] = []
  for (const r of json as Array<Record<string, unknown>>) {
    if (r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string') continue
    const assets = Array.isArray(r.assets) ? (r.assets as Array<Record<string, unknown>>) : []
    const exe = assets.find((a) => typeof a.name === 'string' && /^[\w.-]+-Setup-[\d.]+\.exe$/.test(a.name))
    if (!exe || typeof exe.browser_download_url !== 'string' || !exe.browser_download_url.startsWith('https://github.com/')) continue
    // without the release's checksum file an installer cannot be checked, so it is never offered (1.0.1)
    const sums = assets.find((a) => a.name === 'latest.yml')
    if (!sums || typeof sums.browser_download_url !== 'string' || !sums.browser_download_url.startsWith('https://github.com/')) continue
    out.push({
      version: r.tag_name.replace(/^v/, ''),
      date: typeof r.published_at === 'string' ? r.published_at : '',
      installerUrl: exe.browser_download_url,
      installerName: exe.name as string,
      checksumsUrl: sums.browser_download_url
    })
  }
  return out
}

/**
 * The release to update to when the releases feed failed (GitHub answered the feed with 502):
 * the newest published release with an installer, if it is newer than `current`; null = up to date. Pure.
 */
export function newerRelease(releases: ReleaseInfo[], current: string): ReleaseInfo | null {
  const newest = [...releases].sort((a, b) => compareVersions(b.version, a.version))[0]
  return newest && compareVersions(newest.version, current) > 0 ? newest : null
}

/** Versions older than `current` and not older than OLDEST_REVERT_TARGET, newest first. */
export function revertTargets(releases: ReleaseInfo[], current: string, oldest = OLDEST_REVERT_TARGET): ReleaseInfo[] {
  return releases
    .filter((r) => compareVersions(r.version, current) < 0 && compareVersions(r.version, oldest) >= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * True when `url` is a download from this app's own release repository (`https://github.com/<owner>/<repo>/releases/
 * download/…`, owner and repo compared without case, as GitHub does) — nothing else is downloaded to run (1.0.1).
 */
export function isOwnReleaseUrl(url: string, owner: string, repo: string, fileName?: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  // compare the parsed, normalised path (encoded dots and the like cannot step out of the release folder)
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port || u.username || u.password || /%2e|%2f|%5c/i.test(url)) return false
  const parts = u.pathname.split('/')
  // ['', owner, repo, 'releases', 'download', tag, file]
  const [first, o = '', r = '', releases, download, tag, file = ''] = parts
  if (parts.length !== 7 || first !== '' || o.toLowerCase() !== owner.toLowerCase() || r.toLowerCase() !== repo.toLowerCase()) return false
  if (releases !== 'releases' || download !== 'download' || !tag || !file) return false
  return fileName === undefined || decodeURIComponent(file) === fileName
}

/** The release tag folder of a release download address ('' when it is not one). */
export function releaseTagOf(url: string): string {
  try {
    return new URL(url).pathname.split('/')[5] ?? ''
  } catch {
    return ''
  }
}

/**
 * Checks a downloaded installer against the SHA-512 its release published in latest.yml (electron-builder writes the
 * file name and the base64 SHA-512 there; the normal update path checks the same value). Pure: bytes and texts in.
 */
export function checkInstaller(bytes: Uint8Array, latestYml: string, fileName: string): { ok: true } | { ok: false; reason: string } {
  let doc: unknown
  try {
    doc = parseYaml(latestYml)
  } catch {
    return { ok: false, reason: 'the checksum file could not be read' }
  }
  const d = (typeof doc === 'object' && doc !== null ? doc : {}) as { files?: unknown; path?: unknown; sha512?: unknown }
  const files = (Array.isArray(d.files) ? (d.files as unknown[]) : []).filter((f): f is { url?: unknown; sha512?: unknown } => typeof f === 'object' && f !== null)
  const entry = files.find((f) => f.url === fileName)
  const expected = typeof entry?.sha512 === 'string' ? entry.sha512 : d.path === fileName && typeof d.sha512 === 'string' ? d.sha512 : null
  if (!expected) return { ok: false, reason: `the checksum file does not list ${fileName}` }
  const actual = createHash('sha512').update(bytes).digest('base64')
  return actual === expected ? { ok: true } : { ok: false, reason: 'the download does not match its published checksum' }
}

/** Largest installer accepted when going back to an earlier version (1.0.2, S5; reqochet's is about 120 MB). */
export const MAX_INSTALLER_BYTES = 512 * 1024 * 1024
/** Largest latest.yml accepted (a few hundred bytes in practice). */
export const MAX_CHECKSUMS_BYTES = 64 * 1024

/** The installer's size as listed in latest.yml (`files[].size`), or null when it is not given. Pure. */
export function listedSize(latestYml: string, fileName: string): number | null {
  try {
    const d = parseYaml(latestYml) as { files?: unknown } | null
    const files = Array.isArray(d?.files) ? (d.files as unknown[]) : []
    const entry = files.find((f): f is { url?: unknown; size?: unknown } => typeof f === 'object' && f !== null && (f as { url?: unknown }).url === fileName)
    return typeof entry?.size === 'number' && Number.isSafeInteger(entry.size) && entry.size > 0 ? entry.size : null
  } catch {
    return null
  }
}

/**
 * Reads a download's body, but never more than `cap` bytes (1.0.2, S5): a server that sends too much — by its
 * Content-Length or by what actually arrives — is refused before it fills the memory.
 */
export async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const said = Number(res.headers.get('content-length'))
  if (Number.isFinite(said) && said > cap) throw new Error(`the download is larger than allowed (${said} > ${cap} bytes)`)
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`the download is larger than allowed (more than ${cap} bytes)`)
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

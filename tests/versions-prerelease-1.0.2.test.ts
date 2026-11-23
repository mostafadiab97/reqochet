// 1.0.2: test builds from the public `next` branch carry versions like 1.0.2-next.1 — the real release must rank
// above them, so a PC with a test build is offered the release (the API fallback `newerRelease` uses this order).
import { describe, expect, it } from 'vitest'
import { compareVersions, newerRelease, type ReleaseInfo } from '../src/modules/updater'

const release = (version: string): ReleaseInfo => ({
  version,
  date: '2026-11-22',
  installerUrl: `https://github.com/o/reqochet/releases/download/v${version}/reqochet-Setup-${version}.exe`,
  installerName: `reqochet-Setup-${version}.exe`,
  checksumsUrl: `https://github.com/o/reqochet/releases/download/v${version}/latest.yml`
})

describe('pre-release versions (1.0.2)', () => {
  it('ranks a pre-release below its release and above the version before', () => {
    expect(compareVersions('1.0.2-next.1', '1.0.2')).toBeLessThan(0)
    expect(compareVersions('1.0.2', '1.0.2-next.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.2-next.1', '1.0.1')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.2-next.1', '1.0.2-next.1')).toBe(0)
  })

  it('orders pre-releases of one version by number, not by text', () => {
    expect(compareVersions('1.0.2-next.10', '1.0.2-next.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.2-next.1', '1.0.2-next.2')).toBeLessThan(0)
    expect(compareVersions('1.0.2-next', '1.0.2-next.1')).toBeLessThan(0)
    expect(compareVersions('1.0.2-alpha', '1.0.2-next')).toBeLessThan(0)
    expect(compareVersions('1.0.2-1', '1.0.2-next')).toBeLessThan(0)
  })

  it('keeps the plain order and ignores build metadata', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.2+abc', '1.0.2')).toBe(0)
  })

  it('offers the real release to a PC with a test build of the same version', () => {
    expect(newerRelease([release('1.0.1'), release('1.0.2')], '1.0.2-next.3')?.version).toBe('1.0.2')
    expect(newerRelease([release('1.0.1')], '1.0.2-next.3')).toBeNull()
  })
})

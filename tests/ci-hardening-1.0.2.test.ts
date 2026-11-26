// 1.0.2 (SEC-WP3-03, SEC-WP3-12, CR3-24): checks on the scripts that only run on the Windows runners or in the installer.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

describe('CI and installer hardening (1.0.2)', () => {
  it('SEC-WP3-03: the acceptance run starts the app and the installers without the CI token', () => {
    const src = read('e2e/acceptance.mjs')
    const launches = src.match(/electron\.launch\(\{[^)]*\}\)/g) ?? []
    expect(launches.length).toBeGreaterThan(0)
    for (const l of launches) expect(l).toContain('env: appEnv')
    expect(src).toMatch(/execFileSync\(file, \['\/S'\], \{[^}]*env: appEnv/)
    expect(src).toMatch(/const appEnv = [^\n]*GH_TOKEN\|GITHUB_TOKEN/)
  })
  it('CR3-24: the local update feed takes any free port', () => {
    const src = read('e2e/acceptance.mjs')
    expect(src).not.toMatch(/8765/)
    expect(src).toContain('server.listen(0, ')
  })
  it.skipIf(!existsSync(join(root, 'build', 'installer.nsh')))('SEC-WP3-12: the installer runs Windows tools by full path only', () => {
    const lines = read('build/installer.nsh').split('\n').filter((l) => /nsExec|ExecWait/.test(l))
    for (const l of lines) expect(l).not.toMatch(/['"\s](cmd|tasklist|taskkill|find)(\.exe)?\s/i)
    expect(lines.join('\n')).toContain('$SYSDIR\\taskkill.exe')
  })
})

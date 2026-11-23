// W-04 (the owner, 22 Nov 2026): the e2e accessibility report — axe results per screenshot, summed per rule.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { report, summarise } from '../e2e/a11y.mjs'

describe('accessibility report', () => {
  it('keeps one short entry per broken rule', () => {
    const found = summarise([{ id: 'color-contrast', impact: 'serious', help: 'Enough contrast', nodes: [{ target: ['.a'] }, { target: ['.b'] }, { target: ['.c'] }] }])
    expect(found).toEqual([
      {
        id: 'color-contrast',
        impact: 'serious',
        help: 'Enough contrast',
        count: 3,
        examples: ['.a', '.b'],
        details: ['.a', '.b', '.c'].map((target) => ({ target, html: '', why: '' }))
      }
    ])
  })

  it('sums rules over screens, worst impact first, and survives a missing folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11y-'))
    writeFileSync(join(dir, 'one.json'), JSON.stringify([{ id: 'label', impact: 'minor', help: 'Labels', count: 1, examples: [] }]))
    writeFileSync(join(dir, 'two.json'), JSON.stringify([{ id: 'aria-required-attr', impact: 'critical', help: 'ARIA | attrs', count: 4, examples: [] }, { id: 'label', impact: 'minor', help: 'Labels', count: 2, examples: [] }]))
    const md = report(dir)
    expect(md).toContain('2 screenshots checked, 2 rule(s) broken')
    const lines = md.split('\n').filter((l) => l.startsWith('| critical') || l.startsWith('| minor'))
    expect(lines[0]).toContain('aria-required-attr')
    expect(lines[0]).toContain('ARIA / attrs')
    expect(lines[1]).toMatch(/\| label \| Labels \| 2 \| 3 \|/)
    expect(report(join(dir, 'missing'))).toContain('No results')
  })
})

describe('strict accessibility check (1.0.2)', () => {
  it('lists the problems of the screens checked in this run only', async () => {
    const { broken } = await import('../e2e/a11y.mjs')
    const { mkdtempSync, utimesSync, writeFileSync: write } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join: at } = await import('node:path')
    const dir = mkdtempSync(at(tmpdir(), 'a11y-strict-'))
    write(at(dir, 'clean.json'), '[]')
    write(at(dir, 'bad.json'), JSON.stringify([{ id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 2, examples: ['.x'] }]))
    write(at(dir, 'old.json'), JSON.stringify([{ id: 'label', impact: 'minor', help: 'Labels', count: 1, examples: ['.y'] }]))
    const longAgo = new Date(Date.now() - 3_600_000)
    utimesSync(at(dir, 'old.json'), longAgo, longAgo)
    expect(broken(dir, Date.now() - 60_000)).toEqual(['bad: color-contrast (2) .x'])
    expect(broken(dir)).toHaveLength(2)
    expect(broken(at(dir, 'missing'))).toEqual([])
  })
})

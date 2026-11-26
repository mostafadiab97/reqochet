// Accessibility check at every e2e screenshot (W-04, the owner, 22 Nov 2026): axe-core tests the visible window against
// WCAG 2.1 A/AA. Results go to e2e/out/a11y/<screenshot>.json and one summary e2e/out/a11y.md. Strict since 1.0.2 (all
// screens clean): any problem found in a run fails the e2e run (`broken`, in run.mjs); `A11Y_STRICT=0` reports only.
// Set `A11Y=0` to skip (e.g. when measuring speed).
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AxeBuilder } from '@axe-core/playwright'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Short form of axe's result: one entry per broken rule, with how many elements, two examples and, for up to three
 * elements, a piece of their HTML and axe's reason (enough to find and fix it without running axe again).
 */
export function summarise(violations) {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    count: v.nodes.length,
    examples: v.nodes.slice(0, 2).map((n) => n.target.join(' ')),
    details: v.nodes.slice(0, 3).map((n) => ({
      target: n.target.join(' '),
      html: String(n.html ?? '').slice(0, 200),
      why: String(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 300)
    }))
  }))
}

/** Checks the page and writes `<dir>/<name>.json`. Never throws: a broken check must not break a scenario. */
export async function checkA11y(page, name, dir) {
  if (process.env.A11Y === '0') return null
  let still = null
  try {
    // colours are checked as they end up, not half-way through a hover fade (a button the mouse just left)
    still = await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
    // legacy mode runs inside the window itself: Electron cannot open the extra blank page the normal mode needs
    const result = await new AxeBuilder({ page }).withTags(TAGS).setLegacyMode(true).analyze()
    const found = summarise(result.violations)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(found, null, 1))
    return found
  } catch (e) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${name}.json`), JSON.stringify([{ id: 'axe-error', impact: 'unknown', help: String(e).slice(0, 200), count: 0, examples: [] }]))
    return null
  } finally {
    await still?.evaluate((el) => el.remove()).catch(() => undefined)
  }
}

const ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 }

/** One Markdown table over all screenshots: rule, impact, help, how many screens and elements, example screens. */
export function report(dir) {
  let files
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return '# Accessibility (axe-core)\n\nNo results.\n'
  }
  const rules = new Map()
  for (const f of files) {
    const screen = f.replace(/\.json$/, '')
    for (const v of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      const r = rules.get(v.id) ?? { ...v, screens: [], elements: 0 }
      r.screens.push(screen)
      r.elements += v.count
      rules.set(v.id, r)
    }
  }
  const rows = [...rules.values()].sort((a, b) => ORDER[a.impact] - ORDER[b.impact] || b.screens.length - a.screens.length)
  const lines = [
    '# Accessibility (axe-core, WCAG 2.1 A/AA)',
    '',
    `${files.length} screenshots checked, ${rows.length} rule(s) broken.${process.env.A11Y_STRICT === '0' ? ' Report-only (A11Y_STRICT=0).' : ' Strict: a broken rule fails the e2e run.'}`,
    '',
    '| Impact | Rule | What it means | Screens | Elements | Example screens |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.impact} | ${r.id} | ${r.help.replace(/\|/g, '/').replace(/\s+/g, ' ')} | ${r.screens.length} | ${r.elements} | ${r.screens.slice(0, 3).join(', ')} |`)
  ]
  return lines.join('\n') + '\n'
}

/**
 * The problems of the screens checked since `since` (ms; a partial run leaves older results of other scenarios in
 * the folder): one line per screen and rule. A check that could not run (axe-error) counts too — it would hide problems.
 */
export function broken(dir, since = 0) {
  let files
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const f of files.sort()) {
    const p = join(dir, f)
    if (statSync(p).mtimeMs < since) continue
    for (const v of JSON.parse(readFileSync(p, 'utf8'))) {
      out.push(`${f.replace(/\.json$/, '')}: ${v.id} (${v.count}) ${v.examples?.[0] ?? v.help ?? ''}`.trim())
    }
  }
  return out
}

export function resetA11y(dir) {
  rmSync(dir, { recursive: true, force: true })
}

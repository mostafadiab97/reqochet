// 1.0.3 measurement (CTO, 23 Nov 2026): can bulk writes (import, change many, moves) afford a flush to the disk?
// Four ways to write the same item-sized files atomically, timed:
//   none        — as now: no flush (1.0.1 and 1.0.2 for bulk writes)
//   each        — flush every file before its rename, one after another (what failed the first 1.0.2 release run)
//   parallel N  — the same, N files at a time
//   end N       — write without flush, then flush all written files at the end, N at a time
// Only the Windows runner tells the real cost (flushes are almost free in the Linux container).
// By hand only: MEASURE_FLUSH=1 npx vitest run tests/measure-flush-1.0.3.test.ts (MEASURE_COUNT=… to change 10,000).
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../src/modules/safe-files'

const RUN = process.env['MEASURE_FLUSH'] === '1' || process.env['MEASURE'] === '1'
const COUNT = Number(process.env['MEASURE_COUNT'] ?? 10_000)

/** Runs `fn` over `inputs`, at most `limit` at a time. */
async function eachLimit<T>(inputs: readonly T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < inputs.length) await fn(inputs[next++] as T)
  }
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker))
}

const flushFile = async (file: string): Promise<void> => {
  const h = await open(file, 'r+')
  try {
    await h.sync()
  } finally {
    await h.close()
  }
}

describe.skipIf(!RUN)('flushing bulk writes (1.0.3 measurement)', () => {
  it('times writing item files with and without flushes', { timeout: 1_800_000 }, async () => {
    const base = await mkdtemp(join(tmpdir(), 'rq-flush-'))
    // about the size of a generated item file (YAML header + a paragraph of text)
    const body = (i: number): string =>
      `---\nid: REQ-${String(i).padStart(7, '0')}\ntype: requirement\ntitle: Item ${i}\norder: a${i}\n---\n\n` +
      'The system shall do what this item says, measured and testable. '.repeat(12)
    const results: [string, number][] = []
    const run = async (label: string, write: (files: string[]) => Promise<void>): Promise<void> => {
      const dir = join(base, label.replace(/\W+/g, '-'))
      await mkdir(dir, { recursive: true })
      const files = Array.from({ length: COUNT }, (_, i) => join(dir, `REQ-${i}.md`))
      const t = performance.now()
      await write(files)
      results.push([label, Math.round(performance.now() - t)])
    }
    try {
      await run('none', async (files) => {
        for (const [i, f] of files.entries()) await writeFileAtomic(f, body(i), { flush: false })
      })
      await run('each', async (files) => {
        for (const [i, f] of files.entries()) await writeFileAtomic(f, body(i), { flush: true })
      })
      for (const n of [8, 32]) {
        await run(`parallel ${n}`, (files) => eachLimit([...files.entries()], n, ([i, f]) => writeFileAtomic(f, body(i), { flush: true })))
        await run(`end ${n}`, async (files) => {
          for (const [i, f] of files.entries()) await writeFileAtomic(f, body(i), { flush: false })
          await eachLimit(files, n, flushFile)
        })
      }
      const none = results[0]?.[1] ?? 1
      const lines = results.map(([l, ms]) => `${l.padEnd(12)} ${String(ms).padStart(7)} ms  ${(ms / COUNT).toFixed(2)} ms/file  x${(ms / none).toFixed(1)}`)
      console.log(`[measure-flush] ${COUNT} files\n${lines.join('\n')}`)
      if (process.env['GITHUB_ACTIONS']) console.log(`::notice title=measure-flush::${lines.join(' | ')}`)
      expect(results).toHaveLength(6)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})

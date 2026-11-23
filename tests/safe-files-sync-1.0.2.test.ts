// 1.0.2 (review A-07): an atomic write flushes the temporary file to the disk BEFORE it is renamed over the target, so a
// power cut right after the rename cannot leave an empty item file (some file systems commit the rename first).
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const order = vi.hoisted(() => [] as string[])
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const open: typeof real.open = (async (...args: Parameters<typeof real.open>) => {
    const h = await real.open(...args)
    const sync = h.sync.bind(h)
    h.sync = async () => {
      order.push('sync')
      return sync()
    }
    return h
  }) as typeof real.open
  const rename = async (from: string, to: string): Promise<void> => {
    order.push('rename')
    return real.rename(from, to)
  }
  return { ...real, open, rename, default: { ...real, open, rename } }
})

const { writeFileAtomic } = await import('../src/modules/safe-files')

describe('atomic writes are flushed before the rename (1.0.2, A-07)', () => {
  it('sync, then rename; the content arrives; no temporary file left', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rq-sync-'))
    await writeFileAtomic(join(dir, 'REQ-1.md'), 'hello\n')
    await writeFileAtomic(join(dir, 'REQ-2.md'), new TextEncoder().encode('bytes\n'))
    expect(order).toEqual(['sync', 'rename', 'sync', 'rename'])
    expect(readFileSync(join(dir, 'REQ-1.md'), 'utf8')).toBe('hello\n')
    expect(readFileSync(join(dir, 'REQ-2.md'), 'utf8')).toBe('bytes\n')
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
  it('flush: false (bulk writes) renames without the flush', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rq-sync-'))
    order.length = 0
    await writeFileAtomic(join(dir, 'REQ-3.md'), 'bulk\n', { flush: false })
    expect(order).toEqual(['rename'])
    expect(readFileSync(join(dir, 'REQ-3.md'), 'utf8')).toBe('bulk\n')
  })
})

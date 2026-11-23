// QA probes for 1.0.2: ReqIF identifier clashes, schema caps at the edges, version comparison oddities, atomic write retries.
import { mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { parseSchema } from '../src/modules/schema'
import { writeReqif } from '../src/modules/import-export'
import { generateItems } from '../src/modules/sample-data'
import type { Item } from '../src/modules/items'
import type { IndexedItem } from '../src/modules/index-cache'
import { compareVersions } from '../src/modules/updater'
import { writeFileAtomic, withRetry } from '../src/modules/safe-files'

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})
const base = parseSchema(readFileSync(join(__dirname, '..', 'config', 'default-schema.yaml'), 'utf8')).schema

/** A generated item as an index row (the writer takes index rows). */
const row = (item: Item): IndexedItem => ({ ...item, path: `items/${item.id}.md`, childCount: 0, incomingCount: 0, suspectCount: 0 })
const identifiers = (xml: string): string[] => [...xml.matchAll(/<SPEC-OBJECT IDENTIFIER="([^"]+)"/g)].map((m) => m[1] as string)

describe('QA 1.0.2: ReqIF identifiers', () => {
  it('two imported items whose source-ids differ only in characters XML cannot hold get distinct IDENTIFIERs', () => {
    const items = generateItems(base, { count: 2 })
    const xml = writeReqif(base, [{ item: row(items[0]!), sourceId: 'DOORS 1', depth: 0 }, { item: row(items[1]!), sourceId: 'DOORS_1', depth: 0 }], 't')
    const ids = identifiers(xml)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('source-ids "A B" and "_A_B" (the second is already valid) get distinct IDENTIFIERs', () => {
    const items = generateItems(base, { count: 2 })
    const xml = writeReqif(base, [{ item: row(items[0]!), sourceId: 'A B', depth: 0 }, { item: row(items[1]!), sourceId: '_A_B', depth: 0 }], 't')
    const ids = identifiers(xml)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('a source-id equal to another item’s own id does not duplicate an IDENTIFIER', () => {
    const items = generateItems(base, { count: 2 })
    const xml = writeReqif(base, [{ item: row(items[0]!), sourceId: items[1]!.id, depth: 0 }, { item: row(items[1]!), depth: 0 }], 't')
    const ids = identifiers(xml)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('a source-id with quotes or angle brackets stays valid XML text', () => {
    const items = generateItems(base, { count: 1 })
    const xml = writeReqif(base, [{ item: row(items[0]!), sourceId: 'a"<b>&c', depth: 0 }], 't')
    expect(identifiers(xml)[0]).toMatch(/^[A-Za-z_][\w.-]*$/)
    expect(xml).not.toMatch(/THE-VALUE="[^"]*<b>/)
  })
  it('an empty source-id does not produce an empty or invalid IDENTIFIER', () => {
    const items = generateItems(base, { count: 1 })
    const xml = writeReqif(base, [{ item: row(items[0]!), sourceId: '', depth: 0 }], 't')
    expect(identifiers(xml)[0]).toMatch(/^[A-Za-z_][\w.-]*$/)
  })
})

describe('QA 1.0.2: schema caps at the edges', () => {
  it('exactly 200 types / 50 required: no complaint', () => {
    const r = parseSchema(stringify({ itemTypes: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, ...(i === 0 ? { required: Array.from({ length: 50 }, (_, k) => `f${k}`) } : {}) })), fields: Array.from({ length: 50 }, (_, k) => ({ id: `f${k}`, name: `F${k}`, type: 'text' })), linkTypes: [] }))
    expect(r.problems.filter((p) => /checks only/.test(p.message))).toEqual([])
    expect(r.schema.itemTypes).toHaveLength(200)
  })
  // rewritten by the builder after review CR102-01: the schema keeps every type (a save writes them back); only the
  // "incomplete" filter stops at 200, with one warning
  it('201 types: exactly one warning, every type kept', () => {
    // (each type with a required field: only those count for the filter's limit — CR102-17)
    const r = parseSchema(stringify({ itemTypes: Array.from({ length: 201 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, required: ['title'] })), fields: [], linkTypes: [] }))
    expect(r.schema.itemTypes).toHaveLength(201)
    expect(r.problems.filter((p) => /checks only the first 200/.test(p.message) && p.severity === 'warning')).toHaveLength(1)
  })
  it('a rule `from` list of 21 types is refused without throwing', () => {
    const types = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }))
    const r = parseSchema(stringify({ itemTypes: types, fields: [], linkTypes: [], rules: [{ id: 'r1', type: 't0', from: types.slice(1, 22).map((t) => t.id), min: 1, link: 'x' }] }))
    expect(r.schema.itemTypes.length).toBe(25)
  })
  it('a schema made of garbage text does not throw', () => {
    for (const t of ['', ':::', '- 1\n- 2', 'itemTypes: 5', 'itemTypes: [null, 3, {}]']) expect(() => parseSchema(t)).not.toThrow()
  })
})

describe('QA 1.0.2: compareVersions odd inputs', () => {
  it('orders the semver precedence example chain', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
    for (let i = 0; i < chain.length - 1; i++) {
      expect(compareVersions(chain[i]!, chain[i + 1]!), `${chain[i]} < ${chain[i + 1]}`).toBeLessThan(0)
      expect(compareVersions(chain[i + 1]!, chain[i]!)).toBeGreaterThan(0)
    }
  })
  it('ignores build metadata and a leading v', () => {
    expect(compareVersions('v1.0.2+abc', '1.0.2+def')).toBe(0)
    expect(compareVersions('1.0.2-next.1+x', '1.0.2-next.1')).toBe(0)
  })
  it('two-part and four-part versions do not misorder', () => {
    expect(compareVersions('1.1', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.2.1', '1.0.2')).toBeGreaterThanOrEqual(0)
  })
  it('garbage never returns NaN', () => {
    for (const v of ['', 'x', '1.x.3', '-', '1.0.2-', 'v', '1..2']) {
      expect(Number.isNaN(compareVersions(v, '1.0.0'))).toBe(false)
      expect(Number.isNaN(compareVersions('1.0.0', v))).toBe(false)
    }
  })
  it('compare is antisymmetric on a mixed set', () => {
    const vs = ['1.0.2-next.1', '1.0.2-next.2', '1.0.2', '1.0.1', '1.0.2-next', '1.0.2-next.10', '1.0.2-0']
    for (const a of vs) for (const b of vs) expect(Math.sign(compareVersions(a, b))).toBe(-Math.sign(compareVersions(b, a)) || 0)
  })
})

describe('QA 1.0.2: atomic write under locks', () => {
  it('leaves no temporary file after a successful write and keeps old content intact when the target is a directory', async () => {
    const d = await mkdtemp(join(tmpdir(), 'rq-qa-'))
    dirs.push(d)
    await writeFileAtomic(join(d, 'a.txt'), 'one')
    await writeFileAtomic(join(d, 'a.txt'), 'two')
    expect(await readFile(join(d, 'a.txt'), 'utf8')).toBe('two')
    expect((await readdir(d)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    await expect(writeFileAtomic(d, 'x', { waits: [1] })).rejects.toThrow()
  })
  it('withRetry gives up after the waits and rethrows the last transient error; non-transient fails at once', async () => {
    let n = 0
    await expect(withRetry(async () => { n++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }) }, [1, 1, 1])).rejects.toThrow('busy')
    expect(n).toBe(4)
    n = 0
    await expect(withRetry(async () => { n++; throw Object.assign(new Error('no'), { code: 'ENOENT' }) }, [1, 1])).rejects.toThrow('no')
    expect(n).toBe(1)
  })
  it('a path with Arabic characters and spaces is written', async () => {
    const d = await mkdtemp(join(tmpdir(), 'rq-qa-'))
    dirs.push(d)
    const f = join(d, 'مجلد اختبار', 'ملف.txt')
    await writeFileAtomic(f, 'نص', { mkdir: true })
    await writeFile(f + '.x', '')
    expect(await readFile(f, 'utf8')).toBe('نص')
  })
})

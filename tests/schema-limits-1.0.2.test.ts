// 1.0.2 (SEC-WP3-18, corrected after review CR102-01): a pulled schema with thousands of item types or required fields
// must not break the "incomplete" filter ("Expression tree is too large"). The schema keeps every entry — saving Types
// writes the parsed list back, so dropping entries in the parser deleted them from schema.yaml — only the filter stops
// at 200 types × 50 required fields, and the parser warns.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { createSqliteIndexCache } from '../src/modules/index-cache'
import { createFileRepositoryStore } from '../src/modules/repository-store'
import { parseSchema } from '../src/modules/schema'

const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const base = mkdtempSync(join(tmpdir(), 'rq-schema-limits-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

/** `types` item types; the first has `required` required fields, the others `title` when `allRequire` (only types with
 * required fields count for the filter's limit — CR102-17). */
const big = (types: number, required: number, allRequire = false): Record<string, unknown> => ({
  itemTypes: Array.from({ length: types }, (_, i) => ({
    id: `type-${i}`,
    name: `Type ${i}`,
    ...(i === 0 ? { required: Array.from({ length: required }, (_, k) => `f${k}`) } : allRequire ? { required: ['title'] } : {})
  })),
  fields: Array.from({ length: Math.max(required, 1) }, (_, k) => ({ id: `f${k}`, name: `F${k}`, type: 'text' })),
  linkTypes: [{ id: 'verifies', name: 'verifies', reverseName: 'verified by' }]
})

describe('schema limits (1.0.2, SEC-WP3-18)', () => {
  it('the parser keeps every type and required field and warns about the filter limit', () => {
    const many = parseSchema(stringify(big(1000, 1, true)))
    expect(many.schema.itemTypes).toHaveLength(1000)
    expect(many.problems.filter((p) => /checks only the first 200/.test(p.message) && p.severity === 'warning')).toHaveLength(1)
    // 1,000 types but none with required fields: nothing for the filter to limit, no warning
    expect(parseSchema(stringify(big(1000, 0))).problems.filter((p) => /checks only/.test(p.message))).toEqual([])
    const req = parseSchema(stringify(big(1, 120)))
    expect(req.schema.itemTypes[0]?.required).toHaveLength(120)
    expect(req.problems.some((p) => /checks only the first 50/.test(p.message))).toBe(true)
    expect(parseSchema(stringify(big(12, 5))).problems.filter((p) => /checks only/.test(p.message))).toEqual([])
  })

  it('saving Types keeps all 250 types and 60 required fields in schema.yaml (CR102-01)', async () => {
    const root = join(base, 'roundtrip')
    const store = createFileRepositoryStore(schemaFile)
    await store.initialize(root)
    const file = join(root, 'requirements', '.reqochet', 'schema.yaml')
    writeFileSync(file, stringify(big(250, 60)))
    const repo = await store.open(root)
    expect(repo.schema.itemTypes).toHaveLength(250)
    const renamed = repo.schema.itemTypes.map((t, i) => (i === 0 ? { ...t, name: 'Renamed' } : t))
    await repo.writeSchemaTypes(renamed, repo.schema.linkTypes, repo.schemaRevision)
    const written = parse(readFileSync(file, 'utf8')) as { itemTypes: { id: string; name: string; required?: string[] }[] }
    expect(written.itemTypes).toHaveLength(250)
    expect(written.itemTypes[0]?.name).toBe('Renamed')
    expect(written.itemTypes[0]?.required).toHaveLength(60)
  })

  it('the "incomplete" filter works with 1,000 types × 100 required fields', () => {
    const index = createSqliteIndexCache(join(base, 'index.sqlite'))
    const required = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`type-${i}`, Array.from({ length: 100 }, (_, k) => `f${k}`)]))
    expect(() => index.query({ incomplete: true, required, limit: 0 })).not.toThrow()
    index.close?.()
  })
})

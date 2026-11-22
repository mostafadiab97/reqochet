// 1.0.2 (SEC-WP3-18): a pulled schema with thousands of item types or required fields is capped (the "incomplete" filter
// checks them all in one SQL query: 1,000 types made "Expression tree is too large"); the rest is listed under problems.
import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { parseSchema } from '../src/modules/schema'

const schema = (types: number, required: number): string =>
  stringify({
    itemTypes: Array.from({ length: types }, (_, i) => ({
      id: `type-${i}`,
      name: `Type ${i}`,
      ...(i === 0 ? { required: Array.from({ length: required }, (_, k) => `f${k}`) } : {})
    })),
    fields: Array.from({ length: Math.max(required, 1) }, (_, k) => ({ id: `f${k}`, name: `F${k}`, type: 'text' })),
    linkTypes: [{ id: 'verifies', name: 'verifies', reverseName: 'verified by' }]
  })

describe('schema limits (1.0.2, SEC-WP3-18)', () => {
  it('keeps the first 200 item types and says so', () => {
    const r = parseSchema(schema(1000, 0))
    expect(r.schema.itemTypes).toHaveLength(200)
    expect(r.problems.filter((p) => /At most 200 item types/.test(p.message))).toHaveLength(1)
  })
  it('keeps the first 50 required fields of a type and says so', () => {
    const r = parseSchema(schema(1, 120))
    expect(r.schema.itemTypes[0]?.required).toHaveLength(50)
    expect(r.problems.some((p) => /At most 50 required fields/.test(p.message))).toBe(true)
  })
  it('a normal schema is unchanged', () => {
    const r = parseSchema(schema(12, 5))
    expect(r.schema.itemTypes).toHaveLength(12)
    expect(r.schema.itemTypes[0]?.required).toHaveLength(5)
    expect(r.problems.filter((p) => /At most/.test(p.message))).toEqual([])
  })
})

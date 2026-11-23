// 1.0.2 (review CR102-13): every IDENTIFIER in an exported ReqIF file is unique, also when item source-ids, field ids,
// options and link types collide on purpose with the file's own fixed and generated names; every reference points at a
// defined identifier.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeReqif } from '../src/modules/import-export'
import type { IndexedItem } from '../src/modules/index-cache'
import type { Item } from '../src/modules/items'
import { generateItems } from '../src/modules/sample-data'
import { parseSchema, type Schema } from '../src/modules/schema'

const base = parseSchema(readFileSync(join(__dirname, '..', 'config', 'default-schema.yaml'), 'utf8')).schema
const row = (item: Item): IndexedItem => ({ ...item, path: `items/${item.id}.md`, childCount: 0, incomingCount: 0, suspectCount: 0 })

describe('ReqIF identifiers are unique (1.0.2, CR102-13)', () => {
  it('names that clash on purpose', () => {
    const schema: Schema = {
      ...base,
      fields: [
        ...base.fields,
        { id: 'number', name: 'Number field', type: 'text' },
        { id: 'markdown', name: 'Markdown field', type: 'text' },
        { id: 'string', name: 'String choice', type: 'enum', options: ['a', 'b'] },
        { id: 'a', name: 'A', type: 'enum', options: ['x', 'y'] },
        { id: 'a-0', name: 'A0', type: 'enum', options: ['z'] }
      ] as Schema['fields'],
      linkTypes: [...base.linkTypes, { id: '1', name: 'one', reverseName: 'one of' }]
    }
    const items = generateItems(schema, { count: 6 })
    // a link of type "1" makes relation entries next to the link type named "reqochet-rel-1"
    items[1]!.links = [{ type: '1', target: items[2]!.id, confirmed: '' } as Item['links'][number]]
    const xml = writeReqif(
      schema,
      [
        { item: row(items[0]!), sourceId: 'reqochet-spec', depth: 0 },
        { item: row(items[1]!), sourceId: 'reqochet-h-1', depth: 0 },
        { item: row(items[2]!), sourceId: items[3]!.id, depth: 0 },
        { item: row(items[3]!), depth: 0 },
        { item: row(items[4]!), sourceId: 'reqochet-ad-number', depth: 0 },
        { item: row(items[5]!), sourceId: 'A B', depth: 0 }
      ],
      'clash'
    )
    const ids = [...xml.matchAll(/ IDENTIFIER="([^"]+)"/g)].map((m) => m[1])
    const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(twice).toEqual([])
    // every *-REF points at an identifier of the file
    const refs = [...xml.matchAll(/<([A-Z-]+-REF)>([^<]+)<\/\1>/g)].map((m) => m[2])
    expect(refs.filter((r) => !ids.includes(r))).toEqual([])
    // the imported item that could keep its identifier did
    expect(ids).toContain('_A_B')
  })
})

// @vitest-environment jsdom
// 1.0.2 (CRA-09): opening an item showed "This item could not be read…" until the item arrived. Now the panel stays
// empty (busy) while it loads; the message appears only when the answer really is "nothing".
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { T } from '../../src/shared/text'
import { ItemEditor } from '../../src/renderer/src/workspace/ItemEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function open(getItem: (id: string) => Promise<unknown>): HTMLDivElement {
  ;(window as unknown as { reqochet: unknown }).reqochet = { getItem, getFieldValues: async () => [] }
  const host = document.createElement('div')
  document.body.append(host)
  const noop = (): void => undefined
  act(() => {
    createRoot(host).render(
      createElement(ItemEditor, {
        schema: { itemTypes: [], fields: [], linkTypes: [] } as never,
        target: { kind: 'item', id: 'REQ-AAAAAAA' },
        onSaved: noop,
        onDeleted: noop,
        onMoved: noop,
        onLinksChanged: noop,
        onNewChild: noop,
        onOpen: noop,
        onDirtyChange: noop,
        onClose: noop,
        reloadToken: 0
      })
    )
  })
  return host
}

describe('the editor while an item loads (1.0.2, CRA-09)', () => {
  it('shows nothing while waiting, and "could not be read" only after an empty answer', async () => {
    let answer: (v: unknown) => void = () => undefined
    const host = open(() => new Promise((r) => (answer = r)))
    expect(host.textContent).not.toContain(T.editor.unreadable)
    expect(host.querySelector('aside')?.getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      answer(null)
      await Promise.resolve()
    })
    expect(host.textContent).toContain(T.editor.unreadable)
  })
  it('a read that throws: the message, not an endless busy panel (CR102-06)', async () => {
    const host = open(async () => {
      throw new Error('window call failed')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(host.textContent).toContain(T.editor.unreadable)
  })
  it('a failed read after waiting: the message, not an endless busy panel', async () => {
    const host = open(vi.fn(async () => null))
    await act(async () => {
      await Promise.resolve()
    })
    expect(host.textContent).toContain(T.editor.unreadable)
  })
})

// @vitest-environment jsdom
// 1.0.2 (CRA-13): the row menu kept moving the focus back to its first item whenever the table re-rendered behind it;
// and it opens towards the reading direction (logical placement, mirrored in Arabic).
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { RowMenu } from '../../src/renderer/src/workspace/RowMenu'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const props = (onClose: () => void) => ({ id: 'REQ-AAAAAAA', x: 100, y: 50, chosenCount: 1, onExportItem: vi.fn(), onExportChosen: vi.fn(), onOpen: vi.fn(), onClose, onAddChild: vi.fn() })

describe('row menu (1.0.2, CRA-13)', () => {
  it('a re-render behind it does not move the focus; Escape calls the latest onClose', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const first = vi.fn()
    act(() => root.render(createElement(RowMenu, props(first))))
    const items = host.querySelectorAll('button')
    expect(document.activeElement).toBe(items[0])
    ;(items[1] as HTMLButtonElement).focus()
    const latest = vi.fn()
    act(() => root.render(createElement(RowMenu, props(latest)))) // new props object, as every parent render makes
    expect(document.activeElement).toBe(items[1])
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(latest).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
  it('opens from the pointer in left-to-right, mirrored in right-to-left', () => {
    for (const dir of ['ltr', 'rtl']) {
      document.documentElement.dir = dir
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      act(() => root.render(createElement(RowMenu, props(vi.fn()))))
      const menu = host.querySelector<HTMLElement>('[role="menu"]')!
      expect(menu.style.insetInlineStart).toBe(dir === 'ltr' ? '100px' : `${Math.min(window.innerWidth - 100, window.innerWidth - 280)}px`)
      expect(menu.style.left).toBe('')
      act(() => root.unmount())
    }
    document.documentElement.dir = ''
  })
})

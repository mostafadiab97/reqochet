import { useEffect, useRef } from 'react'
import { T } from '../../../shared/text'
import { useFeature } from '../lib/features'

/**
 * Right-click menu of a table row (M7). Right-clicking one of several chosen items acts on all of them; right-clicking
 * any other row acts on that row only — one export entry, never both (0.11.0: two entries were confusing).
 * The export dialog has "Include the items below" (ticked) to export only the items themselves.
 * Closes on Escape, on a click elsewhere and when the window scrolls.
 */
export function RowMenu(props: { id: string; x: number; y: number; chosenCount: number; onExportItem: () => void; onExportChosen: () => void; onOpen: () => void; onClose: () => void; onAddChild?: () => void; onDelete?: () => void; onDuplicate?: () => void; onChangeChosen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const exportOn = useFeature('export')
  // the latest onClose, without re-running the effect on every parent render (1.0.2, CRA-13: each re-run put the focus
  // back on the first item)
  const onClose = useRef(props.onClose)
  useEffect(() => {
    onClose.current = props.onClose
  })
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        // move between the menu's items (a menu is used with the arrow keys)
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
        e.preventDefault()
        return
      }
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose.current()
    }
    window.addEventListener('keydown', close)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [])
  // keep the menu inside the window; it opens towards the reading direction (right-to-left in Arabic: its right edge at
  // the pointer) — the pointer position is physical, the placement logical (CRA-13)
  const rtl = document.documentElement.dir === 'rtl'
  const insetInlineStart = Math.max(0, Math.min(rtl ? window.innerWidth - props.x : props.x, window.innerWidth - 280))
  const top = Math.min(props.y, window.innerHeight - 220)
  const act = (fn: () => void) => () => {
    props.onClose()
    fn()
  }
  return (
    <div ref={ref} className="row-menu" role="menu" aria-label={T.rowMenu.label(props.id)} style={{ insetInlineStart, top }}>
      <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onOpen)}>
        {T.rowMenu.open}
      </button>
      {props.onAddChild && (
        <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onAddChild)}>
          {T.rowMenu.addChild}
        </button>
      )}
      {props.onDuplicate && props.chosenCount <= 1 && (
        <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onDuplicate)}>
          {T.comfort.duplicate}
        </button>
      )}
      {props.onChangeChosen && props.chosenCount > 1 && (
        <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onChangeChosen)}>
          {T.comfort.changeChosen(props.chosenCount)}
        </button>
      )}
      {props.onDelete && (
        <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onDelete)}>
          {T.rowMenu.delete}
        </button>
      )}
      {!exportOn ? null : props.chosenCount > 1 ? (
        <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onExportChosen)}>
          {T.rowMenu.exportChosen(props.chosenCount)}
        </button>
      ) : (
        <button type="button" role="menuitem" className="row-menu__item" onClick={act(props.onExportItem)}>
          {T.rowMenu.exportItem}
        </button>
      )}
    </div>
  )
}

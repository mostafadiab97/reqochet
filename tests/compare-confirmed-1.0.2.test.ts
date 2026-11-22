// 1.0.2 (review A-06): Compare skips a commit as "link review only" when the files differ only in links' `confirmed:`
// lines. Only the header counts: an indented "confirmed:" line in the item's text is a real change.
import { describe, expect, it } from 'vitest'
import { sameIgnoringConfirmations } from '../src/modules/workspace'

const file = (confirmed: string, body: string): string =>
  `---\nid: REQ-AAAAAAA\ntitle: Brakes\nlinks:\n  - type: verifies\n    target: REQ-BBBBBBB\n    confirmed: ${confirmed}\n---\n${body}`

describe('link review only (1.0.2, A-06)', () => {
  it('a changed confirmation in the header is a link review', () => {
    expect(sameIgnoringConfirmations(file('aaaa1111', 'Text.\n'), file('bbbb2222', 'Text.\n'))).toBe(true)
    expect(sameIgnoringConfirmations(file('aaaa1111', 'Text.\n'), file('bbbb2222', 'Text.\n').replace(/\n/g, '\r\n'))).toBe(true)
  })
  it('an indented "confirmed:" line in the text is a real change', () => {
    expect(sameIgnoringConfirmations(file('aaaa1111', 'Result:\n  confirmed: by the lab\n'), file('aaaa1111', 'Result:\n  confirmed: by the supplier\n'))).toBe(false)
  })
  it('other changes, missing sides and files without a header', () => {
    expect(sameIgnoringConfirmations(file('a', 'One.\n'), file('a', 'Two.\n'))).toBe(false)
    expect(sameIgnoringConfirmations(null, file('a', ''))).toBe(false)
    expect(sameIgnoringConfirmations('plain\n  confirmed: x\n', 'plain\n  confirmed: y\n')).toBe(false)
  })
})

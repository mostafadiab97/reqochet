// 1.0.2 (CRA-12): if the theme cannot be loaded, the window starts with the built-in theme instead of showing the splash
// for ever.
import { describe, expect, it } from 'vitest'
import type { LoadedTheme } from '../../src/shared/api'
import { DEFAULT_THEME } from '../../src/shared/defaultTheme'
import { themeOrBuiltIn } from '../../src/renderer/src/theme/applyTheme'

describe('theme fallback (1.0.2, CRA-12)', () => {
  it('a failed load gives the built-in theme with the reason as a warning', async () => {
    const t = await themeOrBuiltIn(Promise.reject(new Error('theme.json locked')))
    expect(t.config).toBe(DEFAULT_THEME)
    expect(t.source).toBe('default')
    expect(t.warnings).toEqual(['theme.json locked'])
  })
  it('a loaded theme passes through unchanged', async () => {
    const loaded = { config: DEFAULT_THEME, logoDataUrl: 'data:x', source: 'user', warnings: [] } as LoadedTheme
    expect(await themeOrBuiltIn(Promise.resolve(loaded))).toBe(loaded)
  })
})

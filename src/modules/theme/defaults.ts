import type { ThemeConfig } from '../../shared/api'

import { DEFAULT_THEME } from '../../shared/defaultTheme'
export { DEFAULT_THEME }

const GROUPS = ['typography', 'shape', 'spacing'] as const

/**
 * Merges a theme file over a base theme (by default the built-in one). Unknown or wrongly-typed values
 * are ignored with a warning, so a typo in theme.json can never break the app.
 */
export function validateTheme(
  input: unknown,
  base: ThemeConfig = DEFAULT_THEME
): { theme: ThemeConfig; warnings: string[] } {
  const warnings: string[] = []
  const theme: ThemeConfig = structuredClone(base)
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { theme, warnings: ['theme.json is not a JSON object; ignored.'] }
  }
  const src = input as Record<string, unknown>

  const brand = src.brand as Record<string, unknown> | undefined
  if (brand) {
    // "ReqMan" was the old default name, copied into users' themes before the rename: it does not override the new one
    if (typeof brand.name === 'string' && brand.name !== 'ReqMan') theme.brand.name = brand.name
    if (typeof brand.logo === 'string') theme.brand.logo = brand.logo
  }

  const mergeGroup = (target: Record<string, string>, value: unknown, path: string): void => {
    if (value === undefined) return
    if (typeof value !== 'object' || value === null) {
      warnings.push(`${path} must be an object; ignored.`)
      return
    }
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === 'string' && v.trim() !== '') target[key] = v
      else warnings.push(`${path}.${key} must be a non-empty string; ignored.`)
    }
  }

  for (const group of GROUPS) mergeGroup(theme[group], src[group], group)
  const modes = src.modes as Record<string, unknown> | undefined
  if (modes) {
    mergeGroup(theme.modes.light, modes.light, 'modes.light')
    mergeGroup(theme.modes.dark, modes.dark, 'modes.dark')
    mergeGroup(theme.modes.ember, modes.ember, 'modes.ember')
  }
  return { theme, warnings }
}

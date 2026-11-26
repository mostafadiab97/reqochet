// Turns the design tokens from config/theme.json into CSS custom properties on <html>.
// Every style in the UI reads these variables (var(--rm-...)); nothing hard-codes a colour, font or radius.
//   typography.fontFamily  -> --rm-font-family
//   shape.buttonRadius     -> --rm-shape-button-radius
//   modes.dark.primary     -> --rm-color-primary (when dark mode is active)
import { useEffect, useState } from 'react'
import type { LoadedTheme, ThemeConfig } from '../../../shared/api'
import { DEFAULT_THEME } from '../../../shared/defaultTheme'
import { tokensToCssVars } from './tokens'

export type ThemeMode = 'system' | 'light' | 'dark' | 'ember'
/** The colour set shown: Ember is a dark mode of its own (0.22.0). */
export type Shown = 'light' | 'dark' | 'ember'
const STORAGE_KEY = 'reqman.themeMode'

export function resolveMode(mode: ThemeMode): Shown {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(config: ThemeConfig, mode: ThemeMode): void {
  const effective = resolveMode(mode)
  const root = document.documentElement
  for (const [name, value] of Object.entries(tokensToCssVars(config, effective))) {
    root.style.setProperty(name, value)
  }
  root.dataset['theme'] = effective
  root.style.colorScheme = effective === 'light' ? 'light' : 'dark'
}

export function loadSavedMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'ember' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* storage unavailable: the choice simply isn't remembered */
  }
}

/** The colour set shown now — follows Windows while the mode is System (to pick the brand files: light, dark or Ember). */
export function useEffectiveMode(mode: ThemeMode): Shown {
  const [system, setSystem] = useState<'light' | 'dark'>(() => (resolveMode('system') === 'dark' ? 'dark' : 'light'))
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mode === 'system' ? system : mode
}

/** The loaded theme, or the built-in one when loading fails — the splash never waits for ever (1.0.2, CRA-12). */
export function themeOrBuiltIn(loading: Promise<LoadedTheme>): Promise<LoadedTheme> {
  return loading.catch((e: unknown): LoadedTheme => ({ config: DEFAULT_THEME, logoDataUrl: '', source: 'default', warnings: [String(e instanceof Error ? e.message : e)] }))
}

import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<Theme, 'system'>

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

export const THEME_STORAGE_KEY = 'kuroko-theme'
export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme 必须在 ThemeProvider 中使用')
  return context
}

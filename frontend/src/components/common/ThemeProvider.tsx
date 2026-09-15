import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_PALETTE,
  parsePalette,
  parseTheme,
  THEME_PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  ThemeContext,
  type Theme,
  type ThemePalette,
} from '@/hooks/useTheme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(() => {
    try {
      return parseTheme(localStorage.getItem(THEME_STORAGE_KEY))
    } catch {
      return 'system'
    }
  })

  const [palette, updatePalette] = useState<ThemePalette>(() => {
    try {
      return parsePalette(localStorage.getItem(THEME_PALETTE_STORAGE_KEY))
    } catch {
      return DEFAULT_PALETTE
    }
  })

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.style.colorScheme = resolvedTheme
    document.documentElement.setAttribute('data-theme', palette)
  }, [resolvedTheme, palette])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystem = () => setSystemDark(media.matches)
    const syncStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        updateTheme(parseTheme(event.newValue))
      }
      if (event.key === THEME_PALETTE_STORAGE_KEY || event.key === null) {
        updatePalette(parsePalette(event.newValue))
      }
    }

    syncSystem()
    media.addEventListener('change', syncSystem)
    window.addEventListener('storage', syncStorage)
    return () => {
      media.removeEventListener('change', syncSystem)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])

  const setTheme = useCallback((value: Theme) => {
    const next = parseTheme(value)
    updateTheme(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* 隐私模式或存储配额不足时，当前页面仍可正常切换主题。 */
    }
  }, [])

  const setPalette = useCallback((value: ThemePalette) => {
    const next = parsePalette(value)
    updatePalette(next)
    try {
      localStorage.setItem(THEME_PALETTE_STORAGE_KEY, next)
    } catch {
      /* 隐私模式或存储配额不足时，当前页面仍可正常切换调色板。 */
    }
  }, [])

  const context = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      palette,
      setPalette,
    }),
    [theme, resolvedTheme, setTheme, palette, setPalette]
  )

  return <ThemeContext.Provider value={context}>{children}</ThemeContext.Provider>
}

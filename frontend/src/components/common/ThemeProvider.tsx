import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { parseTheme, THEME_STORAGE_KEY, ThemeContext, type Theme } from '@/hooks/useTheme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(() => {
    try { return parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) }
    catch { return 'system' }
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystem = () => setSystemDark(media.matches)
    const syncStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) updateTheme(parseTheme(event.newValue))
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
    try { localStorage.setItem(THEME_STORAGE_KEY, next) }
    catch { /* 隐私模式或存储配额不足时，当前页面仍可正常切换主题。 */ }
  }, [])
  const context = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])

  return <ThemeContext.Provider value={context}>{children}</ThemeContext.Provider>
}

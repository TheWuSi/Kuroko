import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<Theme, 'system'>

export type ThemePalette =
  | 'indigo-slate'
  | 'ocean-azure'
  | 'obsidian-luxe'
  | 'cyber-violet'
  | 'emerald-matrix'
  | 'warm-amber'

export interface PaletteMeta {
  id: ThemePalette
  name: string
  englishName: string
  description: string
  primaryColor: string
  tag: string
}

export const THEME_PALETTES: readonly PaletteMeta[] = [
  {
    id: 'indigo-slate',
    name: '极客靛蓝',
    englishName: 'Indigo Slate',
    description: '冷青灰岩配以科技深靛蓝，专为长时间注视优化的沉浸质感（推荐）',
    primaryColor: '#6366f1',
    tag: '推荐',
  },
  {
    id: 'ocean-azure',
    name: '蔚蓝云海',
    englishName: 'Ocean Azure',
    description: '通透湛蓝天空海与深潜暗夜，网盘存储拓扑与多任务下载的自然搭档',
    primaryColor: '#0284c7',
    tag: '清爽',
  },
  {
    id: 'obsidian-luxe',
    name: '黑曜极简',
    englishName: 'Obsidian Luxe',
    description: '高反差黑白极简美学，纯粹中性灰阶梯，100% 聚焦媒体资产本身',
    primaryColor: '#18181b',
    tag: '极简',
  },
  {
    id: 'cyber-violet',
    name: '赛博幻紫',
    englishName: 'Cyber Violet',
    description: '霓虹电紫与暗夜紫影，流媒体放映室与影视番号的沉浸氛围感',
    primaryColor: '#a855f7',
    tag: '潮流',
  },
  {
    id: 'emerald-matrix',
    name: '翡翠极客',
    englishName: 'Emerald Matrix',
    description: '生机盎然的青翠绿，与下载速率指示、节点健康度天然共鸣',
    primaryColor: '#10b981',
    tag: '生机',
  },
  {
    id: 'warm-amber',
    name: '温暖琥珀',
    englishName: 'Warm Amber',
    description: '温润暮光暖金与烘焙陶土棕，过滤蓝光刺激，夜间使用柔和护眼',
    primaryColor: '#f59e0b',
    tag: '护眼',
  },
] as const

export const DEFAULT_PALETTE: ThemePalette = 'indigo-slate'
export const THEME_STORAGE_KEY = 'kuroko-theme'
export const THEME_PALETTE_STORAGE_KEY = 'kuroko-theme-palette'

export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function parsePalette(value: unknown): ThemePalette {
  return THEME_PALETTES.some((p) => p.id === value)
    ? (value as ThemePalette)
    : DEFAULT_PALETTE
}

export interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  palette: ThemePalette
  setPalette: (palette: ThemePalette) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme 必须在 ThemeProvider 中使用')
  return context
}

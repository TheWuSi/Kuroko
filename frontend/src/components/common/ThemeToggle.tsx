import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  parsePalette,
  parseTheme,
  THEME_PALETTES,
  useTheme,
  type ThemePalette,
} from '@/hooks/useTheme'

const modeOptions = [
  { value: 'light', label: '亮色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
] as const

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme, palette, setPalette } = useTheme()
  const Icon = resolvedTheme === 'dark' ? Moon : Sun
  const currentMode = modeOptions.find((option) => option.value === theme)?.label ?? '主题'
  const currentPalette = THEME_PALETTES.find((p) => p.id === palette)?.name ?? '调色风格'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 shrink-0 relative"
          aria-label={`外观主题（当前：${currentMode} · ${currentPalette}）`}
          title={`外观主题（当前：${currentMode} · ${currentPalette}）`}
        >
          <Icon className="h-4 w-4" />
          <span
            className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-1 ring-background shadow-xs"
            style={{
              backgroundColor:
                THEME_PALETTES.find((p) => p.id === palette)?.primaryColor ?? '#6366f1',
            }}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
          <Icon className="h-3.5 w-3.5 text-primary" />
          显示模式
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(parseTheme(value))}
        >
          {modeOptions.map(({ value, label, icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-10 gap-2 text-xs">
              <OptionIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
          <Palette className="h-3.5 w-3.5 text-primary" />
          调色风格
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={palette}
          onValueChange={(value) => setPalette(parsePalette(value as ThemePalette))}
        >
          {THEME_PALETTES.map((item) => (
            <DropdownMenuRadioItem
              key={item.id}
              value={item.id}
              className="min-h-10 gap-2 text-xs flex items-center justify-between"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-border"
                  style={{ backgroundColor: item.primaryColor }}
                />
                <span className="truncate">{item.name}</span>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                {item.tag}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

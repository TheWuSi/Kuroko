import { Menu, Sparkles } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { AppSidebar } from './AppSidebar'
import { useUiStore } from '@/stores/uiStore'

export function MobileTopNav() {
  const { mobileNavOpen, setMobileNavOpen } = useUiStore()

  return (
    <header className="lg:hidden sticky top-0 z-40 h-14 bg-background/90 backdrop-blur-md border-b border-border px-4 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-xs">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="font-bold text-base tracking-tight text-foreground">Kuroko</span>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="p-2 -mr-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/80 min-h-11 min-w-11 flex items-center justify-center cursor-pointer"
              aria-label="打开菜单"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SheetHeader className="sr-only">
              <SheetTitle>导航菜单</SheetTitle>
              <SheetDescription>访问工作台、任务、归档、存储与系统设置。</SheetDescription>
            </SheetHeader>
            <AppSidebar onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}

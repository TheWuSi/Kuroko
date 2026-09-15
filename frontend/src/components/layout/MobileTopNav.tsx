import { Menu, Sparkles } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from '@/components/ui/sheet'
import { AppSidebar } from './AppSidebar'
import { useUiStore } from '@/stores/uiStore'

export function MobileTopNav() {
  const { mobileNavOpen, setMobileNavOpen } = useUiStore()

  return (
    <header className="lg:hidden sticky top-0 z-40 h-14 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="font-bold text-base tracking-tight text-slate-900">Kuroko</span>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="p-2 -mr-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 min-h-11 min-w-11 flex items-center justify-center cursor-pointer"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-72">
          <SheetHeader className="sr-only">
            <SheetTitle>导航菜单</SheetTitle>
          </SheetHeader>
          <AppSidebar onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  )
}

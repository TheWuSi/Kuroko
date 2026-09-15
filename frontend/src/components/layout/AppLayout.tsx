import { Outlet } from 'react-router'
import { AppSidebar } from './AppSidebar'
import { MobileTopNav } from './MobileTopNav'
import { BackgroundActivity } from './BackgroundActivity'
import { MagnetActivity } from './MagnetActivity'

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* 桌面端常驻侧边栏 */}
      <div className="hidden lg:block shrink-0 sticky top-0 h-screen">
        <AppSidebar />
      </div>

      {/* 移动端顶部导航 */}
      <MobileTopNav />

      {/* 主视图区域 */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        <BackgroundActivity />
        <MagnetActivity />
        <Outlet />
      </main>
    </div>
  )
}

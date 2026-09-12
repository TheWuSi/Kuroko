import { Outlet } from 'react-router'
import { AppSidebar } from './AppSidebar'
import { MobileTopNav } from './MobileTopNav'
import { ToastContainer } from '@/components/common/ToastContainer'

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50">
      {/* 桌面端常驻侧边栏 */}
      <div className="hidden lg:block shrink-0 sticky top-0 h-screen">
        <AppSidebar />
      </div>

      {/* 移动端顶部导航 */}
      <MobileTopNav />

      {/* 主视图区域 */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        <Outlet />
      </main>

      {/* 全局 Toast 通知容器 */}
      <ToastContainer />
    </div>
  )
}

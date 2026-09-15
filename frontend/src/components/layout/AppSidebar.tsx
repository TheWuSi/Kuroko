import { NavLink, useNavigate } from 'react-router'
import {
  LayoutDashboard,
  Magnet,
  DownloadCloud,
  Film,
  HardDrive,
  Settings,
  LogOut,
  Sparkles,
  ChevronsUpDown,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const navItems = [
  { path: '/dashboard', label: '总览看板', icon: LayoutDashboard },
  { path: '/magnets', label: '磁力工作台', icon: Magnet },
  { path: '/tasks', label: '离线任务', icon: DownloadCloud },
  { path: '/codes', label: '番号归档', icon: Film },
  { path: '/storages', label: '存储拓扑', icon: HardDrive },
  { path: '/settings', label: '系统设置', icon: Settings },
]

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const userInitial = user?.username ? user.username.slice(0, 2).toUpperCase() : 'OP'

  return (
    <aside className="w-64 h-full flex flex-col bg-white border-r border-slate-200/80 select-none">
      {/* 品牌头部 */}
      <div className="h-16 flex items-center px-6 border-b border-slate-200/80 gap-3">
        <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <span className="font-bold text-base tracking-tight text-slate-900 block leading-none">
            Kuroko
          </span>
          <span className="text-[11px] text-slate-400 font-mono block mt-1">
            Media Ingestion v2.1
          </span>
        </div>
      </div>

      {/* 导航主列表 */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all min-h-11',
                  isActive
                    ? 'bg-blue-50 text-blue-600 font-semibold shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      {/* 底部用户信息与 DropdownMenu */}
      <div className="p-4 border-t border-slate-200/80">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 min-h-11"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 font-bold border border-blue-200 shrink-0">
                  <AvatarFallback className="rounded-lg text-xs font-mono">
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate">
                    {user?.username || '管理员'}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    在线 · {user?.role || 'admin'}
                  </p>
                </div>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-slate-400 shrink-0 ml-1" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56 p-1.5 mb-2 shadow-lg">
            <DropdownMenuLabel className="font-normal px-2.5 py-2">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold text-slate-900 leading-none">
                  {user?.username || '管理员'}
                </p>
                <p className="text-xs text-slate-400 font-mono">
                  {user?.role === 'admin' ? '系统超级管理员' : '系统操作员'}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                navigate('/settings')
                onNavigate?.()
              }}
              className="cursor-pointer gap-2 py-2"
            >
              <Settings className="h-4 w-4 text-slate-500" />
              <span>系统设置</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                navigate('/storages')
                onNavigate?.()
              }}
              className="cursor-pointer gap-2 py-2"
            >
              <HardDrive className="h-4 w-4 text-slate-500" />
              <span>存储拓扑</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="cursor-pointer gap-2 py-2 text-rose-600 focus:text-rose-600 focus:bg-rose-50"
            >
              <LogOut className="h-4 w-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

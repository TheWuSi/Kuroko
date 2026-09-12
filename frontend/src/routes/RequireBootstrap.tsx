import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '@/stores/authStore'
import { Loader2 } from 'lucide-react'

/**
 * 初始化路由守卫：
 * 仅在系统尚未初始化（initialized === false）时允许访问。
 * 若系统已初始化，则根据登录态重定向至 /dashboard 或 /login。
 */
export function RequireBootstrap() {
  const { token, user, initialized, loading, checkAuth } = useAuthStore()

  useEffect(() => {
    if (initialized === null) {
      checkAuth()
    }
  }, [initialized, checkAuth])

  if (loading && initialized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">正在检查系统初始化状态...</p>
        </div>
      </div>
    )
  }

  // 若系统已经完成初始化，禁止重复初始化
  if (initialized === true) {
    if (token && user) {
      return <Navigate to="/dashboard" replace />
    }
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

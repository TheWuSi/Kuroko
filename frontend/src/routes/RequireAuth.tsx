import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '@/stores/authStore'
import { Loader2 } from 'lucide-react'

export function RequireAuth() {
  const { token, user, initialized, loading, checkAuth } = useAuthStore()

  useEffect(() => {
    if (initialized === null || (token && !user)) {
      checkAuth()
    }
  }, [token, user, initialized, checkAuth])

  if (loading && initialized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">正在验证会话...</p>
        </div>
      </div>
    )
  }

  // 系统尚未创建管理员
  if (initialized === false) {
    return <Navigate to="/bootstrap" replace />
  }

  // 用户尚未登录
  if (!token) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

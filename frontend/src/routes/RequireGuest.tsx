import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '@/stores/authStore'
import { Loader2 } from 'lucide-react'

export function RequireGuest() {
  const { token, user, initialized, loading, checkAuth } = useAuthStore()

  useEffect(() => {
    if (initialized === null) {
      checkAuth()
    }
  }, [initialized, checkAuth])

  if (loading && initialized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  // 尚未初始化
  if (initialized === false) {
    return <Navigate to="/bootstrap" replace />
  }

  // 已登录
  if (token && user) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

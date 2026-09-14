import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuthStore } from '@/stores/authStore'
import { SessionCheck } from '@/components/common/SessionCheck'

export function RequireAuth() {
  const { token, user, initialized, loading, error, checkAuth } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (initialized === null || (token && !user)) {
      checkAuth()
    }
  }, [token, user, initialized, checkAuth])

  if (loading || error || (token && !user)) return <SessionCheck error={error} retry={() => void checkAuth()} />

  // 系统尚未创建管理员
  if (initialized === false) {
    return <Navigate to="/bootstrap" replace />
  }

  // 用户尚未登录或会话已失效
  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search + location.hash }} replace />
  }

  return <Outlet />
}

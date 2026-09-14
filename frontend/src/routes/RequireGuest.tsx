import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuthStore } from '@/stores/authStore'
import { SessionCheck } from '@/components/common/SessionCheck'
import { loginReturnPath } from '@/lib/authSession'

export function RequireGuest() {
  const { token, user, initialized, loading, error, checkAuth } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (initialized === null || (token && !user)) {
      checkAuth()
    }
  }, [initialized, token, user, checkAuth])

  if ((loading && initialized === null) || error) return <SessionCheck error={error} retry={() => void checkAuth()} />

  // 尚未初始化
  if (initialized === false) {
    return <Navigate to="/bootstrap" replace />
  }

  // 已登录
  if (token && user) {
    return <Navigate to={loginReturnPath(location.state?.from)} replace />
  }

  return <Outlet />
}

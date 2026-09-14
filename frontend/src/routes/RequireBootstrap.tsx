import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '@/stores/authStore'
import { SessionCheck } from '@/components/common/SessionCheck'

/**
 * 初始化路由守卫：
 * 仅在系统尚未初始化（initialized === false）时允许访问。
 * 若系统已初始化，则根据登录态重定向至 /dashboard 或 /login。
 */
export function RequireBootstrap() {
  const { token, user, initialized, loading, error, checkAuth } = useAuthStore()

  useEffect(() => {
    if (initialized === null) {
      checkAuth()
    }
  }, [initialized, checkAuth])

  if ((loading && initialized === null) || error) return <SessionCheck error={error} retry={() => void checkAuth()} />

  // 若系统已经完成初始化，禁止重复初始化
  if (initialized === true) {
    if (token && user) {
      return <Navigate to="/dashboard" replace />
    }
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from './RequireAuth'
import { RequireGuest } from './RequireGuest'
import { RequireBootstrap } from './RequireBootstrap'
import { Login } from '@/pages/Login'
import { Bootstrap } from '@/pages/Bootstrap'
import { Dashboard } from '@/pages/Dashboard'
import { MagnetParser } from '@/pages/MagnetParser'
import { Tasks } from '@/pages/Tasks'
import { Codes } from '@/pages/Codes'
import { Storages } from '@/pages/Storages'
import { Settings } from '@/pages/Settings'
import { NotFound } from '@/pages/NotFound'

export const router = createBrowserRouter([
  // 游客路由（登录页，若未初始化重定向到 /bootstrap，已登录跳转到 /dashboard）
  {
    element: <RequireGuest />,
    children: [
      {
        path: '/login',
        element: <Login />,
      },
    ],
  },
  // 初始化路由（仅在系统尚未创建首个管理员时开放）
  {
    element: <RequireBootstrap />,
    children: [
      {
        path: '/bootstrap',
        element: <Bootstrap />,
      },
    ],
  },
  // 受保护应用路由
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: '/',
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: '/dashboard',
            element: <Dashboard />,
          },
          {
            path: '/magnets',
            element: <MagnetParser />,
          },
          {
            path: '/tasks',
            element: <Tasks />,
          },
          {
            path: '/codes',
            element: <Codes />,
          },
          {
            path: '/storages',
            element: <Storages />,
          },
          {
            path: '/settings',
            element: <Settings />,
          },
          {
            path: '*',
            element: <NotFound />,
          },
        ],
      },
    ],
  },
])


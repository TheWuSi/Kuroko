import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from './RequireAuth'
import { RequireGuest } from './RequireGuest'
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
  // 游客路由（登录页，已登录自动跳转 /dashboard）
  {
    element: <RequireGuest />,
    children: [
      {
        path: '/login',
        element: <Login />,
      },
    ],
  },
  // 初始化路由
  {
    path: '/bootstrap',
    element: <Bootstrap />,
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

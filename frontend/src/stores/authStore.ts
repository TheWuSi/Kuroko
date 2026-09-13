import { create } from 'zustand'
import type { User } from '@/types/api'
import { authService } from '@/services/auth.service'
import { getStoredToken, removeStoredToken } from '@/services/client'
import { storageCache } from '@/stores/storageStore'

interface AuthState {
  token: string | null
  user: User | null
  initialized: boolean | null
  loading: boolean
  checkAuth: () => Promise<boolean>
  setInitialized: (val: boolean) => void
  setUser: (user: User | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: getStoredToken(),
  user: null,
  initialized: null,
  loading: true,

  checkAuth: async () => {
    set({ loading: true })
    try {
      // 1. 优先调用真实后端 /auth/bootstrap-status 检查是否已完成系统初始化
      const status = await authService.getBootstrapStatus()
      const isInitialized = Boolean(status?.initialized)
      set({ initialized: isInitialized })

      // 2. 若尚未初始化，必须强制清理凭据并返回 false，引导去初始化向导
      if (!isInitialized) {
        removeStoredToken()
        set({ token: null, user: null, loading: false })
        return false
      }

      // 3. 若已初始化，检查是否有 Token
      const storedToken = getStoredToken()
      if (!storedToken) {
        set({ token: null, user: null, loading: false })
        return false
      }

      // 4. 验证 Token 有效性并拉取当前用户信息
      try {
        const user = await authService.getCurrentUser()
        storageCache.initialize(user.id)
        set({ token: storedToken, user, loading: false })
        return true
      } catch {
        // Token 失效或被注销
        removeStoredToken()
        set({ token: null, user: null, loading: false })
        return false
      }
    } catch {
      set({ loading: false })
      return false
    }
  },

  setInitialized: (val: boolean) => set({ initialized: val }),

  setUser: (user) => {
    storageCache.initialize(user?.id ?? null)
    set({ user })
  },

  logout: () => {
    authService.logout()
    storageCache.clear()
    set({ token: null, user: null })
  },
}))


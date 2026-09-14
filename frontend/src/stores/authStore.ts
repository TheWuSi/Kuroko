import { create } from 'zustand'
import type { User } from '@/types/api'
import { authService } from '@/services/auth.service'
import { authSession, getStoredToken, removeStoredToken } from '@/services/client'
import { storageCache } from '@/stores/storageStore'

interface AuthState {
  token: string | null
  user: User | null
  initialized: boolean | null
  loading: boolean
  error: string
  checkAuth: () => Promise<boolean>
  setInitialized: (val: boolean) => void
  setUser: (user: User | null) => void
  logout: () => void
}

let checking: { epoch: number; promise: Promise<boolean> } | null = null

export const useAuthStore = create<AuthState>((set) => ({
  token: getStoredToken(), user: null, initialized: null, loading: true, error: '',

  checkAuth: () => {
    const epoch = authSession.getEpoch()
    if (checking?.epoch === epoch) return checking.promise
    const current = () => authSession.getEpoch() === epoch
    set({ loading: true, error: '' })
    const promise = (async () => {
      try {
        const status = await authService.getBootstrapStatus()
        if (!current()) return false
        set({ initialized: Boolean(status.initialized) })
        if (!status.initialized) {
          removeStoredToken()
          set({ token: null, user: null, loading: false })
          return false
        }
        if (!getStoredToken()) {
          set({ token: null, user: null, loading: false })
          return false
        }
        const user = await authService.getCurrentUser()
        if (!current()) return false
        storageCache.initialize(user.id)
        set({ token: getStoredToken(), user, loading: false, error: '' })
        return true
      } catch (error) {
        if (current()) {
          // 只有认证拦截器收到确定的凭证失效才注销，断网和 5xx 留在可重试状态。
          set({ loading: false, error: error instanceof Error ? error.message : '暂时无法验证会话，请重试' })
        }
        return false
      }
    })()
    checking = { epoch, promise }
    void promise.finally(() => { if (checking?.promise === promise) checking = null })
    return promise
  },
  setInitialized: (initialized) => set({ initialized }),
  setUser: (user) => { storageCache.initialize(user?.id ?? null); set({ user }) },
  logout: () => { authService.logout(); storageCache.clear(); set({ token: null, user: null, error: '', loading: false }) },
}))

authSession.subscribe((tokens, changed) => {
  if (changed) {
    storageCache.clear()
    useAuthStore.setState({ token: tokens?.token ?? null, user: null, loading: false, error: '' })
  } else useAuthStore.setState({ token: tokens?.token ?? null })
})

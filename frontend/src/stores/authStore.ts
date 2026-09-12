import { create } from 'zustand'
import type { User } from '@/types/api'
import { authService } from '@/services/auth.service'
import { getStoredToken } from '@/services/client'

interface AuthState {
  token: string | null
  user: User | null
  initialized: boolean | null
  loading: boolean
  checkAuth: () => Promise<boolean>
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
      const status = await authService.getStatus()
      set({
        initialized: status.initialized,
        token: getStoredToken(),
      })

      if (!status.initialized) {
        set({ user: null, loading: false })
        return false
      }

      if (status.authenticated && getStoredToken()) {
        try {
          const user = await authService.getCurrentUser()
          set({ user, loading: false })
          return true
        } catch {
          set({ user: null, loading: false })
          return false
        }
      }

      set({ user: null, loading: false })
      return false
    } catch {
      set({ loading: false })
      return false
    }
  },

  setUser: (user) => set({ user }),

  logout: () => {
    authService.logout()
    set({ token: null, user: null })
  },
}))

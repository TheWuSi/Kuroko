import { create } from 'zustand'
import type { User } from '../types/api'

type AuthState = {
  token: string | null
  user: User | null
  setSession: (token: string, user: User) => void
  clearSession: () => void
}

const TOKEN_KEY = 'kuroko_token'

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  setSession: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token)
    set({ token, user })
  },
  clearSession: () => {
    localStorage.removeItem(TOKEN_KEY)
    set({ token: null, user: null })
  },
}))

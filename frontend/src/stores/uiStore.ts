import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: string
  title?: string
  message: string
  type: ToastType
  duration?: number
}

interface UiState {
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id'>) => void
  removeToast: (id: string) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  toasts: [],

  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newToast: ToastItem = { ...toast, id }
    set({ toasts: [...get().toasts, newToast] })

    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id)
      }, duration)
    }
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

// 便捷方法
export const toast = {
  success: (message: string, title?: string) =>
    useUiStore.getState().addToast({ message, title, type: 'success' }),
  error: (message: string, title?: string) =>
    useUiStore.getState().addToast({ message, title, type: 'error' }),
  warning: (message: string, title?: string) =>
    useUiStore.getState().addToast({ message, title, type: 'warning' }),
  info: (message: string, title?: string) =>
    useUiStore.getState().addToast({ message, title, type: 'info' }),
}

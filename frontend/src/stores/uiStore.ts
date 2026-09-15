import { create } from 'zustand'
import { toast as sonnerToast } from 'sonner'

interface UiState {
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}))

export const toast = {
  success: (message: string, title?: string) => sonnerToast.success(title ?? message, { description: title ? message : undefined }),
  error: (message: string, title?: string) => sonnerToast.error(title ?? message, { description: title ? message : undefined }),
  warning: (message: string, title?: string) => sonnerToast.warning(title ?? message, { description: title ? message : undefined }),
  info: (message: string, title?: string) => sonnerToast.info(title ?? message, { description: title ? message : undefined }),
}

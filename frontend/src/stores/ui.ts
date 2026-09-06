import { create } from 'zustand'
import type { PageId } from '../components/layout/Shell'

type UiState = {
  page: PageId
  error: string
  setPage: (page: PageId) => void
  setError: (error: string) => void
  clearError: () => void
}

export const useUiStore = create<UiState>((set) => ({
  page: 'dashboard',
  error: '',
  setPage: (page) => set({ page, error: '' }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: '' }),
}))

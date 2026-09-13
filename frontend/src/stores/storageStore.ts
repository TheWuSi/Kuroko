import { useStore } from 'zustand'
import { createStorageCache, type StorageCacheState } from '@/lib/storageCache'
import { storageService } from '@/services/storage.service'

export const storageCache = createStorageCache({
  getRevision: (signal) => storageService.getRevision(signal),
  getStorages: (refresh, signal) => storageService.getStorages({ refresh }, signal),
  getGroups: (signal) => storageService.getGroups(signal),
  getIgnored: (signal) => storageService.getIgnored(signal),
})

export function useStorageStore<T>(selector: (state: StorageCacheState) => T): T {
  return useStore(storageCache.store, selector)
}

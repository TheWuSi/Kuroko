import { createStore } from 'zustand/vanilla'
import type { StorageGroup, StorageIgnore, StorageNodeInfo, StorageRevision } from '@/types/api'

const CACHE_PREFIX = 'kuroko_storage_snapshot_v1:'
const MAX_CACHE_LENGTH = 4_000_000

export interface StorageData {
  storages: StorageNodeInfo[]
  groups: StorageGroup[]
  ignored: StorageIgnore[]
}

export interface StorageCacheState extends StorageData {
  userId: number | null
  revision: StorageRevision | null
  updatedAt: number | null
  initialized: boolean
  loading: boolean
  error: string
}

interface Snapshot extends StorageData {
  revision: StorageRevision
  updatedAt: number
}

interface CacheDependencies {
  getRevision: (signal: AbortSignal) => Promise<StorageRevision>
  getStorages: (refresh: boolean, signal: AbortSignal) => Promise<StorageNodeInfo[]>
  getGroups: (signal: AbortSignal) => Promise<StorageGroup[]>
  getIgnored: (signal: AbortSignal) => Promise<StorageIgnore[]>
  storage?: () => Storage | undefined
}

const initialState = (): StorageCacheState => ({
  userId: null, storages: [], groups: [], ignored: [], revision: null,
  updatedAt: null, initialized: false, loading: false, error: '',
})
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max &&
  !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const path = (value: unknown): value is string => boundedText(value, 1024) && value.startsWith('/')
const priority = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 9999
const space = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2 ** 63 - 1)
const array = (value: unknown, max: number, valid: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length <= max && value.every(valid)

function validData(value: unknown): value is StorageData {
  return object(value) &&
    array(value.storages, 5000, (node) => object(node) && id(node.id) && path(node.mount_path) &&
      boundedText(node.driver, 255) && boundedText(node.status, 64) && typeof node.ignored === 'boolean' &&
      ['manual', 'openlist'].includes(String(node.space_source)) &&
      space(node.total_space) && space(node.used_space) && space(node.free_space) &&
      (node.space_error == null || boundedText(node.space_error, 2048))) &&
    array(value.groups, 1000, (group) => object(group) && id(group.id) && boundedText(group.name, 100) &&
      boundedText(group.created_at, 64) && array(group.storage_paths, 100, path) &&
      array(group.paths, 100, (entry) => object(entry) && id(entry.id) && path(entry.storage_mount) && path(entry.folder_path) && priority(entry.priority)) &&
      array(group.members, 100, (member) => object(member) && id(member.id) &&
        (member.storage_id === null || id(member.storage_id)) && path(member.storage_mount) &&
        path(member.download_path) && priority(member.priority) && array(member.archive_paths, 20, path))) &&
    array(value.ignored, 5000, (node) => object(node) && id(node.storage_id) && path(node.storage_mount))
}

function validRevision(value: unknown): value is StorageRevision {
  return object(value) && boundedText(value.source_id, 64) && value.source_id.length > 0 &&
    Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
}

function sameRevision(left: StorageRevision | null, right: StorageRevision): boolean {
  return left?.source_id === right.source_id && left.revision === right.revision
}

function browserStorage(): Storage | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage }
  catch { return undefined }
}

export function clearStorageSnapshots(storage = browserStorage()): void {
  try {
    if (!storage) return
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    keys.forEach((key) => { if (key?.startsWith(CACHE_PREFIX)) storage.removeItem(key) })
  } catch { /* 浏览器禁用存储时继续使用内存缓存。 */ }
}

export function createStorageCache(dependencies: CacheDependencies) {
  const store = createStore<StorageCacheState>(initialState)
  let generation = 0
  let dirty = false
  let forceRequested = false
  let pending: Promise<void> | null = null
  let controller: AbortController | null = null
  const storage = dependencies.storage ?? browserStorage

  function persist(snapshot: Snapshot | null) {
    const userId = store.getState().userId
    if (userId === null) return
    try {
      const key = CACHE_PREFIX + userId
      if (snapshot === null) storage()?.removeItem(key)
      else {
        const serialized = JSON.stringify(snapshot)
        if (serialized.length <= MAX_CACHE_LENGTH) storage()?.setItem(key, serialized)
        else storage()?.removeItem(key)
      }
    } catch { /* 配额或隐私设置不影响正常读取。 */ }
  }

  function invalidate(patch: Partial<StorageData> = {}, clear = false) {
    generation += 1
    controller?.abort()
    pending = null
    dirty = true
    forceRequested = false
    persist(null)
    store.setState({
      ...(clear ? { ...initialState(), userId: store.getState().userId } : {}),
      ...patch, loading: false,
    })
  }

  function initialize(userId: number | null) {
    if (userId === store.getState().userId) return
    invalidate({}, true)
    store.setState({ ...initialState(), userId, loading: userId !== null })
    if (userId === null) return
    try {
      const raw = storage()?.getItem(CACHE_PREFIX + userId)
      if (!raw || raw.length > MAX_CACHE_LENGTH) return
      const cached: unknown = JSON.parse(raw)
      if (!validData(cached) || !object(cached) || !validRevision(cached.revision) ||
        typeof cached.updatedAt !== 'number' || !Number.isFinite(cached.updatedAt) || cached.updatedAt <= 0) {
        persist(null)
        return
      }
      store.setState({
        storages: cached.storages, groups: cached.groups, ignored: cached.ignored,
        revision: cached.revision, updatedAt: cached.updatedAt, initialized: true, loading: false,
      })
      dirty = false
    } catch { persist(null) }
  }

  function refresh(force = false): Promise<void> {
    if (store.getState().userId === null) return Promise.resolve()
    forceRequested ||= force
    if (pending) return pending
    const ticket = generation
    const active = new AbortController()
    controller = active
    const current = () => generation === ticket && !active.signal.aborted

    async function load() {
      try {
        for (let attempt = 0; attempt < 2 && current(); attempt += 1) {
          const revision = await dependencies.getRevision(active.signal)
          if (!current()) return
          if (!validRevision(revision)) throw new Error('存储缓存版本响应无效')
          const previous = store.getState()
          if (previous.revision && previous.revision.source_id !== revision.source_id) {
            persist(null)
            store.setState({ ...initialState(), userId: previous.userId })
            dirty = true
          }
          if (!forceRequested && !dirty && store.getState().initialized && sameRevision(store.getState().revision, revision)) {
            store.setState({ error: '' })
            return
          }
          store.setState({ loading: true, error: '' })
          const results = await Promise.allSettled([
            dependencies.getStorages(forceRequested || dirty || !sameRevision(previous.revision, revision), active.signal),
            dependencies.getGroups(active.signal),
            dependencies.getIgnored(active.signal),
          ])
          if (!current()) return
          const after = await dependencies.getRevision(active.signal)
          if (!current()) return
          if (!validRevision(after)) throw new Error('存储缓存版本响应无效')
          // 读取期间任务可能完成或连接可能切换，过期结果不应写进新版本快照。
          if (!sameRevision(revision, after)) {
            dirty = true
            if (revision.source_id !== after.source_id) {
              persist(null)
              store.setState({ ...initialState(), userId: previous.userId })
            }
            continue
          }
          const patch: Partial<StorageData> = {}
          if (results[0].status === 'fulfilled') patch.storages = results[0].value
          if (results[1].status === 'fulfilled') patch.groups = results[1].value
          if (results[2].status === 'fulfilled') patch.ignored = results[2].value
          const data = { ...store.getState(), ...patch }
          if (!validData(data)) throw new Error('存储信息响应格式无效')
          store.setState(patch)
          const failed = results.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
          const snapshot = {
            storages: data.storages, groups: data.groups, ignored: data.ignored, revision, updatedAt: Date.now(),
          }
          store.setState({ ...snapshot, initialized: true, error: '' })
          dirty = false
          persist(snapshot)
          return
        }
        if (current()) store.setState({ error: '存储信息正在变化，稍后自动重新刷新' })
      } catch (error) {
        if (current()) store.setState({ error: error instanceof Error ? error.message : '存储信息刷新失败' })
      } finally {
        if (current()) { pending = null; forceRequested = false; store.setState({ loading: false }) }
      }
    }
    pending = Promise.resolve().then(load)
    return pending
  }

  function clear() {
    initialize(null)
    try { clearStorageSnapshots(storage()) } catch { /* 可用内存缓存仍已清理。 */ }
  }

  return { store, initialize, refresh, invalidate, clear }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { createStorageCache } from '../src/lib/storageCache.ts'

class MemoryStorage {
  values = new Map()
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}

function setup() {
  const storage = new MemoryStorage()
  const state = {
    revision: { source_id: 'source-a', revision: 0 },
    data: {
      storages: [{
        id: 1, mount_path: '/drive', driver: 'Test', status: 'work', ignored: false,
        total_space: 1000, used_space: 100, free_space: 900, space_source: 'openlist', space_error: null,
      }],
      groups: [{
        id: 1, name: '媒体库', created_at: '2026-09-13T00:00:00Z', storage_paths: ['/drive/Media'],
        paths: [{ id: 1, storage_mount: '/drive', folder_path: '/Media', priority: 10 }],
        members: [{
          id: 1, storage_id: 1, storage_mount: '/drive', download_path: '/drive/Media', archive_paths: [], priority: 10,
        }],
      }],
      ignored: [],
    },
    reads: [],
    load: null,
  }
  const dependencies = {
    storage: () => storage,
    getRevision: async () => structuredClone(state.revision),
    getStorages: async (refresh, signal) => {
      state.reads.push({ refresh, signal })
      return state.load ? state.load() : structuredClone(state.data.storages)
    },
    getGroups: async () => structuredClone(state.data.groups),
    getIgnored: async () => structuredClone(state.data.ignored),
  }
  const cache = createStorageCache(dependencies)
  cache.initialize(1)
  return { cache, storage, state, dependencies }
}

test('页面切换与浏览器刷新复用快照，版本未变时只核对版本', async () => {
  const { cache, state, dependencies } = setup()
  await cache.refresh()
  assert.equal(state.reads.length, 1)
  await Promise.all([cache.refresh(), cache.refresh()])
  assert.equal(state.reads.length, 1)
  const reloaded = createStorageCache(dependencies)
  reloaded.initialize(1)
  assert.equal(reloaded.store.getState().initialized, true)
  assert.equal(reloaded.store.getState().storages[0].free_space, 900)
  await reloaded.refresh()
  assert.equal(state.reads.length, 1)
})

test('同一批并发刷新合并，手动刷新能升级正在执行的版本检查', async () => {
  const { cache, state } = setup()
  await cache.refresh()
  const checking = cache.refresh()
  const manual = cache.refresh(true)
  assert.equal(checking, manual)
  await manual
  assert.equal(state.reads.length, 2)
  assert.equal(state.reads[1].refresh, true)
})

test('任务终态版本变化刷新一次，反复读取同一终态不会重复拉取容量', async () => {
  const { cache, state } = setup()
  await cache.refresh()
  state.revision.revision += 1
  state.data.storages[0].free_space = 300
  await cache.refresh()
  await cache.refresh()
  assert.equal(state.reads.length, 2)
  assert.equal(cache.store.getState().storages[0].free_space, 300)
})

test('刷新失败保留成功数据和时间，后续成功后更新版本', async () => {
  const { cache, state } = setup()
  await cache.refresh()
  const updatedAt = cache.store.getState().updatedAt
  state.revision.revision += 1
  state.load = () => { throw new Error('容量查询失败') }
  await cache.refresh()
  assert.equal(cache.store.getState().storages[0].free_space, 900)
  assert.equal(cache.store.getState().updatedAt, updatedAt)
  assert.equal(cache.store.getState().revision.revision, 0)
  assert.match(cache.store.getState().error, /容量查询失败/)
  state.load = null
  await cache.refresh()
  assert.equal(cache.store.getState().error, '')
  assert.equal(cache.store.getState().revision.revision, 1)
})

test('配置变更中止旧读取，忽略取消的迟到响应也不能覆盖新结果', async () => {
  const { cache, state } = setup()
  await cache.refresh()
  let release
  let entered
  const ready = new Promise((resolve) => { entered = resolve })
  state.load = () => new Promise((resolve) => { release = resolve; entered() })
  const old = cache.refresh(true)
  await ready
  const oldSignal = state.reads.at(-1).signal
  cache.invalidate()
  assert.equal(oldSignal.aborted, true)
  state.revision.revision += 1
  state.data.storages[0].free_space = 100
  state.load = null
  await cache.refresh()
  release([{ ...state.data.storages[0], free_space: 800 }])
  await old
  assert.equal(cache.store.getState().storages[0].free_space, 100)
})

test('读取期间版本变化会重新读取，不能给旧数据盖上新版本', async () => {
  const { cache, state } = setup()
  let first = true
  state.load = () => {
    if (first) {
      first = false
      state.revision.revision += 1
      state.data.storages[0].free_space = 200
      return [{ ...state.data.storages[0], free_space: 900 }]
    }
    return structuredClone(state.data.storages)
  }
  await cache.refresh()
  assert.equal(state.reads.length, 2)
  assert.equal(cache.store.getState().storages[0].free_space, 200)
  assert.equal(cache.store.getState().revision.revision, 1)
})

test('切换数据源后不会显示旧源数据，账号和注销也会隔离缓存', async () => {
  const { cache, state, storage, dependencies } = setup()
  await cache.refresh()
  state.revision = { source_id: 'source-b', revision: 0 }
  state.load = () => { throw new Error('新连接不可用') }
  await cache.refresh()
  assert.deepEqual(cache.store.getState().storages, [])
  const secondUser = createStorageCache(dependencies)
  secondUser.initialize(2)
  assert.equal(secondUser.store.getState().initialized, false)
  storage.setItem('unrelated-setting', 'keep')
  cache.clear()
  assert.equal(cache.store.getState().userId, null)
  assert.equal(storage.getItem('kuroko_storage_snapshot_v1:1'), null)
  assert.equal(storage.getItem('unrelated-setting'), 'keep')
})

test('损坏缓存与浏览器存储禁用时仍能正常加载，缓存不能覆盖账号标识', async () => {
  const { cache, storage, dependencies } = setup()
  await cache.refresh()
  const key = 'kuroko_storage_snapshot_v1:1'
  const snapshot = JSON.parse(storage.getItem(key))
  storage.setItem(key, JSON.stringify({ ...snapshot, userId: 999 }))
  const restored = createStorageCache(dependencies)
  restored.initialize(1)
  assert.equal(restored.store.getState().userId, 1)
  storage.setItem(key, JSON.stringify({ ...snapshot, groups: [{ id: 1 }] }))
  const damaged = createStorageCache(dependencies)
  damaged.initialize(1)
  assert.equal(damaged.store.getState().initialized, false)
  await damaged.refresh()
  assert.equal(damaged.store.getState().initialized, true)
  const privateMode = createStorageCache({ ...dependencies, storage: () => { throw new Error('disabled') } })
  privateMode.initialize(1)
  await privateMode.refresh()
  assert.equal(privateMode.store.getState().initialized, true)
})

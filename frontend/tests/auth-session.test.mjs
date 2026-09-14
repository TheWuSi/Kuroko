import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthExpiredError, SessionChangedError, SESSION_KEY, createAuthSession, loginReturnPath } from '../src/lib/authSession.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}
const time = Date.parse('2026-09-14T00:00:00Z')
const tokens = (token = 'old-access', expiry = time - 1) => ({
  token, token_type: 'Bearer', expires_at: new Date(expiry).toISOString(),
  refresh_token: 'refresh-credential', refresh_expires_at: new Date(time + 7 * 86400000).toISOString(),
})
const renewed = () => ({ token: 'new-access', token_type: 'Bearer', expires_at: new Date(time + 1800000).toISOString() })

test('60 个并发请求只刷新一次，保留 refresh token，迟到的 401 不再刷新', async () => {
  const storage = new MemoryStorage()
  let release
  let calls = 0
  const session = createAuthSession({ storage: () => storage, now: () => time, refresh: async (credential) => {
    assert.equal(credential, 'refresh-credential')
    calls += 1
    return new Promise((resolve) => { release = resolve })
  } })
  session.replace(tokens())
  const requests = Array.from({ length: 60 }, () => session.access())
  await Promise.resolve()
  assert.equal(calls, 1)
  release(renewed())
  assert.deepEqual(await Promise.all(requests), Array(60).fill('new-access'))
  assert.equal(await session.access({ rejectedToken: 'old-access' }), 'new-access')
  assert.equal(calls, 1)
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).tokens.refresh_token, 'refresh-credential')
  const reloaded = createAuthSession({ storage: () => storage, now: () => time, refresh: async () => { throw new Error('不应刷新') } })
  assert.equal(await reloaded.access(), 'new-access')
})

test('取消一个请求不取消共享续期，也不会重发已取消的请求', async () => {
  let release
  const session = createAuthSession({ now: () => time, refresh: () => new Promise((resolve) => { release = resolve }) })
  session.replace(tokens())
  const controller = new AbortController()
  const cancelled = session.access({ signal: controller.signal })
  const remaining = session.access()
  await Promise.resolve()
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  release(renewed())
  assert.equal(await remaining, 'new-access')
})

test('断网和 5xx 保留凭证并退避，明确 401 才清会话，草稿保留', async () => {
  const storage = new MemoryStorage()
  storage.setItem('kuroko_magnet_draft_v1:1', '保留草稿')
  let current = time
  let status = 503
  let calls = 0
  const session = createAuthSession({ storage: () => storage, now: () => current, refresh: async () => {
    calls += 1
    throw Object.assign(new Error('暂时不可用'), { response: { status } })
  } })
  session.replace(tokens())
  await assert.rejects(session.access())
  await assert.rejects(session.access())
  assert.equal(calls, 1)
  assert.equal(session.getToken(), 'old-access')
  assert.ok(storage.getItem(SESSION_KEY))
  current += 6000
  status = 401
  await assert.rejects(session.access(), AuthExpiredError)
  assert.equal(session.getToken(), null)
  assert.equal(storage.getItem(SESSION_KEY), null)
  assert.equal(storage.getItem('kuroko_magnet_draft_v1:1'), '保留草稿')
})

test('退出或换账号后，迟到的续期不能复活旧会话', async () => {
  let release
  const session = createAuthSession({ now: () => time, refresh: () => new Promise((resolve) => { release = resolve }) })
  session.replace(tokens())
  const pending = session.access()
  await Promise.resolve()
  session.clear()
  session.replace(tokens('account-two', time + 3600000))
  release(renewed())
  await assert.rejects(pending, SessionChangedError)
  assert.equal(session.getToken(), 'account-two')
})

test('浏览器标签页同步令牌与登出，旧请求不能注销更新后的令牌', async () => {
  const storage = new MemoryStorage()
  const deps = { storage: () => storage, now: () => time, refresh: async () => renewed() }
  const first = createAuthSession(deps)
  first.replace(tokens())
  const second = createAuthSession(deps)
  const epoch = second.getEpoch()
  await first.access()
  second.sync()
  second.clear(epoch, 'old-access')
  assert.equal(second.getToken(), 'new-access')
  first.clear()
  second.sync()
  assert.equal(second.getToken(), null)
})

test('兼容旧版 access token，无法续期时要求重登且保留其他缓存', async () => {
  const storage = new MemoryStorage()
  const legacy = `header.${btoa(JSON.stringify({ exp: time / 1000 - 1 }))}.signature`
  storage.setItem('kuroko_token', legacy)
  const session = createAuthSession({ storage: () => storage, now: () => time, refresh: async () => { throw new Error('没有刷新凭证') } })
  assert.equal(await session.access(), legacy)
  await assert.rejects(session.access({ rejectedToken: legacy }), AuthExpiredError)
  assert.equal(storage.getItem('kuroko_token'), null)
})

test('损坏会话不崩溃，登录回跳仅接受站内路径', () => {
  const storage = new MemoryStorage()
  storage.setItem(SESSION_KEY, '{bad-json')
  assert.equal(createAuthSession({ storage: () => storage, refresh: async () => renewed() }).getToken(), null)
  assert.equal(loginReturnPath('/magnets?batch=1'), '/magnets?batch=1')
  for (const path of ['https://example.invalid', '//example.invalid', '/\\example.invalid', '/login', '/\n/invalid', null]) {
    assert.equal(loginReturnPath(path), '/dashboard')
  }
})

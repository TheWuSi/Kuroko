import type { LoginResponse, TokenData } from '@/types/api'

export const SESSION_KEY = 'kuroko_session_v1'
const LEGACY_KEY = 'kuroko_token'
type Tokens = TokenData & Partial<Pick<LoginResponse, 'refresh_token' | 'refresh_expires_at'>>
type SavedSession = { version: 1; sessionId: string; tokens: Tokens }
type Dependencies = {
  refresh: (token: string) => Promise<TokenData>
  storage?: () => Storage | undefined
  now?: () => number
}

export function newRequestId(): string {
  // 局域网 HTTP 页面也需要请求编号；randomUUID 只在安全上下文提供。
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class AuthExpiredError extends Error {
  readonly status = 401
  constructor() { super('登录已过期，请重新登录；草稿和后台任务已保留') }
}

export class SessionChangedError extends Error {
  constructor() { super('会话已变化，已忽略旧请求') }
}

function storageAvailable(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

const tokenString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 16384 && /^[A-Za-z0-9._~+/=-]+$/.test(value)
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length < 64 && Number.isFinite(Date.parse(value))
function validTokens(value: unknown): value is Tokens {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return tokenString(data.token) && data.token_type === 'Bearer' && validDate(data.expires_at) &&
    (data.refresh_token === undefined || (tokenString(data.refresh_token) && validDate(data.refresh_expires_at)))
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('请求已取消', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function createAuthSession(dependencies: Dependencies) {
  const storage = dependencies.storage ?? storageAvailable
  const clock = dependencies.now ?? Date.now
  let saved: SavedSession | null = null
  let epoch = 0
  let pending: Promise<string> | null = null
  let retryAt = 0
  let transientError: unknown = null
  const listeners = new Set<(tokens: Tokens | null, changed: boolean) => void>()

  function read(): SavedSession | null {
    try {
      const raw = storage()?.getItem(SESSION_KEY)
      if (raw && raw.length < 40000) {
        const value = JSON.parse(raw) as SavedSession
        if (value.version === 1 && typeof value.sessionId === 'string' && value.sessionId.length <= 100 && validTokens(value.tokens)) return value
      }
      const legacy = storage()?.getItem(LEGACY_KEY)
      if (legacy && tokenString(legacy)) {
        let expiry = 0
        try {
          const value = JSON.parse(atob(legacy.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
          if (typeof value.exp === 'number' && Number.isFinite(value.exp) && value.exp > 0 && value.exp < 1e12) expiry = value.exp * 1000
        } catch { /* 旧令牌是否有效仍由服务端判定。 */ }
        return { version: 1, sessionId: 'legacy', tokens: { token: legacy, token_type: 'Bearer', expires_at: new Date(expiry).toISOString() } }
      }
    } catch { /* 禁用本机存储时仍允许当前页面登录。 */ }
    return null
  }

  saved = read()
  function notify(changed: boolean) { listeners.forEach((listener) => listener(saved?.tokens ?? null, changed)) }
  function persist() {
    try {
      if (saved) storage()?.setItem(SESSION_KEY, JSON.stringify(saved))
      else storage()?.removeItem(SESSION_KEY)
      storage()?.removeItem(LEGACY_KEY)
    } catch { /* 已建立的内存会话仍可继续使用。 */ }
  }

  function replace(tokens: Tokens, expectedEpoch = epoch) {
    if (epoch !== expectedEpoch) throw new SessionChangedError()
    if (!validTokens(tokens)) throw new Error('登录响应格式无效')
    epoch += 1
    pending = null
    retryAt = 0
    saved = { version: 1, sessionId: newRequestId(), tokens: { ...tokens } }
    persist()
    notify(true)
  }

  function clear(expectedEpoch = epoch, rejectedToken?: string) {
    if (epoch !== expectedEpoch || (rejectedToken && saved?.tokens.token !== rejectedToken)) return
    epoch += 1
    saved = null
    pending = null
    retryAt = 0
    persist()
    notify(true)
  }

  async function access(options: { rejectedToken?: string; signal?: AbortSignal } = {}): Promise<string | null> {
    if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    const current = saved
    if (!current) return null
    const tokens = current.tokens
    // 迟到的 401 使用已经刷新的令牌，不再重复续期。
    if (options.rejectedToken && options.rejectedToken !== tokens.token) return tokens.token
    if (!options.rejectedToken && Date.parse(tokens.expires_at) - clock() > 60000) return tokens.token
    if (!tokens.refresh_token) {
      if (options.rejectedToken) { clear(epoch, tokens.token); throw new AuthExpiredError() }
      return tokens.token
    }
    const ticket = epoch
    if (!pending) {
      if (clock() < retryAt) throw transientError
      const refreshing = Promise.resolve().then(async () => {
        try {
          const renewed = await dependencies.refresh(tokens.refresh_token!)
          if (ticket !== epoch || saved?.sessionId !== current.sessionId) throw new SessionChangedError()
          if (!validTokens(renewed)) throw new Error('续期响应格式无效，请稍后重试')
          // 刷新接口只返回 access token，保留登录时收到的 refresh token。
          saved = { ...current, tokens: { ...tokens, ...renewed } }
          persist()
          retryAt = 0
          notify(false)
          return renewed.token
        } catch (error) {
          if (ticket !== epoch) throw new SessionChangedError()
          const status = (error as { status?: number; response?: { status?: number } })?.status ??
            (error as { response?: { status?: number } })?.response?.status
          if (status === 401) { clear(ticket); throw new AuthExpiredError() }
          retryAt = clock() + 5000
          transientError = error
          throw error
        }
      })
      pending = refreshing
      void refreshing.finally(() => { if (pending === refreshing) pending = null }).catch(() => {})
    }
    const token = await waitFor(pending, options.signal)
    if (ticket !== epoch) throw new SessionChangedError()
    return token
  }

  function sync() {
    const latest = read()
    if (JSON.stringify(latest) === JSON.stringify(saved)) return
    const changed = latest?.sessionId !== saved?.sessionId
    if (changed) { epoch += 1; pending = null; retryAt = 0 }
    saved = latest
    notify(changed)
  }

  return {
    access, replace, clear, sync,
    getToken: () => saved?.tokens.token ?? null,
    getEpoch: () => epoch,
    subscribe(listener: (tokens: Tokens | null, changed: boolean) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export function loginReturnPath(value: unknown): string {
  return typeof value === 'string' && value.length <= 4096 && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && value.startsWith('/') && !value.startsWith('//') &&
    !value.includes('\\') && !/^\/(login|bootstrap)([/?#]|$)/.test(value) ? value : '/dashboard'
}

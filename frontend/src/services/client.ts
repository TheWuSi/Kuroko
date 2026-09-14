import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse, TokenData, LoginResponse } from '@/types/api'
import { clearStorageSnapshots } from '@/lib/storageCache'
import { createAuthSession, SESSION_KEY, SessionChangedError } from '@/lib/authSession'

export class ApiRequestError extends Error {
  readonly status?: number
  readonly code?: number
  constructor(message: string, status?: number, code?: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

const options = { baseURL: '/api/v1', timeout: 45000, headers: { 'Content-Type': 'application/json' } }
const refreshClient = axios.create(options)
export const authSession = createAuthSession({
  refresh: async (token) => {
    const response = await refreshClient.post<ApiResponse<TokenData>>('/auth/refresh', undefined, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.data.data
  },
})

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === SESSION_KEY || event.key === 'kuroko_token') authSession.sync()
  })
  window.addEventListener('focus', () => { void authSession.access().catch(() => {}) })
}

type AuthConfig = InternalAxiosRequestConfig & { authEpoch?: number; authToken?: string; authRetried?: boolean }
const isPublic = (url = '') => /^\/auth\/(login|bootstrap|bootstrap-status|refresh)$/.test(url) || url === '/health'

export const apiClient = axios.create(options)
apiClient.interceptors.request.use(async (config: AuthConfig) => {
  if (isPublic(config.url)) return config
  config.authEpoch ??= authSession.getEpoch()
  if (config.authEpoch !== authSession.getEpoch()) throw new SessionChangedError()
  const token = await authSession.access({ signal: config.signal as AbortSignal | undefined })
  if (config.authEpoch !== authSession.getEpoch()) throw new SessionChangedError()
  if (config.signal?.aborted) throw new axios.CanceledError()
  if (token) config.headers.Authorization = `Bearer ${token}`
  else delete config.headers.Authorization
  config.authToken = token ?? undefined
  return config
})

apiClient.interceptors.response.use(
  (response) => {
    const config = response.config as AuthConfig
    if (config.authEpoch !== undefined && config.authEpoch !== authSession.getEpoch()) throw new SessionChangedError()
    const body = response.data as ApiResponse<unknown>
    if (body && typeof body === 'object' && 'code' in body && body.code !== 0 && body.code !== 200) {
      throw new ApiRequestError(body.message || `请求失败 (${body.code})`, response.status, body.code)
    }
    return response
  },
  async (error: AxiosError<ApiResponse<unknown>> | Error) => {
    if (axios.isCancel(error) || error.name === 'AbortError' || error instanceof SessionChangedError) throw error
    const failure = error as AxiosError<ApiResponse<unknown>>
    const config = failure.config as AuthConfig | undefined
    if (config?.authEpoch !== undefined && config.authEpoch !== authSession.getEpoch()) throw new SessionChangedError()
    if (failure.response?.status === 401 && config && !isPublic(config.url)) {
      if (config.signal?.aborted) throw new axios.CanceledError()
      if (!config.authRetried && config.authToken) {
        const token = await authSession.access({ rejectedToken: config.authToken, signal: config.signal as AbortSignal | undefined })
        if (token && config.authEpoch === authSession.getEpoch()) {
          config.authRetried = true
          config.headers.Authorization = `Bearer ${token}`
          return apiClient.request(config)
        }
      } else authSession.clear(config.authEpoch, config.authToken)
    }
    const data = failure.response?.data as unknown as
      { message?: string; detail?: string | Array<{ msg?: string }> } | undefined
    const message = data?.message || (typeof data?.detail === 'string' ? data.detail :
      Array.isArray(data?.detail) ? '输入参数校验失败' : error.message || '网络请求异常，请稍后重试')
    throw new ApiRequestError(message, failure.response?.status, failure.response?.data?.code)
  },
)

export const getStoredToken = () => authSession.getToken()
export function setStoredTokens(tokens: LoginResponse | TokenData, epoch?: number) { authSession.replace(tokens, epoch) }
export function removeStoredToken() { authSession.clear(); clearStorageSnapshots() }

import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from '@/types/api'
import { clearStorageSnapshots } from '@/lib/storageCache'

const TOKEN_KEY = 'kuroko_token'

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：注入 JWT
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器：解包与统一 401 异常治理
apiClient.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<unknown>
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0 && body.code !== 200) {
        return Promise.reject(new ApiRequestError(body.message || `请求失败 (${body.code})`, response.status, body.code))
      }
      return response
    }
    return response
  },
  (error: AxiosError<ApiResponse<unknown>>) => {
    if (axios.isCancel(error)) return Promise.reject(error)
    if (error.response?.status === 401) {
      removeStoredToken()
      // 非登录页且非初始化页时自动跳转回登录页
      if (window.location.pathname !== '/login' && window.location.pathname !== '/bootstrap') {
        window.location.href = '/login'
      }
    }

    const data = error.response?.data as unknown as
      | { message?: string; detail?: string | Array<{ msg?: string; loc?: string[] }> }
      | undefined

    let message = '网络请求异常，请稍后重试'
    if (data?.message) {
      message = data.message
    } else if (typeof data?.detail === 'string') {
      message = data.detail
    } else if (Array.isArray(data?.detail) && data.detail.length > 0) {
      const first = data.detail[0]
      message = first?.msg ? `输入验证失败: ${first.msg}` : '输入参数校验失败'
    } else if (error.message) {
      message = error.message
    }

    return Promise.reject(new ApiRequestError(message, error.response?.status, error.response?.data?.code))
  }
)

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  clearStorageSnapshots()
}

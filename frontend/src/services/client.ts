import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiResponse } from '@/types/api'

const TOKEN_KEY = 'kuroko_token'

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
        return Promise.reject(new Error(body.message || `请求失败 (${body.code})`))
      }
      return response
    }
    return response
  },
  (error: AxiosError<ApiResponse<unknown>>) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      // 非登录页时跳转
      if (window.location.pathname !== '/login' && window.location.pathname !== '/bootstrap') {
        window.location.href = '/login'
      }
    }
    const message =
      error.response?.data?.message ||
      error.message ||
      '网络请求异常，请稍后重试'
    return Promise.reject(new Error(message))
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
}

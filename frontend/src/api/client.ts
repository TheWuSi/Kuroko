import axios, { AxiosError } from 'axios'
import type { ApiResult } from '../types/api'

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('kuroko_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResult<null>>) => {
    if (error.response?.status === 401) localStorage.removeItem('kuroko_token')
    const message = error.response?.data?.message || error.message || '请求失败'
    return Promise.reject(new Error(message))
  },
)

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.headers)
    new Headers(options.headers).forEach((value, key) => {
      headers[key] = value
    })
  const response = await apiClient.request<ApiResult<T>>({
    url: path,
    method: options.method || 'GET',
    data: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
    headers,
  })
  if (response.data.code !== 0) throw new Error(response.data.message || '请求失败')
  return response.data.data
}

export async function apiWithToken<T>(path: string, token: string): Promise<T> {
  const response = await apiClient.get<ApiResult<T>>(path, { headers: { Authorization: `Bearer ${token}` } })
  if (response.data.code !== 0) throw new Error(response.data.message || '请求失败')
  return response.data.data
}

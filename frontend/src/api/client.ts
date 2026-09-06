import type { ApiResult } from '../types/api'

const API_PREFIX = '/api/v1'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('kuroko_token')
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const body = (await response.json()) as ApiResult<T>
  if (response.status === 401) localStorage.removeItem('kuroko_token')
  if (!response.ok || body.code !== 0) throw new Error(body.message || '请求失败')
  return body.data
}

export async function apiWithToken<T>(path: string, token: string): Promise<T> {
  return api<T>(path, { headers: { Authorization: `Bearer ${token}` } })
}

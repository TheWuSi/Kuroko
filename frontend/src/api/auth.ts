import { api, apiWithToken } from './client'
import type { User } from '../types/api'

export type AuthResponse = { token: string; refresh_token?: string; token_type?: string }

export const getBootstrapStatus = () => api<{ initialized: boolean }>('/auth/bootstrap-status')
export const login = (username: string, password: string) => api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
export const bootstrap = (username: string, password: string) => api<AuthResponse>('/auth/bootstrap', { method: 'POST', body: JSON.stringify({ username, password }) })
export const getCurrentUser = (token?: string) => token ? apiWithToken<User>('/auth/me', token) : api<User>('/auth/me')

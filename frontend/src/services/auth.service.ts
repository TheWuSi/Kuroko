import { apiClient, setStoredToken, removeStoredToken } from './client'
import type { ApiResponse, LoginResponse, SystemStatus, User } from '@/types/api'

export const authService = {
  // 检查系统初始状态（是否已初始化/已认证）
  async getStatus(): Promise<SystemStatus> {
    const res = await apiClient.get<ApiResponse<SystemStatus>>('/auth/status')
    return res.data.data
  },

  // 用户登录
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', {
      username,
      password,
    })
    const data = res.data.data
    if (data.token) {
      setStoredToken(data.token)
    }
    return data
  },

  // 系统初始化（首次创建管理员）
  async bootstrap(username: string, password: string): Promise<LoginResponse> {
    const res = await apiClient.post<ApiResponse<LoginResponse>>('/auth/bootstrap', {
      username,
      password,
    })
    const data = res.data.data
    if (data.token) {
      setStoredToken(data.token)
    }
    return data
  },

  // 获取当前登录用户
  async getCurrentUser(): Promise<User> {
    const res = await apiClient.get<ApiResponse<User>>('/auth/me')
    return res.data.data
  },

  // 登出
  logout(): void {
    removeStoredToken()
  },
}

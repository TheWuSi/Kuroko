import { apiClient, setStoredToken, removeStoredToken } from './client'
import type { ApiResponse, BootstrapStatus, LoginResponse, TokenData, User } from '@/types/api'

export const authService = {
  // 检查系统是否已初始化（创建首个管理员）
  async getBootstrapStatus(): Promise<BootstrapStatus> {
    const res = await apiClient.get<ApiResponse<BootstrapStatus>>('/auth/bootstrap-status')
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

  // 系统初始化（首次创建管理员账号）
  async bootstrap(username: string, password: string): Promise<TokenData> {
    const res = await apiClient.post<ApiResponse<TokenData>>('/auth/bootstrap', {
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


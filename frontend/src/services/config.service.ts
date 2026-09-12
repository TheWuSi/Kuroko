import { apiClient } from './client'
import type { ApiResponse, SystemConfigData, ConnectionTestResult, BtParserConfig } from '@/types/api'

export const configService = {
  // 获取所有可编辑配置
  async getConfig(): Promise<SystemConfigData> {
    const res = await apiClient.get<ApiResponse<SystemConfigData>>('/config')
    return res.data.data
  },

  // 局部更新配置
  async updateConfig(partialConfig: Partial<SystemConfigData>): Promise<SystemConfigData> {
    const res = await apiClient.put<ApiResponse<SystemConfigData>>('/config', partialConfig)
    return res.data.data
  },

  // 测试 OpenList 连通性
  async testOpenList(params?: {
    base_url?: string
    auth_type?: string
    username?: string
    password?: string
    token?: string
  }): Promise<ConnectionTestResult> {
    const res = await apiClient.post<ApiResponse<ConnectionTestResult>>(
      '/config/test-connection',
      params || {}
    )
    return res.data.data
  },

  // 测试 magnet-metadata-api 连通性
  async testBtParser(params?: Partial<BtParserConfig>): Promise<ConnectionTestResult> {
    const res = await apiClient.post<ApiResponse<ConnectionTestResult>>(
      '/config/test-bt-parser',
      params || {}
    )
    return res.data.data
  },
}

import { apiClient } from './client'
import type { ApiResponse, CodeListResponse, ScanJobStatus } from '@/types/api'

export const codeService = {
  // 获取已发现番号记录 (支持分页、模糊搜索、分组筛选)
  async getCodes(params?: {
    group_id?: number
    search?: string
    page?: number
    page_size?: number
  }, signal?: AbortSignal): Promise<CodeListResponse> {
    const res = await apiClient.get<ApiResponse<CodeListResponse>>('/codes', {
      params,
      signal,
    })
    return res.data.data
  },

  // 触发定向探测路径扫描
  async startScan(groupId?: number): Promise<{ task_id: string; status: string; group_id: number | null }> {
    const res = await apiClient.post<ApiResponse<{ task_id: string; status: string; group_id: number | null }>>(
      '/codes/scan',
      { group_id: groupId || null }
    )
    return res.data.data
  },

  // 获取扫描任务最新状态
  async getScanStatus(taskId?: string, signal?: AbortSignal): Promise<ScanJobStatus> {
    const res = await apiClient.get<ApiResponse<ScanJobStatus>>('/codes/scan/status', {
      params: taskId ? { task_id: taskId } : undefined,
      signal,
    })
    return res.data.data
  },

  // 删除番号记录
  async deleteCode(code: string): Promise<void> {
    await apiClient.delete(`/codes/${code}`)
  },
}

import { apiClient } from './client'
import type { ApiResponse, CodeListResponse, ScanJobStatus, DuplicateGroup, DuplicateAllowance, CodeVariant } from '@/types/api'

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

  async cancelScan(taskId: string): Promise<ScanJobStatus> {
    const res = await apiClient.post<ApiResponse<ScanJobStatus>>(`/codes/scan/${encodeURIComponent(taskId)}/cancel`)
    return res.data.data
  },

  async getScanPaths(groupId?: number, signal?: AbortSignal): Promise<string[]> {
    const res = await apiClient.get<ApiResponse<{ paths: string[] }>>('/codes/scan/paths', {
      params: { group_id: groupId }, signal,
    })
    return res.data.data.paths
  },

  async getDuplicates(groupId?: number, page = 1, signal?: AbortSignal): Promise<{ total: number; items: DuplicateGroup[] }> {
    const res = await apiClient.get<ApiResponse<{ total: number; items: DuplicateGroup[] }>>('/codes/duplicates', {
      params: { group_id: groupId, page }, signal,
    })
    return res.data.data
  },

  async getDuplicateIgnores(groupId?: number, signal?: AbortSignal): Promise<DuplicateAllowance[]> {
    const res = await apiClient.get<ApiResponse<{ items: DuplicateAllowance[] }>>('/codes/duplicate-ignores', {
      params: { group_id: groupId }, signal,
    })
    return res.data.data.items
  },

  async allowDuplicate(groupId: number, code: string, variants: CodeVariant[]): Promise<void> {
    await apiClient.put('/codes/duplicate-ignores', { group_id: groupId, code, variants })
  },

  async revokeDuplicate(ruleId: number): Promise<void> {
    await apiClient.delete(`/codes/duplicate-ignores/${ruleId}`)
  },

  // 删除番号记录
  async deleteCode(code: string, groupId?: number): Promise<void> {
    await apiClient.delete(`/codes/${encodeURIComponent(code)}`, { params: { group_id: groupId } })
  },
}

import { apiClient } from './client'
import type { ApiResponse, DownloadTask, TaskListResponse, TransferTask } from '@/types/api'

export const taskService = {
  // 获取下载任务列表 (支持分页与状态过滤)
  async getTasks(params?: {
    status?: string
    page?: number
    page_size?: number
  }, signal?: AbortSignal): Promise<TaskListResponse> {
    const res = await apiClient.get<ApiResponse<TaskListResponse>>('/tasks', {
      params,
      signal,
    })
    return res.data.data
  },

  // 获取单个任务详情
  async getTask(taskId: string): Promise<DownloadTask> {
    const res = await apiClient.get<ApiResponse<DownloadTask>>(`/tasks/${encodeURIComponent(taskId)}`)
    return res.data.data
  },

  // 发送取消请求，终态以 OpenList 后续同步为准。
  async cancelTask(taskId: string): Promise<void> {
    await apiClient.delete(`/tasks/${encodeURIComponent(taskId)}`)
  },

  async getTransfers(signal?: AbortSignal): Promise<TransferTask[]> {
    const res = await apiClient.get<ApiResponse<{ items: TransferTask[] }>>('/tasks/transfers', { signal })
    return res.data.data.items
  },

  async cancelTransfer(taskId: string): Promise<void> {
    await apiClient.delete(`/tasks/transfers/${encodeURIComponent(taskId)}`)
  },

  // 主动触发同步 OpenList 离线进度
  async syncTasks(): Promise<{ synced_count: number; completed_count: number }> {
    const res = await apiClient.post<ApiResponse<{ synced_count: number; completed_count: number }>>('/tasks/sync')
    return res.data.data
  },
}

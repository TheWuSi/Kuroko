import { apiClient } from './client'
import type {
  ApiResponse,
  MagnetParseResponse,
  DownloadTaskSubmitItem,
  BatchDownloadResponse,
} from '@/types/api'

export const magnetService = {
  // 解析磁力链接 (调用后端对接的 magnet-metadata-api)
  async parseMagnets(links: string[], signal?: AbortSignal): Promise<MagnetParseResponse> {
    const res = await apiClient.post<ApiResponse<MagnetParseResponse>>(
      '/magnets/parse',
      { magnet_links: links },
      { signal }
    )
    return res.data.data
  },

  // 批量提交离线下载 (支持 target_group 与 force: true 强制下载)
  async submitBatchDownload(
    tasks: DownloadTaskSubmitItem[]
  ): Promise<BatchDownloadResponse> {
    const res = await apiClient.post<ApiResponse<BatchDownloadResponse>>(
      '/magnets/batch-download',
      { tasks }
    )
    return res.data.data
  },
}

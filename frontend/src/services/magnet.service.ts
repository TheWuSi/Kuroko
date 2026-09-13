import { apiClient, ApiRequestError } from './client'
import type {
  ApiResponse,
  MagnetParseResponse,
  DownloadTaskSubmitItem,
  BatchDownloadResponse,
  MagnetParseItem,
  TargetScope,
  DuplicateDecision,
  CodeVariant,
} from '@/types/api'

// 后端解析超时最高 300 秒，为降级响应和网络传输留出余量。
const PARSE_TIMEOUT_MS = 320_000
const SUBMIT_TIMEOUT_MS = 600_000

export const magnetService = {
  // 解析磁力链接 (调用后端对接的 magnet-metadata-api)
  async parseMagnets(links: string[], signal?: AbortSignal, scope: TargetScope = {}): Promise<MagnetParseResponse> {
    const results: Array<MagnetParseItem | undefined> = Array.from({ length: links.length })
    const errors: NonNullable<MagnetParseResponse['errors']> = []
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < links.length) {
        signal?.throwIfAborted()
        const index = nextIndex++
        try {
          const res = await apiClient.post<ApiResponse<MagnetParseResponse>>(
            '/magnets/parse',
            { magnet_links: [links[index]], ...scope },
            { signal, timeout: PARSE_TIMEOUT_MS }
          )
          const item = res.data.data.results[0]
          if (!item) throw new Error('解析服务未返回结果')
          results[index] = item
        } catch (error) {
          signal?.throwIfAborted()
          errors.push({ index, magnet: links[index], message: error instanceof Error ? error.message : '解析失败' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, links.length) }, worker))
    return {
      results: results.filter((item): item is MagnetParseItem => item !== undefined),
      errors: errors.sort((a, b) => a.index - b.index),
    }
  },

  async checkDuplicates(
    items: Array<{ code: string; variant: CodeVariant; part_numbers: number[] | null }>, scope: TargetScope, signal?: AbortSignal,
  ): Promise<DuplicateDecision[]> {
    const res = await apiClient.post<ApiResponse<{ items: DuplicateDecision[] }>>('/magnets/check-duplicates', {
      items, ...scope,
    }, { signal })
    return res.data.data.items
  },

  // 按条提交避免整批等待超过请求超时；保留成功项，任何失败都不自动重试。
  async submitBatchDownload(
    tasks: DownloadTaskSubmitItem[]
  ): Promise<BatchDownloadResponse> {
    const combined: BatchDownloadResponse = { submitted: [], skipped: [], failed: [] }
    for (const [index, task] of tasks.entries()) {
      try {
        const res = await apiClient.post<ApiResponse<BatchDownloadResponse>>(
          '/magnets/batch-download',
          { tasks: [task] },
          { timeout: SUBMIT_TIMEOUT_MS }
        )
        const data = res.data.data
        if (!Array.isArray(data.submitted) || !Array.isArray(data.skipped) || !Array.isArray(data.failed) ||
          data.submitted.length + data.skipped.length + data.failed.length !== 1) {
          throw new Error('下载提交响应格式异常')
        }
        combined.submitted.push(...data.submitted.map((item) => ({ ...item, index })))
        combined.skipped.push(...data.skipped.map((item) => ({ ...item, index })))
        combined.failed.push(...data.failed.map((item) => ({ ...item, index })))
      } catch (error) {
        // 网络中断或服务端异常时无法证明上游没有创建任务，禁止提示直接重试。
        const rejected = error instanceof ApiRequestError && error.status !== undefined &&
          error.status >= 400 && error.status < 500 && error.status !== 408
        combined.failed.push({
          index, magnet: task.magnet, code: task.code,
          reason: rejected ? 'request_rejected' : 'submission_unknown',
          message: rejected && error instanceof Error ? error.message : '提交结果不确定，请先到任务页和 OpenList 核实，勿重复提交',
        })
      }
    }
    return combined
  },
}

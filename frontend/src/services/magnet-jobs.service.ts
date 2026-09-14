import { apiClient } from './client'
import type { ApiResponse, MagnetJob, MagnetJobSummary, MagnetParseItem, MagnetSubmission, MagnetSubmissionSummary, TargetScope } from '@/types/api'

type List<T> = { total: number; items: T[] }
type ListParams = { active?: boolean; page?: number; request_id?: string }

export const magnetJobsService = {
  async create(requestId: string, links: string[], scope: TargetScope): Promise<MagnetJob> {
    const response = await apiClient.post<ApiResponse<MagnetJob>>('/magnets/parse-jobs', { request_id: requestId, magnet_links: links, ...scope })
    return response.data.data
  },
  async list(params?: ListParams, signal?: AbortSignal): Promise<List<MagnetJobSummary>> {
    const response = await apiClient.get<ApiResponse<List<MagnetJobSummary>>>('/magnets/parse-jobs', { params, signal })
    return response.data.data
  },
  async get(jobId: string, signal?: AbortSignal): Promise<MagnetJob> {
    const response = await apiClient.get<ApiResponse<MagnetJob>>(`/magnets/parse-jobs/${encodeURIComponent(jobId)}`, { signal })
    return response.data.data
  },
  async item(jobId: string, index: number, signal?: AbortSignal): Promise<{ attempt: number; result: MagnetParseItem | null }> {
    const response = await apiClient.get<ApiResponse<{ attempt: number; result: MagnetParseItem | null }>>(`/magnets/parse-jobs/${encodeURIComponent(jobId)}/items/${index}`, { signal })
    return response.data.data
  },
  async cancel(jobId: string): Promise<MagnetJob> {
    const response = await apiClient.post<ApiResponse<MagnetJob>>(`/magnets/parse-jobs/${encodeURIComponent(jobId)}/cancel`)
    return response.data.data
  },
  async resume(jobId: string, indices?: number[]): Promise<MagnetJob> {
    const response = await apiClient.post<ApiResponse<MagnetJob>>(`/magnets/parse-jobs/${encodeURIComponent(jobId)}/resume`, { indices })
    return response.data.data
  },
  async submit(jobId: string, requestId: string, indices: number[], scope: TargetScope, force: boolean): Promise<MagnetSubmission> {
    const response = await apiClient.post<ApiResponse<MagnetSubmission>>(`/magnets/parse-jobs/${encodeURIComponent(jobId)}/submissions`, {
      request_id: requestId, item_indices: indices, force, ...scope,
    })
    return response.data.data
  },
  async submissions(params?: ListParams, signal?: AbortSignal): Promise<List<MagnetSubmissionSummary>> {
    const response = await apiClient.get<ApiResponse<List<MagnetSubmissionSummary>>>('/magnets/submissions', { params, signal })
    return response.data.data
  },
  async submission(submissionId: string, signal?: AbortSignal): Promise<MagnetSubmission> {
    const response = await apiClient.get<ApiResponse<MagnetSubmission>>(`/magnets/submissions/${encodeURIComponent(submissionId)}`, { signal })
    return response.data.data
  },
}

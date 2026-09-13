import { apiClient } from './client'
import type { ApiResponse, StorageNodeInfo, StorageGroup, StorageMemberInput, StorageIgnore, DirectoryListing, StorageRevision } from '@/types/api'

export const storageService = {
  async getRevision(signal?: AbortSignal): Promise<StorageRevision> {
    const res = await apiClient.get<ApiResponse<StorageRevision>>('/storages/revision', { signal })
    return res.data.data
  },
  // 获取所有存储节点信息 (包含 OpenList 原生容量与手动推算)
  async getStorages(params?: { refresh?: boolean; include_ignored?: boolean }, signal?: AbortSignal): Promise<StorageNodeInfo[]> {
    const res = await apiClient.get<ApiResponse<{ storages: StorageNodeInfo[] }>>('/storages', { params, signal })
    return res.data.data.storages
  },

  // 获取所有存储分组
  async getGroups(signal?: AbortSignal): Promise<StorageGroup[]> {
    const res = await apiClient.get<ApiResponse<{ groups: StorageGroup[] }>>('/storage-groups', { signal })
    return res.data.data.groups
  },

  // 创建存储分组
  async createGroup(name: string, members: StorageMemberInput[]): Promise<StorageGroup> {
    const res = await apiClient.post<ApiResponse<StorageGroup>>('/storage-groups', {
      name,
      members,
    })
    return res.data.data
  },

  // 更新存储分组
  async updateGroup(
    groupId: number,
    data: { name?: string; members?: StorageMemberInput[] }
  ): Promise<StorageGroup> {
    const res = await apiClient.put<ApiResponse<StorageGroup>>(`/storage-groups/${groupId}`, {
      name: data.name,
      members: data.members,
    })
    return res.data.data
  },

  // 删除存储分组
  async deleteGroup(groupId: number): Promise<void> {
    await apiClient.delete(`/storage-groups/${groupId}`)
  },

  async getIgnored(signal?: AbortSignal): Promise<StorageIgnore[]> {
    const res = await apiClient.get<ApiResponse<{ items: StorageIgnore[] }>>('/storages/ignored', { signal })
    return res.data.data.items
  },

  async setIgnored(storageId: number, ignored: boolean): Promise<void> {
    await apiClient.put(`/storages/${storageId}/ignore`, { ignored })
  },

  async getDirectories(storageId: number, path?: string, refresh = false, signal?: AbortSignal): Promise<DirectoryListing> {
    const res = await apiClient.get<ApiResponse<DirectoryListing>>(`/storages/${storageId}/directories`, {
      params: { path, refresh }, signal,
    })
    return res.data.data
  },

  // 手动覆盖存储节点总空间容量
  async overrideStorageSpace(storageId: number, totalSpaceBytes: number): Promise<StorageNodeInfo> {
    const response = await apiClient.put<ApiResponse<StorageNodeInfo>>(`/storages/${storageId}/space`, {
      total_space_bytes: totalSpaceBytes,
    })
    return response.data.data
  },

  async resetStorageSpace(storageId: number): Promise<StorageNodeInfo> {
    const response = await apiClient.delete<ApiResponse<StorageNodeInfo>>(`/storages/${storageId}/space`)
    return response.data.data
  },
}

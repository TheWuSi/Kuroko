import { apiClient } from './client'
import type { ApiResponse, StorageNodeInfo, StorageGroup } from '@/types/api'
import { joinStoragePath } from '@/lib/path'

export const storageService = {
  // 获取所有存储节点信息 (包含 OpenList 原生容量与手动推算)
  async getStorages(): Promise<StorageNodeInfo[]> {
    const res = await apiClient.get<ApiResponse<{ storages: StorageNodeInfo[] }>>('/storages')
    return res.data.data.storages
  },

  // 获取所有存储分组
  async getGroups(): Promise<StorageGroup[]> {
    const res = await apiClient.get<ApiResponse<{ groups: StorageGroup[] }>>('/storage-groups')
    return res.data.data.groups
  },

  // 创建存储分组
  async createGroup(name: string, paths: Array<{ storage_mount: string; folder_path: string }>): Promise<StorageGroup> {
    const res = await apiClient.post<ApiResponse<StorageGroup>>('/storage-groups', {
      name,
      storage_paths: paths.map((path) => joinStoragePath(path.storage_mount, path.folder_path)),
    })
    return res.data.data
  },

  // 更新存储分组
  async updateGroup(
    groupId: number,
    data: { name?: string; paths?: Array<{ storage_mount: string; folder_path: string }> }
  ): Promise<StorageGroup> {
    const res = await apiClient.put<ApiResponse<StorageGroup>>(`/storage-groups/${groupId}`, {
      name: data.name,
      storage_paths: data.paths?.map((path) => joinStoragePath(path.storage_mount, path.folder_path)),
    })
    return res.data.data
  },

  // 删除存储分组
  async deleteGroup(groupId: number): Promise<void> {
    await apiClient.delete(`/storage-groups/${groupId}`)
  },

  // 手动覆盖存储节点总空间容量
  async overrideStorageSpace(storageId: number, totalSpaceBytes: number): Promise<StorageNodeInfo> {
    const response = await apiClient.put<ApiResponse<StorageNodeInfo>>(`/storages/${storageId}/space`, {
      total_space_bytes: totalSpaceBytes,
    })
    return response.data.data
  },
}

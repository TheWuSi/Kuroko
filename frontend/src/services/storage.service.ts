import { apiClient } from './client'
import type { ApiResponse, StorageNodeInfo, StorageGroup } from '@/types/api'

export const storageService = {
  // 获取所有存储节点信息 (包含 OpenList 原生容量与手动推算)
  async getStorages(): Promise<StorageNodeInfo[]> {
    const res = await apiClient.get<ApiResponse<StorageNodeInfo[]>>('/storages')
    return res.data.data
  },

  // 获取所有存储分组
  async getGroups(): Promise<StorageGroup[]> {
    const res = await apiClient.get<ApiResponse<StorageGroup[]>>('/storages/groups')
    return res.data.data
  },

  // 创建存储分组
  async createGroup(name: string, paths: Array<{ storage_mount: string; folder_path: string }>): Promise<StorageGroup> {
    const res = await apiClient.post<ApiResponse<StorageGroup>>('/storages/groups', {
      name,
      paths,
    })
    return res.data.data
  },

  // 更新存储分组
  async updateGroup(
    groupId: number,
    data: { name?: string; paths?: Array<{ storage_mount: string; folder_path: string }> }
  ): Promise<StorageGroup> {
    const res = await apiClient.put<ApiResponse<StorageGroup>>(`/storages/groups/${groupId}`, data)
    return res.data.data
  },

  // 删除存储分组
  async deleteGroup(groupId: number): Promise<void> {
    await apiClient.delete(`/storages/groups/${groupId}`)
  },

  // 手动覆盖存储节点总空间容量
  async overrideStorageSpace(mountPath: string, totalSpaceBytes: number): Promise<void> {
    await apiClient.put(`/storages/override`, {
      storage_mount: mountPath,
      total_space_bytes: totalSpaceBytes,
    })
  },
}

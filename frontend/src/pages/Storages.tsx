import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/common/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  HardDrive,
  FolderPlus,
  Trash2,
  Edit3,
  Sliders,
  Layers,
  Sparkles,
  Plus,
} from 'lucide-react'
import { storageService } from '@/services/storage.service'
import { formatBytes } from '@/lib/format'
import { toast } from '@/stores/uiStore'
import type { StorageNodeInfo, StorageGroup } from '@/types/api'

export function Storages() {
  const [storages, setStorages] = useState<StorageNodeInfo[]>([])
  const [groups, setGroups] = useState<StorageGroup[]>([])
  const [loading, setLoading] = useState(true)

  // 手动配额弹窗
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [selectedMount, setSelectedMount] = useState('')
  const [overrideGigabytes, setOverrideGigabytes] = useState<string>('1024')

  // 分组编辑弹窗
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<StorageGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupPaths, setGroupPaths] = useState<Array<{ storage_mount: string; folder_path: string }>>([
    { storage_mount: '', folder_path: '/' },
  ])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [storageRes, groupRes] = await Promise.all([
        storageService.getStorages().catch(() => []),
        storageService.getGroups().catch(() => []),
      ])
      setStorages(storageRes || [])
      setGroups(groupRes || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载存储信息失败'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 保存手动容量覆盖
  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault()
    const gb = parseFloat(overrideGigabytes)
    if (isNaN(gb) || gb <= 0) {
      toast.warning('请输入有效的容量数值')
      return
    }

    try {
      const bytes = Math.round(gb * 1024 * 1024 * 1024)
      await storageService.overrideStorageSpace(selectedMount, bytes)
      toast.success(`挂载点 ${selectedMount} 总容量配额已更新`)
      setOverrideOpen(false)
      loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存配额失败'
      toast.error(msg)
    }
  }

  // 保存分组
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!groupName.trim()) {
      toast.warning('请输入分组名称')
      return
    }
    const validPaths = groupPaths.filter((p) => p.storage_mount.trim())
    if (validPaths.length === 0) {
      toast.warning('请至少指定一个有效的挂载点路径')
      return
    }

    try {
      if (editingGroup) {
        await storageService.updateGroup(editingGroup.id, {
          name: groupName.trim(),
          paths: validPaths,
        })
        toast.success(`分组 ${groupName} 已更新`)
      } else {
        await storageService.createGroup(groupName.trim(), validPaths)
        toast.success(`分组 ${groupName} 已创建`)
      }
      setGroupModalOpen(false)
      loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存分组失败'
      toast.error(msg)
    }
  }

  // 删除分组
  const handleDeleteGroup = async (group: StorageGroup) => {
    if (!confirm(`确定要删除存储分组 ${group.name} 吗？`)) return
    try {
      await storageService.deleteGroup(group.id)
      toast.success(`分组 ${group.name} 已删除`)
      loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除分组失败'
      toast.error(msg)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="存储节点拓扑与分组编排"
        description="基于 Best-Fit Minimal Remainder 算法调度离线落地位置，支持容量覆盖与挂载点分组管理"
      >
        <Button
          onClick={() => {
            setEditingGroup(null)
            setGroupName('')
            setGroupPaths([{ storage_mount: '', folder_path: '/' }])
            setGroupModalOpen(true)
          }}
          className="gap-2"
        >
          <FolderPlus className="h-4 w-4" />
          创建存储分组
        </Button>
      </PageHeader>

      {/* 存储节点卡片 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-blue-600" />
            OpenList 挂载节点 ({storages.length})
          </h2>
        </div>

        {storages.length === 0 && !loading ? (
          <EmptyState
            title="未检索到任何挂载存储"
            description="请先在【系统设置】中确认 OpenList 正常连接"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {storages.map((node) => {
              const total = node.total_space || 0
              const free = node.free_space || 0
              const used = node.used_space ?? (total - free)
              const percent = total > 0 ? Math.round((used / total) * 100) : 0

              return (
                <Card key={node.id} className="border-slate-200 shadow-xs hover:shadow-md transition-all">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-bold text-slate-900 block truncate" title={node.mount_path}>
                          {node.mount_path}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          驱动: {node.driver}
                        </span>
                      </div>
                      <Badge
                        variant={node.space_source === 'manual' ? 'warning' : 'outline'}
                        className="text-[10px] shrink-0"
                      >
                        {node.space_source === 'manual' ? '手动覆盖' : 'API 原生'}
                      </Badge>
                    </div>

                    <div className="space-y-1.5 font-mono">
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>已用: {formatBytes(used)}</span>
                        <span>剩余: {formatBytes(free)}</span>
                      </div>
                      <Progress
                        value={percent}
                        indicatorClassName={
                          percent > 90
                            ? 'bg-rose-500'
                            : percent > 75
                            ? 'bg-amber-500'
                            : 'bg-blue-600'
                        }
                      />
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>总容量: {formatBytes(total)}</span>
                        <span>占用 {percent}%</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedMount(node.mount_path)
                          setOverrideGigabytes(total > 0 ? (total / (1024 ** 3)).toString() : '1024')
                          setOverrideOpen(true)
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-8 gap-1"
                      >
                        <Sliders className="h-3.5 w-3.5" />
                        手动校准容量
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* 存储分组管理 */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Layers className="h-4 w-4 text-blue-600" />
            存储分组编排 ({groups.length})
          </h2>
          <span className="text-xs text-slate-400">
            下载时指定分组，系统将自动使用组内剩余空间最小的节点以榨干碎片
          </span>
        </div>

        {groups.length === 0 && !loading ? (
          <EmptyState
            title="尚未创建存储分组"
            description="点击上方【创建存储分组】按钮将多个挂载路径编排为一个调度组"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map((group) => (
              <Card key={group.id} className="border-slate-200 shadow-xs">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <CardTitle className="text-base font-bold text-slate-900">
                      {group.name}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingGroup(group)
                        setGroupName(group.name)
                        setGroupPaths(
                          group.paths.length > 0
                            ? group.paths.map((p) => ({
                                storage_mount: p.storage_mount,
                                folder_path: p.folder_path,
                              }))
                            : [{ storage_mount: '', folder_path: '/' }]
                        )
                        setGroupModalOpen(true)
                      }}
                      className="h-8 px-2 text-slate-500 hover:text-slate-900"
                    >
                      <Edit3 className="h-3.5 w-3.5 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteGroup(group)}
                      className="h-8 px-2 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      删除
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600">包含的落地目标路径:</div>
                  <div className="space-y-1.5 font-mono text-xs">
                    {group.paths.map((path, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between truncate"
                      >
                        <span className="truncate">
                          {path.storage_mount}{path.folder_path}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 手动容量覆盖 Dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动设定存储配额</DialogTitle>
            <DialogDescription>
              挂载点 <span className="font-mono font-semibold text-slate-900">{selectedMount}</span> 未能通过 OpenList 接口原生返回容量时，可在此手动指定总空间，系统将根据已有文件累计体积推算剩余空间。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveOverride} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                总空间容量 (单位: GB)
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                required
                value={overrideGigabytes}
                onChange={(e) => setOverrideGigabytes(e.target.value)}
                placeholder="例如: 1024 代表 1TB"
                className="font-mono text-base"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOverrideOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存容量</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 创建/编辑分组 Dialog */}
      <Dialog open={groupModalOpen} onOpenChange={setGroupModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGroup ? '编辑存储分组' : '创建存储分组'}</DialogTitle>
            <DialogDescription>
              将多个存储挂载点与子文件夹绑定为一个逻辑组，供离线下载时碎片优先调度。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveGroup} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">分组名称</label>
              <Input
                type="text"
                required
                placeholder="例如: 主力OD组"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 block">包含挂载路径</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setGroupPaths([...groupPaths, { storage_mount: '', folder_path: '/' }])
                  }
                  className="h-7 text-xs text-blue-600 gap-1"
                >
                  <Plus className="h-3 w-3" />
                  添加路径
                </Button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {groupPaths.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder="挂载点，如 /OD"
                      value={p.storage_mount}
                      onChange={(e) => {
                        const copy = [...groupPaths]
                        copy[idx].storage_mount = e.target.value
                        setGroupPaths(copy)
                      }}
                      className="text-xs font-mono flex-1"
                    />
                    <Input
                      placeholder="子目录，如 /Video"
                      value={p.folder_path}
                      onChange={(e) => {
                        const copy = [...groupPaths]
                        copy[idx].folder_path = e.target.value
                        setGroupPaths(copy)
                      }}
                      className="text-xs font-mono flex-1"
                    />
                    {groupPaths.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setGroupPaths(groupPaths.filter((_, i) => i !== idx))}
                        className="p-2 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGroupModalOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存分组</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/common/EmptyState'
import {
  DownloadCloud,
  Film,
  HardDrive,
  Activity,
  ArrowRight,
  Plus,
  RefreshCw,
  Clock,
  Sparkles,
} from 'lucide-react'
import { taskService } from '@/services/task.service'
import { codeService } from '@/services/code.service'
import { storageService } from '@/services/storage.service'
import { formatBytes, formatSpeed } from '@/lib/format'
import type { DownloadTask, StorageNodeInfo } from '@/types/api'

export function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTasks, setActiveTasks] = useState<DownloadTask[]>([])
  const [totalCodes, setTotalCodes] = useState<number>(0)
  const [storages, setStorages] = useState<StorageNodeInfo[]>([])

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const [tasksRes, codesRes, storagesRes] = await Promise.all([
        taskService.getTasks({ page: 1, page_size: 10 }),
        codeService.getCodes({ page: 1, page_size: 1 }),
        storageService.getStorages().catch(() => []),
      ])
      setActiveTasks(tasksRes.items || [])
      setTotalCodes(codesRes.total || 0)
      setStorages(storagesRes || [])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // 计算存储统计
  const totalStorageBytes = storages.reduce((sum, s) => sum + (s.total_space || 0), 0)
  const freeStorageBytes = storages.reduce((sum, s) => sum + (s.free_space || 0), 0)
  const downloadingCount = activeTasks.filter((t) => t.status === 'downloading' || t.status === 'pending').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="系统概览看板"
        description="实时监控离线下载进度、番号媒体库资产与网盘存储拓扑"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新数据
        </Button>
        <Button asChild size="sm" className="gap-2">
          <Link to="/magnets">
            <Plus className="h-4 w-4" />
            解析新磁力
          </Link>
        </Button>
      </PageHeader>

      {/* 4 块数据指标卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="活动离线任务"
          value={loading ? '-' : `${downloadingCount} 项`}
          description="等待调度与下载中"
          icon={<DownloadCloud className="h-5 w-5" />}
        />
        <StatCard
          title="已收录番号总数"
          value={loading ? '-' : `${totalCodes} 部`}
          description="定向扫描与下载自动入库"
          icon={<Film className="h-5 w-5" />}
        />
        <StatCard
          title="纳管存储剩余容量"
          value={loading ? '-' : formatBytes(freeStorageBytes)}
          description={`总容量: ${formatBytes(totalStorageBytes)}`}
          icon={<HardDrive className="h-5 w-5" />}
        />
        <StatCard
          title="系统健康状态"
          value="良好"
          description="PikPak 引擎就绪"
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      {/* 主面板：左侧活动下载流，右侧存储池碎片分析 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 近期离线任务 */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                近期离线下载任务
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-xs text-blue-600 gap-1">
                <Link to="/tasks">
                  查看全部
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {activeTasks.length === 0 ? (
                <EmptyState
                  title="暂无正在运行的任务"
                  description="在磁力工作台中填入磁力链接即可一键发起离线下载"
                />
              ) : (
                <div className="space-y-3">
                  {activeTasks.slice(0, 5).map((task) => (
                    <div
                      key={task.task_id}
                      className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-slate-900 text-sm truncate">
                            {task.code}
                          </span>
                          <StatusBadge status={task.status} />
                        </div>
                        <div className="text-xs font-mono text-slate-500 shrink-0">
                          {task.status === 'downloading' ? formatSpeed(task.speed) : formatBytes(task.total_size)}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                          <span className="truncate max-w-[200px] sm:max-w-md">📁 {task.target_path}</span>
                          <span>{task.progress.toFixed(1)}%</span>
                        </div>
                        <Progress value={task.progress} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 存储拓扑分布卡片 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                存储池碎片与容量
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="text-xs text-blue-600 gap-1">
                <Link to="/storages">
                  管理拓扑
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {storages.length === 0 ? (
                <EmptyState
                  title="未检测到存储挂载点"
                  description="请在系统设置中配置并连接 OpenList"
                />
              ) : (
                <div className="space-y-4">
                  {storages.map((node) => {
                    const total = node.total_space || 0
                    const free = node.free_space || 0
                    const used = node.used_space ?? (total - free)
                    const percent = total > 0 ? Math.round((used / total) * 100) : 0

                    return (
                      <div key={node.id} className="space-y-1.5 font-mono text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800 truncate max-w-[160px]">
                            {node.mount_path}
                          </span>
                          <span className="text-slate-400">
                            余 {formatBytes(free)}
                          </span>
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
                          <span>驱动: {node.driver}</span>
                          <span>已用 {percent}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'downloading':
      return <Badge variant="info">下载中</Badge>
    case 'completed':
      return <Badge variant="success">已完成</Badge>
    case 'failed':
      return <Badge variant="destructive">失败</Badge>
    case 'cancelled':
      return <Badge variant="secondary">已取消</Badge>
    default:
      return <Badge variant="outline">排队中</Badge>
  }
}

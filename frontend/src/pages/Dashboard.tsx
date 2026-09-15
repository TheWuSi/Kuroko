import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
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
import { storageCache, useStorageStore } from '@/stores/storageStore'
import { useScanStore } from '@/stores/scanStore'
import { formatBytes, formatSpeed } from '@/lib/format'
import { summarizeStorage } from '@/lib/storage'
import type { DownloadTask } from '@/types/api'

export function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTasks, setActiveTasks] = useState<DownloadTask[]>([])
  const [totalCodes, setTotalCodes] = useState<number>(0)
  const storages = useStorageStore((state) => state.storages)
  const libraryRevision = useScanStore((state) => state.libraryRevision)
  const [activeTab, setActiveTab] = useState('all')

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const [tasksRes, codesRes] = await Promise.all([
        taskService.getTasks({ page: 1, page_size: 20 }),
        codeService.getCodes({ page: 1, page_size: 1 }),
        storageCache.refresh(isRefresh),
      ])
      setActiveTasks(tasksRes.items || [])
      setTotalCodes(codesRes.total_codes || 0)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [libraryRevision])

  // 计算存储统计
  const storageSummary = summarizeStorage(storages)
  const downloadingTasks = activeTasks.filter((t) => t.status === 'downloading' || t.status === 'pending')
  const completedTasks = activeTasks.filter((t) => t.status === 'completed')
  const failedTasks = activeTasks.filter((t) => t.status === 'failed')

  const filteredTasks =
    activeTab === 'downloading'
      ? downloadingTasks
      : activeTab === 'completed'
      ? completedTasks
      : activeTab === 'failed'
      ? failedTasks
      : activeTasks

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
          className="gap-2 min-h-11 sm:min-h-9"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新数据
        </Button>
        <Button asChild size="sm" className="gap-2 min-h-11 sm:min-h-9">
          <Link to="/magnets">
            <Plus className="h-4 w-4" />
            解析新磁力
          </Link>
        </Button>
      </PageHeader>

      {/* 4 块数据指标卡片 / 骨架屏 */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 space-y-3">
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3 w-40" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="活动离线任务"
            value={`${downloadingTasks.length} 项`}
            description="等待调度与下载中"
            icon={<DownloadCloud className="h-5 w-5" />}
          />
          <StatCard
            title="已收录番号总数"
            value={`${totalCodes} 部`}
            description="通过定向扫描收录实际文件"
            icon={<Film className="h-5 w-5" />}
          />
          <StatCard
            title="纳管存储剩余容量"
            value={formatBytes(storageSummary.free)}
            description={`已知总容量: ${formatBytes(storageSummary.total)}${storageSummary.unknown ? ` · ${storageSummary.unknown} 个节点容量未知，按 0 汇总` : ''}`}
            icon={<HardDrive className="h-5 w-5" />}
          />
          <StatCard
            title="系统服务健康"
            value="良好"
            description="OpenList 调度引擎就绪"
            icon={<Activity className="h-5 w-5" />}
          />
        </div>
      )}

      {/* 主面板：左侧活动下载流（带 Tabs），右侧存储池碎片分析 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 近期离线任务 */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="shadow-xs">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                <CardTitle className="text-base">近期任务活动流</CardTitle>
              </div>

              {/* Tabs 快速切换流类型 */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                <TabsList className="grid grid-cols-4 h-9 p-1">
                  <TabsTrigger value="all" className="text-xs px-2.5">
                    全部 ({activeTasks.length})
                  </TabsTrigger>
                  <TabsTrigger value="downloading" className="text-xs px-2.5">
                    进行中 ({downloadingTasks.length})
                  </TabsTrigger>
                  <TabsTrigger value="completed" className="text-xs px-2.5">
                    已完成 ({completedTasks.length})
                  </TabsTrigger>
                  <TabsTrigger value="failed" className="text-xs px-2.5">
                    失败 ({failedTasks.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>

            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                      <div className="flex justify-between items-center">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                      <Skeleton className="h-2 w-full rounded-full" />
                    </div>
                  ))}
                </div>
              ) : filteredTasks.length === 0 ? (
                <EmptyState
                  title={
                    activeTab === 'downloading'
                      ? '暂无进行中的下载任务'
                      : activeTab === 'failed'
                      ? '暂无失败任务'
                      : '暂无任务记录'
                  }
                  description="在磁力工作台中填入磁力链接即可一键发起离线下载"
                />
              ) : (
                <div className="space-y-3">
                  {filteredTasks.slice(0, 6).map((task) => (
                    <div
                      key={task.task_id}
                      className="p-3.5 rounded-xl border border-slate-200/60 bg-slate-50/40 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-slate-900 text-sm truncate">
                            {task.code}
                          </span>
                          <StatusBadge status={task.status} />
                        </div>
                        <div className="text-xs font-mono text-slate-500 shrink-0">
                          {task.status === 'downloading'
                            ? formatSpeed(task.speed)
                            : formatBytes(task.total_size)}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                          <span className="truncate max-w-50 sm:max-w-md">
                            📁 {task.target_path}
                          </span>
                          <span>{task.progress.toFixed(1)}%</span>
                        </div>
                        <Progress value={task.progress} />
                      </div>
                    </div>
                  ))}

                  <div className="pt-2 text-center">
                    <Button asChild variant="ghost" size="sm" className="text-xs text-blue-600 gap-1 min-h-11 sm:min-h-9">
                      <Link to="/tasks">
                        前往完整任务管理列表
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 存储拓扑分布卡片 */}
        <div className="space-y-4">
          <Card className="shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <CardTitle className="text-base">存储池碎片与水位</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
                    <Link to="/storages">
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>管理存储驱动拓扑</TooltipContent>
              </Tooltip>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                      <Skeleton className="h-2 w-full rounded-full" />
                    </div>
                  ))}
                </div>
              ) : storages.length === 0 ? (
                <EmptyState
                  title="未检测到存储挂载点"
                  description="请在系统设置中配置并连接 OpenList"
                />
              ) : (
                <div className="space-y-4">
                  {storages.map((node) => {
                    const total = node.total_space
                    const free = node.free_space
                    const used = node.used_space
                    const percent = total !== null && total > 0 && used !== null
                      ? Math.min(100, Math.round((used / total) * 100)) : null

                    return (
                      <div key={node.id} className="space-y-1.5 font-mono text-xs">
                        <div className="flex items-center justify-between">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-semibold text-slate-800 truncate max-w-40 cursor-help">
                                {node.mount_path}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              挂载点: {node.mount_path} · 驱动: {node.driver}
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-slate-400">
                            余 {formatBytes(free)}
                          </span>
                        </div>
                        {percent !== null && <Progress
                          value={percent}
                          indicatorClassName={
                            percent > 90
                              ? 'bg-rose-500'
                              : percent > 75
                              ? 'bg-amber-500'
                              : 'bg-blue-600'
                          }
                        />}
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>驱动: {node.driver}</span>
                          <span>{percent === null ? '用量未知' : `已用 ${percent}%`}</span>
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
      return <Badge variant="success">离线完成</Badge>
    case 'failed':
      return <Badge variant="destructive">失败</Badge>
    case 'cancelled':
      return <Badge variant="secondary">已取消</Badge>
    default:
      return <Badge variant="outline">排队中</Badge>
  }
}

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/common/EmptyState'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { RefreshCw, Trash2 } from 'lucide-react'
import { taskService } from '@/services/task.service'
import { formatBytes, formatDate, formatSpeed } from '@/lib/format'
import { toast } from '@/stores/uiStore'
import type { DownloadTask, TaskStatusType } from '@/types/api'

export function Tasks() {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const fetchTasks = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    try {
      const res = await taskService.getTasks({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page: 1,
        page_size: 100,
      })
      setTasks(res.items || [])
    } catch (err: unknown) {
      if (!isSilent) {
        const msg = err instanceof Error ? err.message : '获取任务列表失败'
        toast.error(msg)
      }
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [statusFilter])

  // 首次及过滤条件变化时加载
  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // 10秒增量轮询 OpenList 任务状态
  useEffect(() => {
    const timer = setInterval(() => {
      fetchTasks(true)
    }, 10000)
    return () => clearInterval(timer)
  }, [fetchTasks])

  // 手动触发后端全量同步
  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await taskService.syncTasks()
      toast.success(`同步完成: 更新 ${res.synced_count} 个任务，${res.completed_count} 个已入库`)
      fetchTasks()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '同步任务失败'
      toast.error(msg)
    } finally {
      setSyncing(false)
    }
  }

  // 取消任务
  const handleCancelTask = async (taskId: string) => {
    if (!confirm('确定要取消该下载任务吗？')) return
    try {
      await taskService.cancelTask(taskId)
      toast.success('任务已取消')
      fetchTasks()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '取消失败'
      toast.error(msg)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="离线下载任务监控"
        description="系统依托 OpenList (PikPak 引擎) 驱动离线转存，每 10 秒自动轮询进度"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            立即同步进度
          </Button>
        </div>
      </PageHeader>

      {/* 状态过滤器 Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: 'all', label: '全部' },
          { id: 'downloading', label: '下载中' },
          { id: 'pending', label: '等待中' },
          { id: 'completed', label: '已完成' },
          { id: 'failed', label: '失败' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              statusFilter === tab.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tasks.length === 0 && !loading ? (
        <EmptyState
          title="暂无下载任务"
          description="当前分类下没有匹配的离线下载任务"
        />
      ) : (
        <>
          {/* 桌面端标准宽幅数据表格 (md 及以上展示) */}
          <div className="hidden md:block">
            <Card className="border-slate-200/80 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">番号代码</TableHead>
                    <TableHead className="w-24">状态</TableHead>
                    <TableHead>进度与速率</TableHead>
                    <TableHead>目标存储路径</TableHead>
                    <TableHead className="w-32">提交时间</TableHead>
                    <TableHead className="text-right w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.task_id}>
                      <TableCell className="font-mono font-bold text-slate-900">
                        {task.code}
                      </TableCell>
                      <TableCell>
                        <TaskBadge status={task.status} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 max-w-xs">
                          <div className="flex justify-between text-xs font-mono text-slate-500">
                            <span>{task.progress.toFixed(1)}%</span>
                            <span>{task.status === 'downloading' ? formatSpeed(task.speed) : formatBytes(task.total_size)}</span>
                          </div>
                          <Progress value={task.progress} />
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600 truncate max-w-xs" title={task.target_path}>
                        📁 {task.target_path}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-400">
                        {formatDate(task.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(task.status === 'downloading' || task.status === 'pending') && (
                          <button
                            type="button"
                            onClick={() => handleCancelTask(task.task_id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
                            title="取消任务"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* 移动端卡片流自适应 (Table-to-Card Responsive Pattern) */}
          <div className="md:hidden space-y-3">
            {tasks.map((task) => (
              <Card key={task.task_id} className="border-slate-200/80 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-base text-slate-900">
                      {task.code}
                    </span>
                    <TaskBadge status={task.status} />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono text-slate-600">
                      <span>{task.status === 'downloading' ? formatSpeed(task.speed) : formatBytes(task.total_size)}</span>
                      <span className="font-semibold text-slate-900">{task.progress.toFixed(1)}%</span>
                    </div>
                    <Progress value={task.progress} />
                  </div>

                  <div className="text-xs font-mono text-slate-500 truncate bg-slate-50 p-2 rounded-lg">
                    📁 {task.target_path}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs text-slate-400 font-mono">
                    <span>{formatDate(task.created_at)}</span>
                    {(task.status === 'downloading' || task.status === 'pending') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelTask(task.task_id)}
                        className="h-8 px-2 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        取消
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TaskBadge({ status }: { status: TaskStatusType }) {
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
      return <Badge variant="outline">等待中</Badge>
  }
}

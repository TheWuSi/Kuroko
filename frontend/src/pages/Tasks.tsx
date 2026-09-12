import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/common/EmptyState'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { RefreshCw, X } from 'lucide-react'
import { taskService } from '@/services/task.service'
import { formatBytes, formatDate, formatSpeed } from '@/lib/format'
import { toast } from '@/stores/uiStore'
import type { DownloadTask, TaskStatusType, TransferTask } from '@/types/api'

export function Tasks() {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [transfers, setTransfers] = useState<TransferTask[]>([])
  const [loading, setLoading] = useState(true)
  const [transfersLoading, setTransfersLoading] = useState(true)
  const [transferError, setTransferError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelRequested, setCancelRequested] = useState<Set<string>>(new Set())

  const fetchTasks = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!silent) setLoading(true)
    try {
      const response = await taskService.getTasks({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page: 1, page_size: 100,
      }, signal)
      if (!signal?.aborted) setTasks(response.items)
    } catch (error) {
      if (!silent && !signal?.aborted) toast.error(error instanceof Error ? error.message : '获取任务列表失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [statusFilter])

  const fetchTransfers = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await taskService.getTransfers(signal)
      if (!signal?.aborted) {
        setTransfers(response)
        setTransferError('')
      }
    } catch (error) {
      if (!signal?.aborted) setTransferError(error instanceof Error ? error.message : '获取转存任务失败')
    } finally {
      if (!signal?.aborted) setTransfersLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (silent = false) => {
      await Promise.all([fetchTasks(silent, controller.signal), fetchTransfers(controller.signal)])
      if (!controller.signal.aborted) timer = setTimeout(() => poll(true), 10000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [fetchTasks, fetchTransfers])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const response = await taskService.syncTasks()
      toast.success(`同步了 ${response.synced_count} 个离线任务，其中 ${response.completed_count} 个离线完成`)
      await Promise.all([fetchTasks(), fetchTransfers()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步任务失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleCancel = async (taskId: string, transfer = false) => {
    const key = `${transfer ? 'transfer' : 'offline'}:${taskId}`
    setCancelling(key)
    try {
      if (transfer) await taskService.cancelTransfer(taskId)
      else await taskService.cancelTask(taskId)
      setCancelRequested((previous) => new Set([...previous, key]))
      toast.success('取消请求已发送，等待 OpenList 确认')
      if (transfer) await fetchTransfers()
      else await fetchTasks(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消失败')
    } finally {
      setCancelling(null)
    }
  }

  const cancelButton = (taskId: string, status: TaskStatusType, transfer = false) => {
    if (status !== 'pending' && status !== 'downloading') return null
    const key = `${transfer ? 'transfer' : 'offline'}:${taskId}`
    return <Button
      variant="ghost" size="sm" className="min-h-[44px] gap-1 text-destructive"
      disabled={cancelling !== null || cancelRequested.has(key)}
      onClick={() => handleCancel(taskId, transfer)}
    ><X className="h-4 w-4" />{cancelRequested.has(key) ? '等待取消确认' : '取消'}</Button>
  }

  return (
    <div className="space-y-6">
      <PageHeader title="离线下载与转存任务" description="页面每 10 秒刷新；离线任务由后台定期同步，也可手动同步。离线完成后请查看转存状态。">
        <Button variant="outline" onClick={handleSync} disabled={syncing} className="min-h-[44px] gap-2">
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />立即同步进度
        </Button>
      </PageHeader>

      <section className="space-y-4" aria-labelledby="offline-heading">
        <h2 id="offline-heading" className="text-base font-semibold">PikPak 离线任务</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: '全部' }, { id: 'downloading', label: '下载中' },
            { id: 'pending', label: '等待中' }, { id: 'completed', label: '离线完成' },
            { id: 'failed', label: '失败' }, { id: 'cancelled', label: '已取消' },
          ].map((tab) => (
            <Button key={tab.id} variant={statusFilter === tab.id ? 'default' : 'outline'}
              size="sm" className="min-h-[44px]" onClick={() => setStatusFilter(tab.id)}>{tab.label}</Button>
          ))}
        </div>
        {loading && <p className="text-sm text-muted-foreground">正在加载离线任务…</p>}
        {tasks.length === 0 && !loading ? <EmptyState title="暂无离线任务" description="当前分类下没有匹配的离线任务" /> : <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader><TableRow>
                <TableHead>番号</TableHead><TableHead>状态</TableHead><TableHead>离线进度</TableHead>
                <TableHead>目标目录与提示</TableHead><TableHead>提交时间</TableHead><TableHead>操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>{tasks.map((task) => <TableRow key={task.task_id}>
                <TableCell className="font-mono font-bold">{task.code}</TableCell>
                <TableCell><TaskBadge status={task.status} /></TableCell>
                <TableCell className="min-w-40"><TaskProgress task={task} /></TableCell>
                <TableCell className="max-w-sm space-y-1">
                  <p className="break-all font-mono text-xs">{task.target_path}</p>
                  {task.error_message && <p className="break-all text-xs text-destructive">{task.error_message}</p>}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(task.created_at)}</TableCell>
                <TableCell>{cancelButton(task.task_id, task.status)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </Card>
          <div className="space-y-3 md:hidden">{tasks.map((task) => <Card key={task.task_id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{task.code}</span><TaskBadge status={task.status} /></div>
              <TaskProgress task={task} />
              <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">{task.target_path}</p>
              {task.error_message && <p className="break-all text-xs text-destructive">{task.error_message}</p>}
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted-foreground">{formatDate(task.created_at)}</span>{cancelButton(task.task_id, task.status)}</div>
            </CardContent>
          </Card>)}</div>
        </>}
        <p className="text-xs text-muted-foreground">显示当前分类最近 100 项。下载字节数按进度估算；上游未提供速率时显示“未知”。</p>
      </section>

      <section className="space-y-4 border-t pt-6" aria-labelledby="transfer-heading">
        <div>
          <h2 id="transfer-heading" className="text-base font-semibold">转存任务</h2>
          <p className="mt-1 text-xs text-muted-foreground">当前 OpenList 账号可见的全部转存任务；通过任务名称和路径核对目标文件，转存完成后可扫描目录更新番号库。</p>
        </div>
        {transferError && <p role="alert" className="text-sm text-destructive">转存列表刷新失败：{transferError}</p>}
        {transfersLoading && <p className="text-sm text-muted-foreground">正在加载转存任务…</p>}
        {!transfers.length && !transfersLoading && !transferError && <EmptyState title="暂无转存任务" description="OpenList 尚未生成转存任务，或任务记录已被清理" />}
        <div className="grid gap-3 lg:grid-cols-2">{transfers.map((task) => <Card key={task.task_id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-all font-mono text-sm">{task.name || task.task_id}</p>
              <TaskBadge status={task.status} transfer />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between font-mono text-xs text-muted-foreground"><span>{task.progress.toFixed(1)}%</span><span>{formatBytes(task.total_size || null)}</span></div>
              <Progress value={task.progress} />
            </div>
            {task.status_detail && <p className="break-all text-xs text-muted-foreground">{task.status_detail}</p>}
            {task.error_message && <p className="break-all text-xs text-destructive">{task.error_message}</p>}
            <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted-foreground">{formatDate(task.start_time)}</span>{cancelButton(task.task_id, task.status, true)}</div>
          </CardContent>
        </Card>)}</div>
      </section>
    </div>
  )
}

function TaskProgress({ task }: { task: DownloadTask }) {
  return <div className="space-y-1">
    <div className="flex justify-between gap-2 font-mono text-xs text-muted-foreground"><span>{task.progress.toFixed(1)}%</span><span>{formatBytes(task.total_size || null)}</span></div>
    <Progress value={task.progress} />
    {task.status === 'downloading' && <p className="text-xs text-muted-foreground">速率：{formatSpeed(task.speed)} · 已下载约 {formatBytes(task.total_size ? task.downloaded_size : null)}</p>}
  </div>
}

function TaskBadge({ status, transfer = false }: { status: TaskStatusType; transfer?: boolean }) {
  switch (status) {
    case 'downloading': return <Badge variant="info">{transfer ? '转存中' : '下载中'}</Badge>
    case 'completed': return <Badge variant="success">{transfer ? '转存完成' : '离线完成'}</Badge>
    case 'failed': return <Badge variant="destructive">失败</Badge>
    case 'cancelled': return <Badge variant="secondary">已取消</Badge>
    default: return <Badge variant="outline">等待中</Badge>
  }
}

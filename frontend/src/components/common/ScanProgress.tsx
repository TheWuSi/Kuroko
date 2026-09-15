import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cancelTrackedScan, isScanActive, useScanStore } from '@/stores/scanStore'
import { toast } from '@/stores/uiStore'

export function ScanProgress() {
  const { job, cancelling, error } = useScanStore()
  const [now, setNow] = useState(Date.now)
  const active = isScanActive(job)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  if (!job) return null
  const seconds = Math.max(0, Math.floor(((job.completed_at ? Date.parse(job.completed_at) : now) - Date.parse(job.started_at)) / 1000))
  const elapsed = Number.isFinite(seconds) ? Math.floor(seconds / 3600) + '小时 ' + Math.floor(seconds % 3600 / 60) + '分 ' + seconds % 60 + '秒' : '未知'
  const labels = { pending: '等待开始', scanning: '扫描中', completed: '已完成', failed: '失败', cancelled: '已取消' }

  return <Card className="bg-muted/30">
    <CardContent className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">扫描状态</span>
        <Badge variant={job.status === 'completed' ? 'success' : active ? 'info' : job.status === 'cancelled' ? 'secondary' : 'destructive'}>
          {active && job.cancel_requested ? '等待停止' : labels[job.status]}
        </Badge>
      </div>
      {error && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{error}，后台任务会继续运行。</p>}
      <div className="space-y-2">
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>扫描范围完成度</span><span className="font-mono">{job.completed_roots} / {job.total_roots}</span>
        </div>
        <Progress value={job.progress_percent} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        {[
          ['已扫文件', job.scanned_files], ['已扫目录', job.scanned_dirs],
          ['新收录文件', job.new_codes_found], ['待处理重复', job.duplicates_found],
        ].map(([label, value]) => <div key={label}><p className="text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>)}
      </div>
      <p className="text-xs text-muted-foreground">耗时 <span className="font-mono">{elapsed}</span></p>
      {job.current_path && <p className="break-all font-mono text-xs text-muted-foreground">当前目录：{job.current_path}</p>}
      {job.error_message && <p role="alert" className="wrap-break-word rounded-md bg-destructive/10 p-2 text-xs text-destructive">{job.error_message}</p>}
      {active ? <>
        <p className="text-xs text-muted-foreground">扫描在后台持续运行，可关闭面板、切换页面或刷新浏览器。</p>
        <Button variant="outline" className="min-h-11 w-full gap-2" disabled={cancelling || job.cancel_requested}
          onClick={() => void cancelTrackedScan().catch((error) => toast.error(error instanceof Error ? error.message : '取消扫描失败'))}>
          {cancelling || job.cancel_requested ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          {job.cancel_requested ? '等待当前请求结束后停止' : '取消扫描'}
        </Button>
      </> : job.status === 'cancelled' && <p className="text-xs text-muted-foreground">未完成范围的旧索引已保留，可重新发起扫描。</p>}
    </CardContent>
  </Card>
}

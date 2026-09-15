import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileTree } from '@/components/common/FileTree'
import { magnetJobsService } from '@/services/magnet-jobs.service'
import type { MagnetParseItem } from '@/types/api'

export function LazyMagnetFiles({ jobId, index, attempt }: { jobId: string; index: number; attempt: number }) {
  const [requested, setRequested] = useState(0)
  const [result, setResult] = useState<MagnetParseItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!requested) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    magnetJobsService.item(jobId, index, controller.signal).then((data) => {
      if (data.attempt !== attempt || !data.result) throw new Error('条目结果已更新，请等待状态刷新后重试')
      if (!controller.signal.aborted) setResult(data.result)
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '文件清单读取失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [jobId, index, attempt, requested])
  if (result) return <FileTree files={result.files} filteredFiles={result.filtered_files} defaultOpen />
  return <div className="space-y-1">
    <Button variant="ghost" className="min-h-11" disabled={loading} onClick={() => setRequested((value) => value + 1)}>
      {loading ? '正在读取文件清单…' : error ? '重试读取文件清单' : '查看文件清单'}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}

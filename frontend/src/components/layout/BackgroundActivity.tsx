import { useEffect } from 'react'
import { Link } from 'react-router'
import { Radar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { storageCache } from '@/stores/storageStore'
import { isScanActive, refreshScanStatus, resetScanTracking, useScanStore } from '@/stores/scanStore'

export function BackgroundActivity() {
  const userId = useAuthStore((state) => state.user?.id)
  const job = useScanStore((state) => state.job)
  const error = useScanStore((state) => state.error)

  useEffect(() => {
    storageCache.initialize(userId ?? null)
    resetScanTracking()
    if (!userId) return
    const controller = new AbortController()
    let storageTimer: ReturnType<typeof setTimeout> | undefined
    let scanTimer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const pollStorage = async () => {
      await storageCache.refresh()
      if (!controller.signal.aborted) storageTimer = setTimeout(pollStorage, 10000)
    }
    const pollScan = async () => {
      const success = await refreshScanStatus(controller.signal)
      failures = success ? 0 : failures + 1
      const normalDelay = isScanActive(useScanStore.getState().job) ? 2000 : 10000
      const delay = Math.min(30000, normalDelay * 2 ** Math.min(failures, 4))
      if (!controller.signal.aborted) {
        clearTimeout(scanTimer)
        scanTimer = setTimeout(pollScan, delay)
      }
    }
    const refreshOnFocus = () => {
      void storageCache.refresh()
      void refreshScanStatus(controller.signal)
    }
    // 容量刷新可能耗时较长，扫描状态使用独立轮询，避免被容量查询拖慢。
    void pollStorage()
    void pollScan()
    const unsubscribe = useScanStore.subscribe((state, previous) => {
      if (isScanActive(state.job) && !isScanActive(previous.job)) {
        clearTimeout(scanTimer)
        scanTimer = setTimeout(pollScan, 2000)
      }
    })
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      controller.abort()
      clearTimeout(storageTimer)
      clearTimeout(scanTimer)
      window.removeEventListener('focus', refreshOnFocus)
      unsubscribe()
      resetScanTracking()
    }
  }, [userId])

  if (!isScanActive(job)) return null
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Radar className="h-4 w-4 shrink-0 animate-pulse text-primary" />
      <div>
        <p>{job?.cancel_requested ? '正在停止扫描' : '定向探测扫描进行中'} · 已扫 {job?.scanned_files} 个文件</p>
        <p className="text-xs text-muted-foreground">{error || '后台持续运行，可切换页面或刷新浏览器。'}</p>
      </div>
    </div>
    <Button asChild variant="outline" className="min-h-[44px] shrink-0">
      <Link to="/codes" onClick={() => useScanStore.setState({ panelOpen: true })}>查看扫描</Link>
    </Button>
  </div>
}

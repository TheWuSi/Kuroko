import { useEffect } from 'react'
import { Link } from 'react-router'
import { Magnet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { initializeMagnets, isMagnetActive, magnetDraft, refreshMagnets, useMagnetStore } from '@/stores/magnetStore'

export function MagnetActivity() {
  const userId = useAuthStore((state) => state.user?.id)
  const active = useMagnetStore((state) => state.jobs.find(isMagnetActive) ?? (isMagnetActive(state.job) ? state.job : null))
  const submission = useMagnetStore((state) => state.activeSubmission)
  const error = useMagnetStore((state) => state.error)
  useEffect(() => {
    initializeMagnets(userId ?? null)
    if (!userId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let running = false
    const poll = async () => {
      if (running || controller.signal.aborted) return
      running = true
      const success = await refreshMagnets(controller.signal)
      running = false
      if (controller.signal.aborted) return
      failures = success ? 0 : failures + 1
      const state = useMagnetStore.getState()
      const cached = magnetDraft.store.getState()
      const busy = state.jobs.some(isMagnetActive) || isMagnetActive(state.job) || state.activeSubmission || cached.parseRequest || cached.submissionRequest
      clearTimeout(timer)
      timer = setTimeout(poll, Math.min(30000, (busy ? 2000 : 10000) * 2 ** Math.min(failures, 4)))
    }
    const focus = () => { void refreshMagnets(controller.signal) }
    const busy = (state: ReturnType<typeof useMagnetStore.getState>) => state.starting || state.submitting ||
      state.jobs.some(isMagnetActive) || isMagnetActive(state.job) || Boolean(state.activeSubmission)
    const unsubscribe = useMagnetStore.subscribe((state, previous) => {
      if (busy(state) && !busy(previous)) { clearTimeout(timer); timer = setTimeout(poll, 2000) }
    })
    void poll()
    window.addEventListener('focus', focus)
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener('focus', focus)
      unsubscribe()
      initializeMagnets(null)
    }
  }, [userId])

  if (!active && !submission) return null
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
    <div className="flex items-center gap-2 text-sm">
      <Magnet className="h-4 w-4 shrink-0 animate-pulse" />
      <div>
        <p>{submission ? `下载提交中 · ${submission.completed}/${submission.total}` : `磁力解析中 · ${active?.completed}/${active?.total}`}</p>
        <p className="text-xs text-muted-foreground">{error || '后台持续运行，切页、刷新或关闭页面后仍会继续。'}</p>
      </div>
    </div>
    <Button asChild variant="outline" className="min-h-[44px]"><Link to="/magnets">查看磁力工作台</Link></Button>
  </div>
}

import { create } from 'zustand'
import { codeService } from '@/services/code.service'
import { ApiRequestError } from '@/services/client'
import { storageCache } from '@/stores/storageStore'
import { toast } from '@/stores/uiStore'
import type { ScanJobStatus } from '@/types/api'

interface ScanState {
  job: ScanJobStatus | null
  error: string
  starting: boolean
  cancelling: boolean
  libraryRevision: number
  panelOpen: boolean
}

export const useScanStore = create<ScanState>(() => ({
  job: null, error: '', starting: false, cancelling: false, libraryRevision: 0, panelOpen: false,
}))

let generation = 0
let requestNumber = 0
export const isScanActive = (job: ScanJobStatus | null) => job?.status === 'pending' || job?.status === 'scanning'

function acceptJob(job: ScanJobStatus) {
  const previous = useScanStore.getState().job
  if (previous?.task_id === job.task_id && !isScanActive(previous) && isScanActive(job)) return
  const finished = !isScanActive(job) && (previous?.task_id !== job.task_id || previous.status !== job.status)
  useScanStore.setState((state) => ({
    job: previous?.task_id === job.task_id && previous.cancel_requested
      ? { ...job, cancel_requested: true } : job,
    error: '', libraryRevision: state.libraryRevision + (finished ? 1 : 0),
  }))
  if (finished && previous) {
    void storageCache.refresh()
    if (job.status === 'completed') {
      if (job.duplicates_found) toast.warning('扫描完成，发现 ' + job.duplicates_found + ' 组待处理重复')
      else toast.success('扫描完成，新收录 ' + job.new_codes_found + ' 条媒体记录')
    } else if (job.status === 'cancelled') toast.info('扫描已取消，未完成范围的旧索引已保留')
    else toast.error(job.error_message || '扫描失败')
  }
}

export function resetScanTracking() {
  generation += 1
  requestNumber += 1
  useScanStore.setState({ job: null, error: '', starting: false, cancelling: false, libraryRevision: 0, panelOpen: false })
}

export async function refreshScanStatus(signal?: AbortSignal): Promise<boolean> {
  if (useScanStore.getState().starting) return true
  const ticket = generation
  const request = ++requestNumber
  try {
    const job = await codeService.getScanStatus(undefined, signal)
    if (!signal?.aborted && ticket === generation && request === requestNumber) acceptJob(job)
    return true
  } catch (error) {
    if (signal?.aborted || ticket !== generation || request !== requestNumber) return true
    if (error instanceof ApiRequestError && error.status === 404) {
      useScanStore.setState({ job: null, error: '' })
      return true
    }
    useScanStore.setState({ error: '暂时无法读取扫描状态，正在自动重试' })
    return false
  }
}

export async function startTrackedScan(groupId: number | undefined, paths: string[]) {
  generation += 1
  const ticket = generation
  useScanStore.setState({ starting: true, error: '' })
  try {
    const result = await codeService.startScan(groupId)
    if (ticket !== generation) return
    useScanStore.setState({
      job: {
        task_id: result.task_id, group_id: result.group_id, status: 'pending', scan_paths: [...paths],
        scanned_files: 0, scanned_dirs: 0, new_codes_found: 0, duplicates_found: 0,
        total_roots: paths.length, completed_roots: 0, progress_percent: 0, cancel_requested: false,
        current_path: null, started_at: new Date().toISOString(), completed_at: null, error_message: null,
      },
    })
  } finally {
    if (ticket === generation) {
      useScanStore.setState({ starting: false })
      void refreshScanStatus()
    }
  }
}

export async function cancelTrackedScan() {
  const job = useScanStore.getState().job
  if (!job || !isScanActive(job)) return
  generation += 1
  const ticket = generation
  useScanStore.setState({ cancelling: true })
  try {
    const updated = await codeService.cancelScan(job.task_id)
    if (ticket === generation) acceptJob(updated)
  } finally {
    if (ticket === generation) {
      useScanStore.setState({ cancelling: false })
      void refreshScanStatus()
    }
  }
}

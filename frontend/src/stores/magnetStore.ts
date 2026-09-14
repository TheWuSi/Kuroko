import { create, useStore } from 'zustand'
import { createMagnetDraft, DRAFT_PREFIX, type MagnetDraft } from '@/lib/magnetDraft'
import { magnetJobsService } from '@/services/magnet-jobs.service'
import { ApiRequestError } from '@/services/client'
import { toast } from '@/stores/uiStore'
import type { MagnetJob, MagnetJobSummary, MagnetSubmission, MagnetSubmissionSummary, TargetScope } from '@/types/api'

export const magnetDraft = createMagnetDraft()
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === DRAFT_PREFIX + magnetDraft.store.getState().userId) magnetDraft.sync()
  })
}
export const useMagnetDraft = () => useStore(magnetDraft.store)
export const isMagnetActive = (job: { status: string } | null | undefined) => job?.status === 'pending' || job?.status === 'running'

interface MagnetState {
  userId: number | null
  job: MagnetJob | null
  jobs: MagnetJobSummary[]
  activeSubmission: MagnetSubmissionSummary | null
  history: MagnetSubmissionSummary[]
  historyTotal: number
  historyPage: number
  loadingHistory: boolean
  starting: boolean
  submitting: boolean
  changing: boolean
  error: string
}
const initial = (): MagnetState => ({
  userId: null, job: null, jobs: [], activeSubmission: null, history: [], historyTotal: 0,
  historyPage: 1, loadingHistory: false, starting: false, submitting: false, changing: false, error: '',
})
export const useMagnetStore = create<MagnetState>(initial)
let generation = 0
let selection = 0
let polling: Promise<boolean> | null = null
const announced = new Set<string>()

function mergeHistory(previous: MagnetSubmissionSummary[], incoming: MagnetSubmissionSummary[]) {
  const rows = new Map(previous.map((row) => [row.submission_id, row]))
  incoming.forEach((row) => rows.set(row.submission_id, row))
  return [...rows.values()].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || right.submission_id.localeCompare(left.submission_id))
}

export function initializeMagnets(userId: number | null) {
  if (useMagnetStore.getState().userId === userId) return
  generation += 1
  selection += 1
  polling = null
  announced.clear()
  magnetDraft.initialize(userId)
  useMagnetStore.setState({ ...initial(), userId })
}

function acceptSubmission(submission: MagnetSubmission) {
  const pending = magnetDraft.store.getState().submissionRequest
  magnetDraft.acceptSubmission(submission)
  useMagnetStore.setState({ activeSubmission: isMagnetActive(submission) ? submission : null })
  if (submission.status === 'completed' && pending?.requestId === submission.request_id && !announced.has(submission.submission_id)) {
    announced.add(submission.submission_id)
    const message = `已提交 ${submission.submitted} 项，跳过 ${submission.skipped} 项，失败 ${submission.failed} 项，待核实 ${submission.unknown} 项`
    if (submission.failed || submission.unknown) toast.warning(message)
    else toast.success(message)
  }
}

export function refreshMagnets(signal?: AbortSignal): Promise<boolean> {
  if (polling) return polling
  if (useMagnetStore.getState().userId === null) return Promise.resolve(true)
  const ticket = generation
  const view = selection
  const current = () => ticket === generation && !signal?.aborted
  const request = (async () => {
    try {
      const [jobs, history, activeSubmissions] = await Promise.all([
        magnetJobsService.list(undefined, signal), magnetJobsService.submissions(undefined, signal),
        magnetJobsService.submissions({ active: true }, signal),
      ])
      if (!current()) return true
      useMagnetStore.setState((state) => ({
        jobs: jobs.items, historyTotal: history.total, error: '', activeSubmission: activeSubmissions.items[0] ?? null,
        history: mergeHistory(state.history, history.items),
      }))
      const cached = magnetDraft.store.getState()
      let created = cached.parseRequest && jobs.items.find((job) => job.request_id === cached.parseRequest?.requestId)
      if (cached.parseRequest && !created) {
        created = (await magnetJobsService.list({ request_id: cached.parseRequest.requestId }, signal)).items[0]
      }
      const jobId = created?.job_id ?? cached.draft.jobId ?? useMagnetStore.getState().job?.job_id ?? jobs.items.find(isMagnetActive)?.job_id
      if (jobId) {
        const job = await magnetJobsService.get(jobId, signal)
        if (current() && selection === view) {
          magnetDraft.bindJob(job)
          useMagnetStore.setState({ job })
        }
      }
      const pending = magnetDraft.store.getState().submissionRequest
      let submissionId = pending?.submissionId ?? history.items.find((item) => item.request_id === pending?.requestId)?.submission_id
      if (pending && !submissionId) {
        submissionId = (await magnetJobsService.submissions({ request_id: pending.requestId }, signal)).items[0]?.submission_id
      }
      if (submissionId) {
        const submission = await magnetJobsService.submission(submissionId, signal)
        if (current()) acceptSubmission(submission)
      }
      return true
    } catch (error) {
      if (current()) useMagnetStore.setState({ error: error instanceof Error ? `${error.message}，稍后自动重试` : '暂时无法读取任务状态，稍后自动重试' })
      return false
    }
  })()
  polling = request
  void request.finally(() => { if (polling === request) polling = null })
  return request
}

export async function startMagnetParse(scope: TargetScope) {
  const ticket = generation
  const view = ++selection
  const request = magnetDraft.beginParse(scope)
  useMagnetStore.setState({ starting: true, error: '' })
  try {
    const job = await magnetJobsService.create(request.requestId, request.links, request.scope)
    if (ticket === generation && view === selection) {
      magnetDraft.bindJob(job)
      useMagnetStore.setState({ job })
    }
  } finally {
    if (ticket === generation) { useMagnetStore.setState({ starting: false }); void refreshMagnets() }
  }
}

export async function changeMagnetParse(action: 'cancel' | 'resume', indices?: number[]) {
  const job = useMagnetStore.getState().job
  if (!job) return
  const ticket = generation
  const view = ++selection
  useMagnetStore.setState({ changing: true })
  try {
    const updated = action === 'cancel' ? await magnetJobsService.cancel(job.job_id) : await magnetJobsService.resume(job.job_id, indices)
    if (ticket === generation && view === selection) useMagnetStore.setState({ job: updated })
  } finally {
    if (ticket === generation) useMagnetStore.setState({ changing: false })
  }
}

export async function submitMagnetItems(indices: number[], scope: TargetScope, force: boolean) {
  const job = useMagnetStore.getState().job
  if (!job) return
  const ticket = generation
  const request = magnetDraft.beginSubmission(job.job_id, indices, scope, force)
  useMagnetStore.setState({ submitting: true })
  try {
    const submission = await magnetJobsService.submit(request.jobId, request.requestId, request.indices, request.scope, request.force)
    if (ticket === generation) acceptSubmission(submission)
  } catch (error) {
    if (ticket === generation && error instanceof ApiRequestError && error.status && [400, 403, 404, 409, 422].includes(error.status)) {
      magnetDraft.discardSubmissionRequest()
    }
    throw error
  } finally {
    if (ticket === generation) { useMagnetStore.setState({ submitting: false }); void refreshMagnets() }
  }
}

export async function restoreMagnetJob(jobId: string, scope?: TargetScope, storageId = '') {
  const ticket = generation
  const view = ++selection
  const revision = magnetDraft.store.getState().draft.revision
  const job = await magnetJobsService.get(jobId)
  if (ticket !== generation || view !== selection) return
  if (magnetDraft.store.getState().draft.revision !== revision) {
    toast.info('输入已变化，已保留最新草稿；需要恢复时请再次点击记录')
    return
  }
  if (magnetDraft.restore(job, scope, storageId)) {
    useMagnetStore.setState({ job })
    toast.info('已恢复输入与解析结果，请核对下载位置；原草稿可撤销恢复')
  }
}

export async function loadMoreMagnetHistory() {
  const state = useMagnetStore.getState()
  if (state.loadingHistory || state.history.length >= state.historyTotal) return
  const ticket = generation
  useMagnetStore.setState({ loadingHistory: true })
  try {
    const page = state.historyPage + 1
    const result = await magnetJobsService.submissions({ page })
    if (ticket === generation) useMagnetStore.setState((previous) => ({
      historyPage: page, historyTotal: result.total,
      history: mergeHistory(previous.history, result.items),
    }))
  } finally { if (ticket === generation) useMagnetStore.setState({ loadingHistory: false }) }
}

export function updateMagnetDraft(patch: Partial<Pick<MagnetDraft, 'text' | 'targetMode' | 'selectedStorage' | 'selectedGroup' | 'targetPath'>>) {
  magnetDraft.edit(patch)
}

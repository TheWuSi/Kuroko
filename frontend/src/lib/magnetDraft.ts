import { createStore } from 'zustand/vanilla'
import { newRequestId } from './authSession.ts'
import type { MagnetJob, MagnetSubmission, TargetScope } from '@/types/api'

export const DRAFT_PREFIX = 'kuroko_magnet_draft_v1:'
export const MAX_DRAFT_LENGTH = 1_000_000

export interface MagnetDraft {
  text: string
  targetMode: 'direct' | 'group'
  selectedStorage: string
  selectedGroup: string
  targetPath: string
  jobId: string | null
  indices: number[]
  revision: string
  updatedAt: number
}

interface ParseRequest {
  requestId: string
  revision: string
  links: string[]
  scope: TargetScope
}
interface SubmissionRequest {
  requestId: string
  revision: string
  jobId: string
  submissionId: string | null
  indices: number[]
  force: boolean
  scope: TargetScope
}
export type PruneReason = 'skipped' | 'submitted'

interface AcceptOptions {
  /** 批次收尾后从输入框移除的条目索引，默认移除已提交与已跳过的重复项。 */
  prune?: (index: number) => PruneReason | null
}

interface Cache {
  draft: MagnetDraft
  backup: MagnetDraft | null
  parseRequest: ParseRequest | null
  submissionRequest: SubmissionRequest | null
}
interface DraftState extends Cache {
  userId: number | null
  error: string
  savedAt: number | null
}

const empty = (): MagnetDraft => ({
  text: '', targetMode: 'direct', selectedStorage: '', selectedGroup: '', targetPath: '',
  jobId: null, indices: [], revision: newRequestId(), updatedAt: 0,
})
const initial = (): DraftState => ({
  userId: null, draft: empty(), backup: null, parseRequest: null, submissionRequest: null, error: '', savedAt: null,
})
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const indices = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 100 &&
  value.every((index) => Number.isInteger(index) && index >= 0 && index < 100) && new Set(value).size === value.length
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function validDraft(value: unknown): value is MagnetDraft {
  return object(value) && text(value.text, MAX_DRAFT_LENGTH) && ['direct', 'group'].includes(String(value.targetMode)) &&
    text(value.selectedStorage, 32) && text(value.selectedGroup, 32) && text(value.targetPath, 1024) &&
    (value.jobId === null || id(value.jobId)) && indices(value.indices) && id(value.revision) &&
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt >= 0
}
function validScope(value: unknown): value is TargetScope {
  return object(value) && (value.target_path === undefined || text(value.target_path, 1024)) &&
    (value.target_group === undefined || (typeof value.target_group === 'number' && Number.isSafeInteger(value.target_group) && value.target_group > 0) || text(value.target_group, 100))
}
function validCache(value: unknown): value is Cache {
  if (!object(value) || !validDraft(value.draft) || !(value.backup === null || validDraft(value.backup))) return false
  const parse = value.parseRequest
  const submit = value.submissionRequest
  return (parse === null || (object(parse) && id(parse.requestId) && id(parse.revision) && validScope(parse.scope) &&
    Array.isArray(parse.links) && parse.links.length > 0 && parse.links.length <= 100 && parse.links.every((link) => text(link, 8192)))) &&
    (submit === null || (object(submit) && id(submit.requestId) && id(submit.revision) && id(submit.jobId) &&
      (submit.submissionId === null || id(submit.submissionId)) && indices(submit.indices) && typeof submit.force === 'boolean' && validScope(submit.scope)))
}
function browserStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function createMagnetDraft(storage: () => Storage | undefined = browserStorage) {
  const store = createStore<DraftState>(initial)

  function commit(patch: Partial<Cache>, protect = false): boolean {
    const previous = store.getState()
    const next = { ...previous, ...patch }
    if (next.userId === null) return false
    try {
      const target = storage()
      if (!target) throw new Error('存储不可用')
      if (protect) {
        const raw = target.getItem(DRAFT_PREFIX + next.userId)
        const disk: unknown = raw && raw.length <= 4_000_000 ? JSON.parse(raw) : null
        if (validCache(disk) && disk.draft.revision !== previous.draft.revision) {
          store.setState({ error: '另一标签页更新了草稿，已保留其内容，请刷新后继续。' })
          return false
        }
      }
      target.setItem(DRAFT_PREFIX + next.userId, JSON.stringify({
        version: 1, draft: next.draft, backup: next.backup, parseRequest: next.parseRequest, submissionRequest: next.submissionRequest,
      }))
      store.setState({ ...patch, error: '', savedAt: Date.now() })
      return true
    } catch {
      store.setState({ ...(protect ? {} : patch), error: '本机缓存未能写入，请保留页面并复制磁力备份。', savedAt: null })
      return false
    }
  }

  function initialize(userId: number | null) {
    if (store.getState().userId === userId) return
    store.setState({ ...initial(), userId })
    if (userId === null) return
    try {
      const raw = storage()?.getItem(DRAFT_PREFIX + userId)
      if (!raw) return
      if (raw.length > 4_000_000) throw new Error('草稿过大')
      const saved: unknown = JSON.parse(raw)
      if (!object(saved) || saved.version !== 1 || !validCache(saved)) throw new Error('草稿格式错误')
      store.setState({
        draft: saved.draft, backup: saved.backup, parseRequest: saved.parseRequest,
        submissionRequest: saved.submissionRequest, savedAt: saved.draft.updatedAt || null,
      })
    } catch { store.setState({ error: '本机草稿无法读取，原缓存已保留；已提交的批次可从最近记录恢复。' }) }
  }

  function edit(patch: Partial<Pick<MagnetDraft, 'text' | 'targetMode' | 'selectedStorage' | 'selectedGroup' | 'targetPath'>>) {
    const previous = store.getState().draft
    if (Object.entries(patch).every(([key, value]) => previous[key as keyof MagnetDraft] === value)) return
    if (patch.text !== undefined && patch.text.length > MAX_DRAFT_LENGTH) {
      store.setState({ error: '输入超过草稿容量上限，请分批输入；现有草稿已保留。' })
      return
    }
    const changedText = patch.text !== undefined && patch.text !== previous.text
    commit({
      draft: { ...previous, ...patch, ...(changedText ? { jobId: null, indices: [] } : {}), revision: newRequestId(), updatedAt: Date.now() },
      parseRequest: null,
    })
  }

  function beginParse(scope: TargetScope): ParseRequest {
    const state = store.getState()
    if (state.parseRequest?.revision === state.draft.revision) return state.parseRequest
    const request = {
      requestId: newRequestId(), revision: state.draft.revision,
      links: state.draft.text.split('\n').map((line) => line.trim()).filter(Boolean), scope,
    }
    commit({ parseRequest: request })
    return request
  }

  function bindJob(job: MagnetJob) {
    const state = store.getState()
    if (state.parseRequest?.requestId !== job.request_id || state.parseRequest.revision !== state.draft.revision) return
    commit({ draft: { ...state.draft, jobId: job.job_id, indices: job.items.map((item) => item.index) }, parseRequest: null })
  }

  function beginSubmission(jobId: string, selected: number[], scope: TargetScope, force: boolean): SubmissionRequest {
    const state = store.getState()
    if (state.submissionRequest) {
      const prior = state.submissionRequest
      if (prior.jobId === jobId && prior.force === force && JSON.stringify(prior.indices) === JSON.stringify(selected) &&
        JSON.stringify(prior.scope) === JSON.stringify(scope)) return prior
      throw new Error('上一项提交仍在处理中，请等待提交结果')
    }
    const request = { requestId: newRequestId(), revision: state.draft.revision, jobId, submissionId: null, indices: selected, scope, force }
    commit({ submissionRequest: request })
    return request
  }

  function acceptSubmission(submission: MagnetSubmission, options: AcceptOptions = {}) {
    const state = store.getState()
    const request = state.submissionRequest
    if (!request || request.requestId !== submission.request_id) return
    if (submission.status !== 'completed') {
      if (request.submissionId !== submission.submission_id) commit({ submissionRequest: { ...request, submissionId: submission.submission_id } })
      return
    }
    let draft = state.draft
    // 输入修订号绑定提交时的快照，后台完成不能清掉后来输入的新一批磁力。
    if (draft.revision === request.revision && draft.jobId === submission.job_id) {
      const successful = new Set(submission.items.filter((item) => item.status === 'submitted' ||
        (item.status === 'skipped' && item.result?.reason === 'already_submitted')).map((item) => item.index))
      const lines = draft.text.split('\n').map((line) => line.trim()).filter(Boolean)
      if (lines.length === draft.indices.length) {
        const remaining = draft.indices.flatMap((index, position) => successful.has(index) ? [] : [{ index, line: lines[position] }])
        draft = { ...draft, text: remaining.map((item) => item.line).join('\n'), indices: remaining.map((item) => item.index),
          jobId: remaining.length ? draft.jobId : null, revision: newRequestId(), updatedAt: Date.now() }
      }
    }
    // 批次收尾默认移除重复项：库内已存在的条目仍可在解析结果区查看与强制下载，但不再占用输入框。
    if (options.prune && draft.revision === request.revision && draft.jobId === submission.job_id) {
      const lines = draft.text.split('\n').map((line) => line.trim()).filter(Boolean)
      if (lines.length === draft.indices.length) {
        const remaining = draft.indices.flatMap((index, position) => options.prune!(index) ? [] : [{ index, line: lines[position] }])
        if (remaining.length < draft.indices.length) {
          draft = { ...draft, text: remaining.map((item) => item.line).join('\n'), indices: remaining.map((item) => item.index),
            jobId: remaining.length ? draft.jobId : null, revision: newRequestId(), updatedAt: Date.now() }
        }
      }
    }
    commit({ draft, submissionRequest: null }, true)
  }

  function restore(job: MagnetJob, scope: TargetScope = job.scope, storageId = ''): boolean {
    const state = store.getState()
    const draft: MagnetDraft = {
      ...empty(), text: job.items.map((item) => item.magnet).join('\n'), jobId: job.job_id,
      indices: job.items.map((item) => item.index), targetMode: scope.target_path ? 'direct' : scope.target_group ? 'group' : 'direct',
      selectedStorage: storageId, selectedGroup: scope.target_group ? String(scope.target_group) : '',
      targetPath: scope.target_path ?? '', updatedAt: Date.now(),
    }
    return commit({ draft, backup: state.draft.text ? state.draft : state.backup, parseRequest: null }, true)
  }

  function undo(): boolean {
    const state = store.getState()
    if (!state.backup) return false
    return commit({ draft: { ...state.backup, revision: newRequestId(), updatedAt: Date.now() }, backup: null, parseRequest: null }, true)
  }

  function sync() {
    const state = store.getState()
    if (state.userId === null || (state.error && state.savedAt === null)) return
    try {
      const raw = storage()?.getItem(DRAFT_PREFIX + state.userId)
      if (!raw || raw.length > 4_000_000) return
      const value: unknown = JSON.parse(raw)
      if (object(value) && value.version === 1 && validCache(value)) {
        store.setState({ draft: value.draft, backup: value.backup, parseRequest: value.parseRequest,
          submissionRequest: value.submissionRequest, error: '', savedAt: value.draft.updatedAt || null })
      }
    } catch { /* 不以损坏或无法读取的缓存覆盖当前输入。 */ }
  }

  return { store, initialize, edit, beginParse, bindJob, beginSubmission, acceptSubmission, restore, undo, sync,
    discardSubmissionRequest: () => commit({ submissionRequest: null }),
  }
}

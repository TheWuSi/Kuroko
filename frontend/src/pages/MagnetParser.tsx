import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StorageDirectoryField } from '@/components/common/StorageDirectoryField'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { LazyMagnetFiles } from '@/components/common/LazyMagnetFiles'
import { EmptyState } from '@/components/common/EmptyState'
import { Magnet, Zap, Download, AlertTriangle, CheckCircle2, Copy, Check, RefreshCw, History, Undo2, ClipboardPaste, Pencil, RotateCcw } from 'lucide-react'
import { cleanBatchMagnets, cleanMagnetUri, appendClipboardLines, readClipboardText } from '@/lib/magnet'
import { MAX_DRAFT_LENGTH } from '@/lib/magnetDraft'
import { normalizeStoragePath } from '@/lib/path'
import { formatBytes } from '@/lib/format'
import { variantLabel } from '@/lib/storage'
import { magnetService } from '@/services/magnet.service'
import { useStorageStore } from '@/stores/storageStore'
import { toast } from '@/stores/uiStore'
import {
  changeMagnetParse, correctMagnetCode, isMagnetActive, loadMoreMagnetHistory, magnetDraft, refreshMagnets,
  restoreMagnetJob, startMagnetParse, submitMagnetItems, updateMagnetDraft, useMagnetDraft, useMagnetStore,
} from '@/stores/magnetStore'
import type { DuplicateDecision, MagnetJobOutcome, TargetScope } from '@/types/api'

const fallbackLabels: Record<string, string> = {
  bt_metadata_timeout: '元数据解析超时', bt_metadata_unavailable: '元数据服务不可用',
  bt_metadata_overloaded: '元数据服务过载', bt_metadata_connection_error: '元数据服务连接失败',
  bt_metadata_invalid_request: '解析服务拒绝该链接', bt_metadata_invalid_response: '元数据响应无效',
}
const sameScope = (left: TargetScope, right: TargetScope) =>
  (left.target_path ?? '') === (right.target_path ?? '') && String(left.target_group ?? '') === String(right.target_group ?? '')
const blocked = (outcome?: MagnetJobOutcome) => outcome && (
  ['pending', 'running', 'submitted', 'unknown'].includes(outcome.status) ||
  (outcome.status === 'skipped' && outcome.result?.reason === 'already_submitted')
)
function outcomeMessage(outcome: MagnetJobOutcome) {
  const result = outcome.result
  if (outcome.status === 'submitted') return `已提交离线下载，目标目录：${result?.target_path ?? ''}`
  if (outcome.status === 'pending' || outcome.status === 'running') return '正在后台提交，请勿重复提交'
  if (outcome.status === 'skipped') return `${result?.reason === 'already_submitted' ? '此目录已有待处理任务' : '库内已存在，已跳过'}：${result?.existing_location ?? ''}`
  return result?.message || '提交失败，请核对任务状态'
}
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function MagnetParser() {
  const cached = useMagnetDraft()
  const { draft, error: cacheError, savedAt, backup, submissionRequest } = cached
  const state = useMagnetStore()
  const { job, history, historyTotal, loadingHistory } = state
  const { text: inputText, targetMode, selectedStorage, selectedGroup, targetPath } = draft
  const groups = useStorageStore((value) => value.groups)
  const storages = useStorageStore((value) => value.storages)
  const setTargetMode = (value: 'direct' | 'group') => updateMagnetDraft({ targetMode: value })
  const setSelectedStorage = (value: string) => updateMagnetDraft({ selectedStorage: value })
  const setSelectedGroup = (value: string) => updateMagnetDraft({ selectedGroup: value })
  const setTargetPath = (value: string) => updateMagnetDraft({ targetPath: value })
  const [cleanedBadge, setCleanedBadge] = useState<{ count: number; trackers: number } | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [readingClipboard, setReadingClipboard] = useState(false)
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null)
  const [savingCode, setSavingCode] = useState<number | null>(null)
  const [checks, setChecks] = useState<{ key: string; items: DuplicateDecision[]; error: string }>({ key: '', items: [], error: '' })
  const [checkVersion, setCheckVersion] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const parsing = isMagnetActive(job)
  const submitting = state.submitting || Boolean(state.activeSubmission)
  const bound = job?.job_id === draft.jobId
  const currentStorage = storages.find((node) => node.id === Number(selectedStorage))
  let normalizedTarget = ''
  try { if (targetPath.trim()) normalizedTarget = normalizeStoragePath(targetPath) } catch { /* 输入完成后再校验。 */ }
  const targetReady = targetMode === 'group' ? groups.some((group) => group.id === Number(selectedGroup)) : Boolean(
    currentStorage?.status === 'work' && normalizedTarget && (normalizedTarget === currentStorage.mount_path ||
      normalizedTarget.startsWith(currentStorage.mount_path.replace(/\/$/, '') + '/')),
  )
  const scope: TargetScope = targetMode === 'group'
    ? { target_group: selectedGroup ? Number(selectedGroup) : undefined }
    : { target_path: normalizedTarget || undefined }
  const scopeKey = JSON.stringify(scope)
  const parsed = bound ? job!.items.filter((item) => draft.indices.includes(item.index) && item.summary && ['completed', 'fallback'].includes(item.status)) : []
  const identitiesKey = JSON.stringify(parsed.map((item) => ({ index: item.index, code: item.summary!.verified_code || item.summary!.dn_code || 'UNKNOWN',
    variant: item.summary!.variant, part_numbers: item.summary!.part_numbers })))
  const checkKey = `${job?.job_id ?? ''}:${job?.revision ?? 0}:${draft.revision}:${scopeKey}:${identitiesKey}:${checkVersion}`
  const checking = parsed.length > 0 && targetReady && checks.key !== checkKey
  const checkError = checks.key === checkKey ? checks.error : ''
  const results = parsed.map((item, position) => ({ ...item.summary!, index: item.index, attempt: item.attempt,
    manual_code: item.manual_code, retry_at: item.retry_at,
    ...(checks.key === checkKey ? checks.items[position] : {}),
  }))
  const outcomes = new Map(job?.outcomes.filter((item) => sameScope(item.scope, scope)).map((item) => [item.index, item]))
  const downloadable = results.filter((item) => !item.duplicate_blocked && !blocked(outcomes.get(item.index)))
  const existingCount = results.filter((item) => item.duplicate_blocked).length
  // 重复信息优先展示：库内已存在的条目排在前面，方便先决定是否保留，原始顺序在同组内保持不变。
  const orderedResults = [...results].sort((left, right) =>
    Number(Boolean(right.duplicate_blocked)) - Number(Boolean(left.duplicate_blocked)) || left.index - right.index)
  const matchedGroups = targetMode === 'group' ? groups.filter((group) => group.id === Number(selectedGroup)) : groups.filter((group) => group.members.some((member) => (
    [member.download_path, ...member.archive_paths].some((root) => normalizedTarget === root || normalizedTarget.startsWith(root.replace(/\/$/, '') + '/'))
  )))

  useEffect(() => {
    if (!parsing && !submitting) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [parsing, submitting])

  useEffect(() => {
    if (!targetReady || identitiesKey === '[]') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const identities = JSON.parse(identitiesKey) as Array<{ index: number; code: string; variant: 'original' | 'C' | 'UC' | 'U'; part_numbers: number[] | null }>
      magnetService.checkDuplicates(identities.map(({ code, variant, part_numbers }) => ({ code, variant, part_numbers })), JSON.parse(scopeKey), controller.signal)
        .then((items) => {
          if (items.length !== identities.length) throw new Error('查重结果不完整，请重试')
          if (!controller.signal.aborted) setChecks({ key: checkKey, items, error: '' })
        }).catch((error) => {
          if (!controller.signal.aborted) setChecks({ key: checkKey, items: [], error: error instanceof Error ? error.message : '查重失败，请重试' })
        })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [scopeKey, identitiesKey, checkKey, targetReady])

  const run = async (action: () => Promise<unknown>) => {
    try { await action() } catch (error) { toast.error(error instanceof Error ? error.message : '操作失败，请重试') }
  }
  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const cleaned = cleanBatchMagnets(event.target.value)
    updateMagnetDraft({ text: cleaned.cleanedText })
    setCleanedBadge(cleaned.totalTrackersRemoved > 0 ? { count: cleaned.totalCleaned, trackers: cleaned.totalTrackersRemoved } : null)
  }
  // 剪贴板内容以新行追加，绝不替换已有草稿，方便手机端连续粘贴。
  const handleReadClipboard = async () => {
    setReadingClipboard(true)
    try {
      const text = await readClipboardText()
      if (text === null) { toast.warning('无法读取剪贴板，请在浏览器允许剪贴板权限后重试，或手动长按粘贴'); return }
      if (!text.trim()) { toast.info('剪贴板没有可粘贴的内容'); return }
      const merged = appendClipboardLines(inputText, text)
      if (merged === inputText) { toast.info('剪贴板内容与现有输入相同，未重复添加'); return }
      if (merged.length > MAX_DRAFT_LENGTH) { toast.warning('剪贴板内容超出草稿容量上限，未写入'); return }
      const added = merged.split('\n').length - inputText.split('\n').filter((line) => line.trim()).length
      const cleaned = cleanBatchMagnets(merged)
      updateMagnetDraft({ text: cleaned.cleanedText })
      setCleanedBadge(cleaned.totalTrackersRemoved > 0 ? { count: cleaned.totalCleaned, trackers: cleaned.totalTrackersRemoved } : null)
      toast.success(`已从剪贴板追加 ${Math.max(added, 1)} 行，原有输入保留`)
    } finally { setReadingClipboard(false) }
  }
  const handleParse = () => {
    const lines = inputText.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length || lines.length > 100) { toast.warning('每次请输入 1 至 100 条磁力链接，每行一条'); return }
    const invalid = lines.findIndex((line) => !cleanMagnetUri(line))
    if (invalid >= 0) { toast.warning(`第 ${invalid + 1} 行磁力无效，Hash 应为 40 位十六进制或 32 位 Base32`); return }
    void run(() => startMagnetParse(targetReady ? scope : {}))
  }
  const submitItems = (indices: number[], force: boolean) => {
    if (!bound || !targetReady || checking || checkError) { toast.warning('请先选择有效下载位置并完成查重'); return }
    void run(() => submitMagnetItems(indices, scope, force))
  }
  const restore = (jobId: string, target: TargetScope) => {
    const storage = [...storages].sort((a, b) => b.mount_path.length - a.mount_path.length).find((node) =>
      target.target_path === node.mount_path || target.target_path?.startsWith(node.mount_path.replace(/\/$/, '') + '/'))
    return restoreMagnetJob(jobId, target, storage ? String(storage.id) : '')
  }
  const handleCopy = async (value: string, index: number) => {
    try { await navigator.clipboard.writeText(value); setCopiedIndex(index); toast.info('磁力链接已复制') }
    catch { toast.error('复制失败，请手动选择磁力链接复制') }
  }
  // 保存手工番号：填了值就改为该番号，留空表示放弃识别，恢复自动识别另有独立按钮。
  const saveManualCode = async (index: number) => {
    if (!bound) return
    const value = (editing?.value ?? '').trim()
    setSavingCode(index)
    try {
      await correctMagnetCode(index, value)
      setEditing(null)
      toast.success(value ? `第 ${index + 1} 条番号已改为 ${value}` : `第 ${index + 1} 条已放弃识别，提交时记为 UNKNOWN`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '修改番号失败，请重试')
    } finally { setSavingCode(null) }
  }
  const resetManualCode = async (index: number) => {
    if (!bound) return
    setSavingCode(index)
    try { await correctMagnetCode(index, null); setEditing(null); toast.success(`第 ${index + 1} 条已恢复自动识别`) }
    catch (error) { toast.error(error instanceof Error ? error.message : '恢复自动识别失败') }
    finally { setSavingCode(null) }
  }
  const elapsed = job ? Math.max(0, Math.floor(((job.finished_at ? Date.parse(job.finished_at) : clock) - Date.parse(job.created_at)) / 1000)) : 0
  const retryable = job?.items.some((item) => ['pending', 'failed', 'fallback'].includes(item.status))

  return (
    <div className="space-y-6">
      <PageHeader title="磁力链接解析工作台" description="磁力草稿自动保存，后台逐条解析元数据，核对后提交离线下载" />
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><Magnet className="h-5 w-5" />磁力链接批量输入</CardTitle>
            {/* 手机端复制后直接连续粘贴：按钮贴近标题，不占据底部操作区。 */}
            <Button variant="outline" size="sm" onClick={() => void handleReadClipboard()} disabled={readingClipboard || state.starting}
              className="h-8 gap-1.5 px-2.5 text-xs">
              {readingClipboard ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
              {readingClipboard ? '读取中…' : '读取剪贴板'}
            </Button>
          </div>
          <p role="status" className={`text-xs ${cacheError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {cacheError || (savedAt ? `草稿已保存到本机 · ${dateLabel(new Date(savedAt).toISOString())}` : '输入会自动保存，刷新或重新登录后可继续。')}
          </p>
          {cleanedBadge && <p className="text-xs text-muted-foreground">已净化 {cleanedBadge.count} 条链接，移除 {cleanedBadge.trackers} 个 Tracker</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea aria-label="磁力链接，每行一条" placeholder="粘贴磁力链接，每行一条，最多 100 条" value={inputText}
            maxLength={MAX_DRAFT_LENGTH} onChange={handleInputChange} className="min-h-40 font-mono text-xs leading-relaxed" />
          <div className="space-y-4 rounded-lg border p-3 sm:p-4">
            <fieldset disabled={submitting || parsing}>
              <legend id="target-mode-label" className="mb-2 text-sm font-medium">下载位置</legend>
              <RadioGroup name="target-mode" value={targetMode} disabled={submitting || parsing} aria-labelledby="target-mode-label"
                onValueChange={(value) => { if (value === 'direct' || value === 'group') setTargetMode(value) }}
                className="flex flex-wrap gap-x-5 gap-y-2">
                <Label htmlFor="target-mode-direct" className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem id="target-mode-direct" value="direct" />选择 OpenList 存储与目录
                </Label>
                <Label htmlFor="target-mode-group" className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem id="target-mode-group" value="group" />分组自动选盘
                </Label>
              </RadioGroup>
            </fieldset>
            {targetMode === 'direct' ? <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="download-storage" className="text-sm font-medium">OpenList 存储</Label>
                <select id="download-storage" value={selectedStorage} disabled={submitting || parsing}
                  className="native-select font-mono"
                  onChange={(event) => { setSelectedStorage(event.target.value); setTargetPath('') }}>
                  <option value="">{storages.length ? '请选择挂载存储' : '暂无可用挂载，请检查连接与忽略项'}</option>
                  {storages.map((node) => <option key={node.id} value={node.id} disabled={node.status !== 'work'}>{node.mount_path} · {node.driver}{node.status !== 'work' ? '（不可用）' : ''}</option>)}
                </select>
              </div>
              {currentStorage && groups.some((group) => group.members.some((member) => member.storage_id === currentStorage.id || member.storage_mount === currentStorage.mount_path)) && <div className="space-y-1.5">
                <Label htmlFor="saved-download-path" className="text-sm font-medium">使用分组中已配置的下载目录</Label>
                <select id="saved-download-path" value="" onChange={(event) => setTargetPath(event.target.value)} disabled={submitting || parsing}
                  className="native-select">
                  <option value="">选择常用目录…</option>
                  {groups.flatMap((group) => group.members.filter((member) => member.storage_id === currentStorage.id || member.storage_mount === currentStorage.mount_path)
                    .map((member) => <option key={group.id + '-' + member.id} value={member.download_path}>{group.name} · {member.download_path}</option>))}
                </select>
              </div>}
              <StorageDirectoryField label="下载目录" storageId={currentStorage?.id ?? null} mountPath={currentStorage?.mount_path ?? ''}
                value={targetPath} onChange={setTargetPath} allowRoot disabled={submitting || parsing} />
              {targetPath && !targetReady && <p className="text-xs text-destructive">请选择所选挂载内的有效绝对目录。</p>}
            </div> : <div className="space-y-1.5">
              <Label htmlFor="download-group" className="text-sm font-medium">存储分组</Label>
              <select id="download-group" value={selectedGroup} disabled={submitting || parsing} onChange={(event) => setSelectedGroup(event.target.value)}
                className="native-select">
                <option value="">{groups.length ? '请选择分组' : '请先在存储页面创建分组'}</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">按完整种子大小选择空间足够的成员，使用该成员已保存的下载目录。</p>
            </div>}
            {targetReady && <p className="text-xs text-muted-foreground">
              {matchedGroups.length ? '查重范围：' + matchedGroups.map((group) => group.name).join('、') + ' 的全部下载与归档目录。'
                : '此目录尚未纳入分组，当前仅检查该目录内的索引；如需跨盘查重，请先配置分组。'}
            </p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {backup && <Button variant="ghost" className="min-h-11 gap-1" onClick={() => {
              if (magnetDraft.undo()) { void refreshMagnets(); toast.info('已撤销恢复，找回原草稿') }
            }}><Undo2 className="h-4 w-4" />撤销恢复</Button>}
            {inputText && <Button variant="ghost" className="min-h-11" onClick={() => { updateMagnetDraft({ text: '' }); setCleanedBadge(null) }}>清空</Button>}
            <Button onClick={handleParse} disabled={state.starting || state.jobs.some(isMagnetActive) || parsing || !inputText.trim()} className="min-h-11 gap-2">
              {state.starting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {state.starting ? '正在创建解析任务…' : '开始解析'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}；已保存的输入与任务不会清除。</p>}
      {job && (parsing || bound) && <Card><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p role="status" className="font-medium">{job.cancel_requested && parsing ? '正在停止解析' : parsing ? '后台解析中' : job.status === 'cancelled' ? '解析已停止' : '解析完成'} · {job.completed}/{job.total}</p>
            <p className="text-xs text-muted-foreground">已确认元数据 {job.confirmed} 条 · 名称初筛 {job.fallback} 条 · 失败 {job.failed} 条 · 已用 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!bound && <Button variant="outline" className="min-h-11" onClick={() => void run(() => restore(job.job_id, job.scope))}>恢复此批输入</Button>}
            {parsing ? <Button variant="outline" className="min-h-11" disabled={state.changing || job.cancel_requested}
              onClick={() => void run(() => changeMagnetParse('cancel'))}>停止解析</Button> : retryable && <Button variant="outline" className="min-h-11"
                disabled={state.changing || submitting} onClick={() => void run(() => changeMagnetParse('resume'))}>继续未完成 / 重试失败项</Button>}
          </div>
        </div>
        <Progress value={job.total ? job.completed / job.total * 100 : 0} aria-label="磁力解析进度" />
        {parsing && <p className="text-xs text-muted-foreground">逐条等待元数据返回，可能持续较长时间。可切页或关闭浏览器，回来继续查看。
          {job.items.some((item) => item.status === 'running') && ` 正在等待第 ${job.items.filter((item) => item.status === 'running').map((item) => item.index + 1).join('、')} 条。`}
        </p>}
      </CardContent></Card>}

      {(history.length > 0 || state.jobs.length > 0) && <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-5 w-5" />最近记录</CardTitle>
          <p className="text-xs text-muted-foreground">按账号保存完整批次，点击恢复输入；已提交和待核实的状态会保留。</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-110 space-y-2 overflow-y-auto">
            {history.map((record) => <div key={record.submission_id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{dateLabel(record.created_at)} · {record.total} 条{isMagnetActive(record) ? ' · 提交中' : ''}</p>
                <p className="text-xs text-muted-foreground">已提交 {record.submitted} · 跳过 {record.skipped} · 失败 {record.failed} · 待核实 {record.unknown}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{record.scope.target_path || `分组 ${record.scope.target_group}`}</p>
              </div>
              <Button variant="outline" className="min-h-11 shrink-0" onClick={() => void run(() => restore(record.job_id, record.scope))}>恢复输入</Button>
            </div>)}
          </div>
          {history.length < historyTotal && <Button variant="ghost" className="min-h-11" disabled={loadingHistory} onClick={() => void run(loadMoreMagnetHistory)}>加载更多记录</Button>}
          {state.jobs.length > 0 && <details className="rounded-md border px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm">最近解析批次（含未提交的批次）</summary>
            <div className="space-y-2 pb-3">{state.jobs.map((record) => <div key={record.job_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{dateLabel(record.created_at)} · {record.completed}/{record.total} 条{isMagnetActive(record) ? ' · 解析中' : ''}</span>
              <Button variant="ghost" className="min-h-11" onClick={() => void run(() => restore(record.job_id, record.scope))}>恢复该批次</Button>
            </div>)}</div>
          </details>}
        </CardContent>
      </Card>}

      {submissionRequest && !submissionRequest.submissionId && !state.submitting && submissionRequest.jobId === job?.job_id && <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <span>正在核实上一次提交是否已受理，草稿已保留。</span>
        <Button variant="outline" className="min-h-11" onClick={() => void run(() => submitMagnetItems(submissionRequest.indices, submissionRequest.scope, submissionRequest.force))}>重试确认提交</Button>
      </div>}
      {bound && job!.items.some((item) => item.status === 'failed') && <Card><CardContent className="space-y-3 p-4">
        <p className="text-sm font-medium">解析失败，输入已保留</p>
        {job!.items.filter((item) => item.status === 'failed').map((item) => <p key={item.index} className="text-sm text-destructive">第 {item.index + 1} 行：{item.error_message}</p>)}
        <p className="text-xs text-muted-foreground">请先确认元数据服务地址与健康状态，再重试失败项；已确认的条目不会被重复请求。</p>
        {!parsing && <Button variant="outline" className="min-h-11 gap-1" disabled={state.changing}
          onClick={() => void run(() => changeMagnetParse('resume', job!.items.filter((item) => item.status === 'failed').map((item) => item.index)))}>
          <RotateCcw className="h-4 w-4" />仅重试失败项（{job!.items.filter((item) => item.status === 'failed').length}）
        </Button>}
      </CardContent></Card>}

        {results.length > 0 && <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">解析结果（{results.length} 项）</h2>
            <p className="text-xs text-muted-foreground">{!targetReady ? '请选择有效下载位置，已失效的位置需要重新选择' : checking ? '正在核对所选目录的重复记录…' : `可提交 ${downloadable.length} 项，重复拦截 ${existingCount} 项`}</p>
            {existingCount > 0 && <p className="text-xs text-muted-foreground">重复项已置顶显示；批次结束后默认从输入框移除，可在解析结果中继续强制下载。</p>}
          </div>
          {downloadable.length > 0 && <Button onClick={() => submitItems(downloadable.map((item) => item.index), false)}
            disabled={submitting || Boolean(submissionRequest) || parsing || !targetReady || checking || Boolean(checkError)} className="min-h-11 gap-2">
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {submitting ? '后台提交中…' : `提交可下载项（${downloadable.length}）`}
          </Button>}
        </div>
        {checkError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{checkError}</span>
          <Button variant="outline" className="min-h-11" onClick={() => setCheckVersion((value) => value + 1)}>重试查重</Button>
        </div>}
        {orderedResults.map((item) => {
          const outcome = outcomes.get(item.index)
          return <Card key={`${job!.job_id}-${item.index}`}><CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">第 {item.index + 1} 条</span>
                <span className="font-mono text-lg font-bold">{item.verified_code || item.dn_code || '未识别番号'}</span>
                <Badge variant="secondary">{variantLabel(item.variant)}</Badge>
                {item.manual_code != null && <Badge variant="outline">手工番号</Badge>}
                {!targetReady || checking ? <Badge variant="outline">待核对下载位置</Badge> : item.duplicate_allowed ? <Badge variant="success">分集或版本可共存</Badge> : item.duplicate_blocked ?
                  <Badge variant="warning"><AlertTriangle className="mr-1 h-3.5 w-3.5" />库内已存在</Badge> : <Badge variant="outline">库内未收录</Badge>}
                {(outcome?.status === 'submitted' || outcome?.result?.reason === 'already_submitted') && <Badge variant="info"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />已提交</Badge>}
                {outcome?.status === 'unknown' && <Badge variant="warning">提交待核实</Badge>}
                {item.metadata_fallback && <Badge variant="outline">{fallbackLabels[item.fallback_reason ?? ''] ?? '元数据不可用'} · 名称初筛</Badge>}
                {item.retry_at && <Badge variant="outline"><RotateCcw className="mr-1 h-3.5 w-3.5" />等待重试</Badge>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="min-h-11 gap-1" onClick={() => void handleCopy(item.cleaned_magnet, item.index)}>
                  {copiedIndex === item.index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}复制磁力
                </Button>
                {bound && <Button variant="ghost" size="sm" className="min-h-11 gap-1" disabled={parsing || savingCode === item.index}
                  onClick={() => setEditing(editing?.index === item.index ? null : { index: item.index, value: item.verified_code || item.dn_code || '' })}>
                  <Pencil className="h-4 w-4" />改番号
                </Button>}
                {item.duplicate_blocked && !blocked(outcome) && <Button variant="outline" size="sm" className="min-h-11"
                  disabled={submitting || Boolean(submissionRequest) || parsing || checking || !targetReady || Boolean(checkError)} onClick={() => submitItems([item.index], true)}>强制下载此版</Button>}
              </div>
            </div>
            {item.existing_location && <p className="break-all font-mono text-xs text-muted-foreground">库内路径：{item.existing_location}</p>}
            {editing?.index === item.index && <div className="space-y-2 rounded-lg border p-3">
              <Label htmlFor={`manual-code-${item.index}`} className="text-sm font-medium">手工番号</Label>
              <p className="text-xs text-muted-foreground">填写后立即重算版本、分集与查重；留空保存表示放弃识别（提交时记为 UNKNOWN）。</p>
              <div className="flex flex-wrap gap-2">
                <Input id={`manual-code-${item.index}`} value={editing.value} maxLength={64} autoComplete="off" spellCheck={false}
                  onChange={(event) => setEditing({ index: item.index, value: event.target.value })}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveManualCode(item.index) }}
                  placeholder="例如 300MIUM-777"
                  className="min-h-11 min-w-0 flex-1 font-mono text-sm" />
                <Button className="min-h-11" disabled={savingCode === item.index} onClick={() => void saveManualCode(item.index)}>
                  {savingCode === item.index ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}保存
                </Button>
                {item.manual_code != null && <Button variant="outline" className="min-h-11" disabled={savingCode === item.index}
                  onClick={() => void resetManualCode(item.index)}>恢复自动识别</Button>}
                <Button variant="ghost" className="min-h-11" onClick={() => setEditing(null)}>取消</Button>
              </div>
            </div>}
            {item.manual_code != null && editing?.index !== item.index && <p className="text-xs text-muted-foreground">
              番号由手工指定{item.manual_code === '' ? '（已放弃识别，提交时记为 UNKNOWN）' : `：${item.manual_code}`}，重新解析该条目时保留。
            </p>}
            {item.retry_at && <p role="status" className="text-xs text-muted-foreground">
              元数据服务暂不可用，将在 {dateLabel(item.retry_at)} 自动重试（第 {item.attempt} 次尝试）。
            </p>}
            {outcome && <p role="status" className={`break-all text-sm ${['failed', 'unknown'].includes(outcome.status) ? 'text-destructive' : 'text-muted-foreground'}`}>
              {outcomeMessage(outcome)}{outcome.status === 'unknown' && <Link className="ml-2 underline" to="/tasks">查看任务核实</Link>}
            </p>}
            <p className="break-all rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">{item.cleaned_magnet}</p>
            <p className="text-xs text-muted-foreground">完整下载大小：<span className="font-mono">{formatBytes(item.metadata_fallback ? null : item.total_size)}</span>
              {' · '}{item.metadata_fallback ? '可指定目录继续下载；自动调度需要完整大小。' : `共 ${item.total_files_count} 个文件。过滤仅用于识别与展示，下载包含全部文件。`}</p>
            <LazyMagnetFiles key={`${job!.job_id}-${item.index}-${item.attempt}`} jobId={job!.job_id} index={item.index} attempt={item.attempt} />
          </CardContent></Card>
        })}
      </div>}
      {results.length === 0 && !parsing && <EmptyState title="等待解析磁力" description="粘贴新磁力，或点击最近记录恢复输入" />}
    </div>
  )
}

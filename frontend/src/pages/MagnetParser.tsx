import React, { useState, useEffect, useRef } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { FileTree } from '@/components/common/FileTree'
import { EmptyState } from '@/components/common/EmptyState'
import { Magnet, Zap, Download, AlertTriangle, CheckCircle2, Copy, Check, RefreshCw } from 'lucide-react'
import { cleanBatchMagnets, cleanMagnetUri } from '@/lib/magnet'
import { normalizeStoragePath } from '@/lib/path'
import { formatBytes } from '@/lib/format'
import { magnetService } from '@/services/magnet.service'
import { storageService } from '@/services/storage.service'
import { toast } from '@/stores/uiStore'
import type { MagnetParseItem, MagnetParseResponse, StorageGroup } from '@/types/api'

type SubmissionOutcome = {
  state: 'submitted' | 'failed' | 'unknown' | 'already_exists'
  message: string
}

const fallbackLabels: Record<string, string> = {
  bt_metadata_timeout: '元数据解析超时',
  bt_metadata_unavailable: '元数据服务不可用',
  bt_metadata_invalid_request: '解析服务拒绝该链接',
  bt_metadata_invalid_response: '元数据响应无效',
}

export function MagnetParser() {
  const [inputText, setInputText] = useState('')
  const [cleanedBadge, setCleanedBadge] = useState<{ count: number; trackers: number } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<MagnetParseItem[]>([])
  const [parseErrors, setParseErrors] = useState<NonNullable<MagnetParseResponse['errors']>>([])
  const [outcomes, setOutcomes] = useState<Record<string, SubmissionOutcome>>({})
  const [groups, setGroups] = useState<StorageGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const parseController = useRef<AbortController | null>(null)

  useEffect(() => {
    storageService.getGroups().then(setGroups).catch((error) => {
      toast.error(error instanceof Error ? error.message : '加载存储分组失败')
    })
    return () => parseController.current?.abort()
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value
    const cleaned = cleanBatchMagnets(raw)
    setInputText(cleaned.totalTrackersRemoved > 0 ? cleaned.cleanedText : raw)
    setCleanedBadge(cleaned.totalTrackersRemoved > 0
      ? { count: cleaned.totalCleaned, trackers: cleaned.totalTrackersRemoved } : null)
  }

  const handleParse = async () => {
    const lines = inputText.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0 || lines.length > 100) {
      toast.warning('每次请输入 1 至 100 条磁力链接，每行一条')
      return
    }
    const invalidIndex = lines.findIndex((line) => !cleanMagnetUri(line))
    if (invalidIndex !== -1) {
      toast.warning(`第 ${invalidIndex + 1} 行磁力无效，Hash 应为 40 位十六进制或 32 位 Base32`)
      return
    }
    const controller = new AbortController()
    parseController.current = controller
    setParsing(true)
    setParseErrors([])
    try {
      const data = await magnetService.parseMagnets(lines, controller.signal)
      setResults(data.results)
      setParseErrors(data.errors ?? [])
      const fallbackCount = data.results.filter((item) => item.metadata_fallback).length
      if (data.results.length) toast.success(`解析返回 ${data.results.length} 项，其中 ${fallbackCount} 项仅有名称信息`)
      if (data.errors?.length) toast.warning(`${data.errors.length} 条解析请求失败，详情见下方`)
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : '解析失败')
    } finally {
      if (parseController.current === controller) {
        parseController.current = null
        setParsing(false)
      }
    }
  }

  const isBlocked = (item: MagnetParseItem) => {
    const state = outcomes[item.cleaned_magnet]?.state
    return state === 'submitted' || state === 'unknown'
  }

  const submitItems = async (items: MagnetParseItem[], force: boolean) => {
    if (!items.length) return
    setSubmitting(true)
    try {
      const target = targetPath.trim() ? normalizeStoragePath(targetPath) : undefined
      const response = await magnetService.submitBatchDownload(items.map((item) => ({
        magnet: item.cleaned_magnet,
        code: item.verified_code || item.dn_code || 'UNKNOWN',
        force,
        target_path: target,
        target_group: target ? undefined : selectedGroup ? Number(selectedGroup) : undefined,
      })))
      const changes: Record<string, SubmissionOutcome> = {}
      for (const item of response.submitted) {
        changes[item.magnet] = { state: 'submitted', message: `已提交离线下载，目标目录：${item.target_path}` }
      }
      for (const item of response.skipped) {
        changes[item.magnet] = {
          state: item.reason === 'already_submitted' ? 'submitted' : 'already_exists',
          message: item.reason === 'already_submitted'
            ? `该磁力在此目录已有待处理任务：${item.existing_location}`
            : `库内已存在，已跳过：${item.existing_location}`,
        }
      }
      for (const item of response.failed) {
        changes[item.magnet] = {
          state: item.reason === 'submission_unknown' ? 'unknown' : 'failed',
          message: item.message,
        }
      }
      setOutcomes((previous) => ({ ...previous, ...changes }))
      // 只有服务端确认库内存在，才更新入库标记；提交成功仅改变提交状态。
      setResults((previous) => previous.map((item) => {
        const existing = response.skipped.find((skip) => skip.magnet === item.cleaned_magnet && skip.reason === 'already_exists')
        return existing ? { ...item, exists_in_library: true, existing_location: existing.existing_location } : item
      }))
      const message = `已提交 ${response.submitted.length} 项，跳过 ${response.skipped.length} 项，失败或待核实 ${response.failed.length} 项`
      if (response.failed.length) toast.warning(message)
      else toast.success(message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交下载失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedIndex(index)
      toast.info('磁力链接已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动选择磁力链接复制')
    }
  }

  const downloadable = results.filter((item) => !item.exists_in_library && !isBlocked(item))
  const existingCount = results.filter((item) => item.exists_in_library).length

  return (
    <div className="space-y-6">
      <PageHeader title="磁力链接解析工作台" description="批量解析磁力元数据，核对番号与库内记录后提交离线下载" />
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Magnet className="h-5 w-5" />磁力链接批量输入
          </CardTitle>
          {cleanedBadge && (
            <p className="text-xs text-muted-foreground">
              已净化 {cleanedBadge.count} 条链接，移除 {cleanedBadge.trackers} 个 Tracker
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            aria-label="磁力链接，每行一条"
            placeholder="粘贴磁力链接，每行一条，最多 100 条"
            value={inputText}
            disabled={parsing || submitting}
            onChange={handleInputChange}
            className="min-h-[130px] font-mono text-xs leading-relaxed"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="download-target" className="text-sm font-medium">下载目录（可选）</label>
              <Input
                id="download-target"
                placeholder="例如 /网盘/视频"
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                disabled={submitting}
                maxLength={1024}
                className="min-h-[44px] font-mono"
              />
              <p className="text-xs text-muted-foreground">直接下载到该目录，不追加番号目录。留空时按分组容量自动选择。</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="download-group" className="text-sm font-medium">自动调度分组</label>
              <select
                id="download-group"
                value={selectedGroup}
                onChange={(event) => setSelectedGroup(event.target.value)}
                disabled={Boolean(targetPath.trim()) || submitting}
                className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                <option value="">{groups.length ? '默认分组' : '暂无分组，请指定下载目录'}</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}（{group.paths.length} 个目录）</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {inputText && (
              <Button variant="ghost" disabled={parsing || submitting} className="min-h-[44px]" onClick={() => {
                setInputText('')
                setResults([])
                setParseErrors([])
                setCleanedBadge(null)
              }}>清空</Button>
            )}
            {parsing && <Button variant="outline" className="min-h-[44px]" onClick={() => parseController.current?.abort()}>停止解析</Button>}
            <Button onClick={handleParse} disabled={parsing || submitting || !inputText.trim()} className="min-h-[44px] gap-2">
              {parsing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {parsing ? '解析中…' : '开始解析'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {parseErrors.length > 0 && (
        <Card><CardContent className="space-y-2 p-4">
          <p className="text-sm font-medium">解析失败</p>
          {parseErrors.map((error) => <p key={error.index} className="break-all text-sm text-destructive">第 {error.index + 1} 行：{error.message}</p>)}
        </CardContent></Card>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">解析结果（{results.length} 项）</h2>
              <p className="text-xs text-muted-foreground">可提交 {downloadable.length} 项，库内已存在 {existingCount} 项</p>
            </div>
            {downloadable.length > 0 && (
              <Button onClick={() => submitItems(downloadable, false)} disabled={submitting || parsing} className="min-h-[44px] gap-2">
                {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {submitting ? '提交中…' : `提交可下载项（${downloadable.length}）`}
              </Button>
            )}
          </div>
          {results.map((item, index) => {
            const outcome = outcomes[item.cleaned_magnet]
            return (
              <Card key={`${item.cleaned_magnet}-${index}`}>
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-bold">{item.verified_code || item.dn_code || '未识别番号'}</span>
                      {item.exists_in_library ? (
                        <Badge variant="warning" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />库内已存在</Badge>
                      ) : <Badge variant="outline">库内未收录</Badge>}
                      {outcome?.state === 'submitted' && <Badge variant="info" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />已提交</Badge>}
                      {outcome?.state === 'unknown' && <Badge variant="warning">提交待核实</Badge>}
                      {item.metadata_fallback && <Badge variant="outline">{fallbackLabels[item.fallback_reason ?? ''] ?? '元数据不可用'} · 名称初筛</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="min-h-[44px] gap-1" onClick={() => handleCopy(item.cleaned_magnet, index)}>
                        {copiedIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}复制磁力
                      </Button>
                      {item.exists_in_library && !isBlocked(item) && (
                        <Button variant="outline" size="sm" disabled={submitting || parsing} className="min-h-[44px]" onClick={() => submitItems([item], true)}>强制下载此版</Button>
                      )}
                    </div>
                  </div>
                  {item.existing_location && <p className="break-all font-mono text-xs text-muted-foreground">库内路径：{item.existing_location}</p>}
                  {outcome && <p role="status" className={`break-all text-sm ${outcome.state === 'failed' || outcome.state === 'unknown' ? 'text-destructive' : 'text-muted-foreground'}`}>{outcome.message}</p>}
                  <p className="break-all rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">{item.cleaned_magnet}</p>
                  <p className="text-xs text-muted-foreground">
                    完整下载大小：<span className="font-mono">{formatBytes(item.metadata_fallback ? null : item.total_size)}</span>
                    {' · '}{item.metadata_fallback ? '可指定目录继续下载；自动调度需要完整大小。' : `共 ${item.total_files_count} 个文件。过滤规则仅用于番号识别与展示，下载包含全部文件。`}
                  </p>
                  <FileTree files={item.files} filteredFiles={item.filtered_files} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      {results.length === 0 && !parsing && <EmptyState title="等待解析磁力" description="粘贴磁力链接，解析后选择下载目录或存储分组" />}
    </div>
  )
}

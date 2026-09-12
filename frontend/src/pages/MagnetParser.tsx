import React, { useState, useEffect } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { FileTree } from '@/components/common/FileTree'
import { EmptyState } from '@/components/common/EmptyState'
import {
  Magnet,
  Zap,
  Download,
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react'
import { cleanBatchMagnets } from '@/lib/magnet'
import { magnetService } from '@/services/magnet.service'
import { storageService } from '@/services/storage.service'
import { toast } from '@/stores/uiStore'
import type { MagnetParseItem, StorageGroup } from '@/types/api'

export function MagnetParser() {
  const [inputText, setInputText] = useState('')
  const [cleanedBadge, setCleanedBadge] = useState<{ count: number; trackers: number } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<MagnetParseItem[]>([])
  const [groups, setGroups] = useState<StorageGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  // 加载存储分组供选择
  useEffect(() => {
    storageService.getGroups().then((data) => {
      setGroups(data || [])
      if (data && data.length > 0) {
        setSelectedGroup(data[0].name)
      }
    }).catch(() => {})
  }, [])

  // 输入变化时：触发前端即时清洗 Tracker
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value
    setInputText(raw)

    if (raw.includes('&tr=') || raw.includes('&TR=')) {
      const { cleanedText, totalCleaned, totalTrackersRemoved } = cleanBatchMagnets(raw)
      if (totalTrackersRemoved > 0) {
        setInputText(cleanedText)
        setCleanedBadge({ count: totalCleaned, trackers: totalTrackersRemoved })
        setTimeout(() => setCleanedBadge(null), 4000)
      }
    }
  }

  // 触发解析 (调用后端 magnet-metadata-api)
  const handleParse = async () => {
    const lines = inputText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.toLowerCase().startsWith('magnet:?'))

    if (lines.length === 0) {
      toast.warning('请输入至少一条以 magnet:? 开头的磁力链接')
      return
    }

    setParsing(true)
    try {
      const data = await magnetService.parseMagnets(lines)
      setResults(data.results || [])
      toast.success(`成功解析 ${data.results?.length || 0} 条磁力元数据`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '解析失败'
      toast.error(msg)
    } finally {
      setParsing(false)
    }
  }

  // 提交可下载项 (过滤掉库内已存在的项)
  const handleSubmitDownloadable = async () => {
    const downloadable = results.filter((r) => !r.exists_in_library)
    if (downloadable.length === 0) {
      toast.warning('没有可供下载的新番号项')
      return
    }

    setSubmitting(true)
    try {
      const tasks = downloadable.map((item) => ({
        magnet: item.cleaned_magnet,
        code: item.verified_code || item.dn_code || 'UNKNOWN',
        force: false,
        target_group: selectedGroup || undefined,
      }))
      const res = await magnetService.submitBatchDownload(tasks)
      toast.success(`成功提交 ${res.submitted.length} 项离线下载`)
      // 成功提交后将已提交项从列表中移除或更新状态
      setResults((prev) =>
        prev.map((item) => {
          const matched = res.submitted.find((s) => s.code === (item.verified_code || item.dn_code))
          return matched ? { ...item, exists_in_library: true } : item
        })
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交下载失败'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // 单条或全部强制下载 (绕过去重拦截，适用于字幕版/高清修复版)
  const handleForceDownload = async (item: MagnetParseItem) => {
    setSubmitting(true)
    try {
      const tasks = [
        {
          magnet: item.cleaned_magnet,
          code: item.verified_code || item.dn_code || 'UNKNOWN',
          force: true,
          target_group: selectedGroup || undefined,
        },
      ]
      const res = await magnetService.submitBatchDownload(tasks)
      if (res.submitted.length > 0) {
        toast.success(`已强制下发离线任务: ${res.submitted[0].code}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '强制下载提交失败'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
    toast.info('磁力链接已复制到剪贴板')
  }

  const newItemsCount = results.filter((r) => !r.exists_in_library).length
  const skippedItems = results.filter((r) => r.exists_in_library)

  return (
    <div className="space-y-6">
      <PageHeader
        title="磁力链接解析工作台"
        description="支持多行粘贴，前端即时净化 Tracker，对接 DHT 元数据深度复核番号与库内去重"
      />

      {/* 输入与控制卡片 */}
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Magnet className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base">磁力链接批量输入</CardTitle>
          </div>
          {cleanedBadge && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium animate-in fade-in zoom-in-95">
              <Zap className="h-3.5 w-3.5 text-emerald-600" />
              <span>
                已自动净化 {cleanedBadge.count} 条链接，剔除 {cleanedBadge.trackers} 个 Tracker
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="relative">
            <Textarea
              placeholder="在此粘贴一行或多行磁力链接&#10;magnet:?xt=urn:btih:...&dn=MIDV-123&#10;前端将在输入时立即剔除冗余 BT Tracker 服务器，保持链接纯净"
              value={inputText}
              onChange={handleInputChange}
              className="min-h-[130px] font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-xs font-medium text-slate-600 shrink-0">存储分组:</span>
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer w-full sm:w-auto"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name} ({g.paths.length} 挂载点)
                  </option>
                ))}
                {groups.length === 0 && <option value="">默认存储池</option>}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {inputText && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInputText('')
                    setResults([])
                  }}
                  className="text-xs text-slate-500"
                >
                  清空
                </Button>
              )}
              <Button
                onClick={handleParse}
                disabled={parsing || !inputText.trim()}
                className="gap-2 min-w-[110px]"
              >
                {parsing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    解析中...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    开始解析
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 解析结果区域 */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                解析结果清单 ({results.length} 项)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                可下载新项: <span className="font-semibold text-emerald-600">{newItemsCount}</span> 部，
                库内已存在: <span className="font-semibold text-amber-600">{skippedItems.length}</span> 部
              </p>
            </div>

            {newItemsCount > 0 && (
              <Button
                onClick={handleSubmitDownloadable}
                disabled={submitting}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    一键投递可下载项 ({newItemsCount})
                  </>
                )}
              </Button>
            )}
          </div>

          {/* 卡片列表 */}
          <div className="grid grid-cols-1 gap-4">
            {results.map((item, index) => {
              const code = item.verified_code || item.dn_code || '未识别番号'
              const isDuplicated = item.exists_in_library

              return (
                <Card
                  key={`${item.cleaned_magnet}-${index}`}
                  className={`border transition-all ${
                    isDuplicated ? 'border-amber-200/80 bg-amber-50/20' : 'border-slate-200 bg-white'
                  }`}
                >
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    {/* 头部：番号与状态 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-mono text-base sm:text-lg font-bold text-slate-900">
                          {code}
                        </span>

                        {isDuplicated ? (
                          <Badge variant="warning" className="gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            库内已存在
                          </Badge>
                        ) : (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            新番号 · 可下载
                          </Badge>
                        )}

                        {item.metadata_fallback && (
                          <Badge variant="outline" className="text-slate-500 text-[10px]">
                            DHT超时 · 名称初筛
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(item.cleaned_magnet, index)}
                          className="h-8 px-2 text-xs text-slate-500 gap-1"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          复制磁力
                        </Button>

                        {/* 针对重复项提供强制下载按钮 */}
                        {isDuplicated && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={submitting}
                            onClick={() => handleForceDownload(item)}
                            className="h-8 text-xs text-amber-700 border-amber-300 hover:bg-amber-100 gap-1"
                          >
                            <Download className="h-3.5 w-3.5" />
                            强制下载此版
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 已存在位置提示 */}
                    {isDuplicated && item.existing_location && (
                      <div className="p-2.5 rounded-lg bg-amber-100/60 border border-amber-200/80 text-xs font-mono text-amber-900 truncate">
                        ⚠️ 库内收录路径: {item.existing_location}
                      </div>
                    )}

                    {/* 清洗后磁力链接展示 */}
                    <p className="text-xs font-mono text-slate-400 break-all bg-slate-50 p-2 rounded-lg">
                      {item.cleaned_magnet}
                    </p>

                    {/* 文件列表树 */}
                    <FileTree files={item.files} filteredFiles={item.filtered_files} />
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {results.length === 0 && !parsing && (
        <EmptyState
          title="等待解析磁力"
          description="将磁力链接粘贴至上方输入框后点击【开始解析】，系统将自动清洗并检索 OpenList 媒体库"
        />
      )}
    </div>
  )
}

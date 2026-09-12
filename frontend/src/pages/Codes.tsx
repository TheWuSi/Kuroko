import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/common/EmptyState'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Film,
  Search,
  Radar,
  Trash2,
  HardDrive,
  Copy,
  Check,
  Loader2,
} from 'lucide-react'
import { codeService } from '@/services/code.service'
import { storageService } from '@/services/storage.service'
import { formatBytes } from '@/lib/format'
import { toast } from '@/stores/uiStore'
import type { CodeRecord, ScanJobStatus, StorageGroup } from '@/types/api'

export function Codes() {
  const [codes, setCodes] = useState<CodeRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // 扫描控制抽屉
  const [scanOpen, setScanOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanJobStatus | null>(null)
  const [groups, setGroups] = useState<StorageGroup[]>([])
  const [selectedScanGroup, setSelectedScanGroup] = useState<number | undefined>(undefined)

  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // 搜索防抖
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(handler)
  }, [search])

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await codeService.getCodes({
        search: debouncedSearch || undefined,
        page,
        page_size: 24,
      })
      setCodes(res.items || [])
      setTotal(res.total || 0)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取番号列表失败'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, page])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  // 加载存储分组供扫描选择
  useEffect(() => {
    storageService.getGroups().then((res) => setGroups(res || [])).catch(() => {})
  }, [])

  // 触发定向扫描
  const handleStartScan = async () => {
    setScanning(true)
    try {
      const res = await codeService.startScan(selectedScanGroup)
      toast.success('定向探测扫描已启动')
      pollScanStatus(res.task_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '启动扫描失败'
      toast.error(msg)
      setScanning(false)
    }
  }

  // 轮询扫描状态
  const pollScanStatus = (taskId?: string) => {
    const timer = setInterval(async () => {
      try {
        const status = await codeService.getScanStatus(taskId)
        setScanStatus(status)
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(timer)
          setScanning(false)
          fetchCodes()
          if (status.status === 'completed') {
            toast.success(`扫描完成，新发现 ${status.new_codes_found} 个番号`)
          } else {
            toast.error(`扫描异常: ${status.error_message || '未知原因'}`)
          }
        }
      } catch {
        clearInterval(timer)
        setScanning(false)
      }
    }, 1500)
  }

  // 删除番号
  const handleDeleteCode = async (code: string) => {
    if (!confirm(`确定要从统计表中移除番号 ${code} 吗？`)) return
    try {
      await codeService.deleteCode(code)
      toast.success(`番号 ${code} 已移除`)
      fetchCodes()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败'
      toast.error(msg)
    }
  }

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
    toast.info(`番号 ${code} 已复制`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="番号媒体库归档"
        description={`共计收录 ${total} 部番号资产，支持定向探测与离线下载自动增量入库`}
      >
        <Button
          onClick={() => {
            setScanOpen(true)
            codeService.getScanStatus().then((s) => setScanStatus(s)).catch(() => {})
          }}
          className="gap-2 bg-blue-600 hover:bg-blue-700"
        >
          <Radar className="h-4 w-4" />
          定向探测扫描
        </Button>
      </PageHeader>

      {/* 搜索与过滤工具栏 */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="按番号代码搜索，如 ABC-123..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 font-mono text-sm"
          />
        </div>
        <div className="text-xs text-slate-500 font-mono self-start sm:self-auto">
          第 {page} 页 / 共 {Math.ceil(total / 24) || 1} 页
        </div>
      </div>

      {/* 番号网格卡片流 */}
      {codes.length === 0 && !loading ? (
        <EmptyState
          title="未找到番号记录"
          description={search ? '没有匹配该关键词的番号' : '暂无收录数据，可点击右上角启动定向扫描'}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {codes.map((item) => (
            <Card
              key={`${item.code}-${item.storage_path}-${item.file_name}`}
              className="border-slate-200/80 shadow-xs hover:shadow-md transition-all group"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                    {item.code}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopy(item.code)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 cursor-pointer"
                      title="复制番号"
                    >
                      {copiedCode === item.code ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCode(item.code)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 cursor-pointer"
                      title="从归档移除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-slate-500 font-mono">
                  <div className="flex items-center gap-1.5 truncate" title={item.file_name}>
                    <Film className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{item.file_name}</span>
                  </div>

                  <div className="flex items-center gap-1.5 truncate" title={item.storage_path}>
                    <HardDrive className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{item.storage_path}</span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                    <span>{formatBytes(item.file_size)}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {item.source === 'download' ? '离线入库' : '定向扫描'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 分页控制器 */}
      {total > 24 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="text-xs font-mono text-slate-500 px-2">
            {page} / {Math.ceil(total / 24)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(total / 24) || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {/* 定向探测扫描控制抽屉 (Sheet) */}
      <Sheet open={scanOpen} onOpenChange={setScanOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-6">
          <SheetHeader>
            <div className="flex items-center gap-2 text-blue-600">
              <Radar className="h-5 w-5" />
              <SheetTitle>定向探测扫描</SheetTitle>
            </div>
            <SheetDescription>
              仅扫描系统配置中指定的特定探测子目录（如 /OD/Video1），杜绝全库深度遍历，保护 API 频控
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                指定扫描分组 (可选)
              </label>
              <select
                value={selectedScanGroup || ''}
                onChange={(e) =>
                  setSelectedScanGroup(e.target.value ? Number(e.target.value) : undefined)
                }
                disabled={scanning}
                className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">全部分组配置目录</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={handleStartScan}
              disabled={scanning}
              className="w-full h-11 text-base font-semibold gap-2"
            >
              {scanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  探测扫描中...
                </>
              ) : (
                <>
                  <Radar className="h-4 w-4" />
                  立即启动定向探测
                </>
              )}
            </Button>

            {/* 扫描状态展示卡片 */}
            {scanStatus && (
              <Card className="border-slate-200 bg-slate-50/50">
                <CardContent className="p-4 space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">扫描状态:</span>
                    <Badge
                      variant={
                        scanStatus.status === 'completed'
                          ? 'success'
                          : scanStatus.status === 'scanning'
                          ? 'info'
                          : 'destructive'
                      }
                    >
                      {scanStatus.status === 'completed'
                        ? '已完成'
                        : scanStatus.status === 'scanning'
                        ? '进行中'
                        : '已终止'}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-500">
                      <span>进度</span>
                      <span>{scanStatus.progress_percent}%</span>
                    </div>
                    <Progress value={scanStatus.progress_percent} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60">
                    <div>
                      <span className="text-slate-400 block text-[10px]">已扫文件</span>
                      <span className="text-base font-bold text-slate-800">
                        {scanStatus.scanned_files}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">新收录番号</span>
                      <span className="text-base font-bold text-emerald-600">
                        {scanStatus.new_codes_found}
                      </span>
                    </div>
                  </div>

                  {scanStatus.current_path && (
                    <div className="text-[11px] text-slate-500 truncate" title={scanStatus.current_path}>
                      📍 当前: {scanStatus.current_path}
                    </div>
                  )}

                  {scanStatus.error_message && (
                    <div className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded">
                      ⚠️ {scanStatus.error_message}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

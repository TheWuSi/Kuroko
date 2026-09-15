import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router'
import { DuplicateReview } from '@/components/common/DuplicateReview'
import { ScanProgress } from '@/components/common/ScanProgress'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  MoreVertical,
  RefreshCw,
} from 'lucide-react'
import { codeService } from '@/services/code.service'
import { useStorageStore } from '@/stores/storageStore'
import { isScanActive, startTrackedScan, useScanStore } from '@/stores/scanStore'
import { formatBytes } from '@/lib/format'
import { partLabel, variantLabel } from '@/lib/storage'
import { toast } from '@/stores/uiStore'
import type { CodeRecord } from '@/types/api'

export function Codes() {
  const [codes, setCodes] = useState<CodeRecord[]>([])
  const [total, setTotal] = useState(0)
  const [totalCodes, setTotalCodes] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<number | undefined>(undefined)
  const [refreshVersion, setRefreshVersion] = useState(0)

  // 扫描控制抽屉
  const { job: scanStatus, starting, libraryRevision, panelOpen: scanOpen } = useScanStore()
  const setScanOpen = (panelOpen: boolean) => useScanStore.setState({ panelOpen })
  const scanning = starting || isScanActive(scanStatus)
  const groups = useStorageStore((state) => state.groups)
  const [selectedScanGroup, setSelectedScanGroup] = useState<number | undefined>(undefined)
  const [scanPaths, setScanPaths] = useState<string[]>([])
  const [pathsLoading, setPathsLoading] = useState(false)
  const [pathsError, setPathsError] = useState('')

  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [deletingCode, setDeletingCode] = useState<string | null>(null)

  // 搜索防抖
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(handler)
  }, [search])

  const fetchCodes = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const res = await codeService.getCodes({
        search: debouncedSearch || undefined,
        group_id: selectedGroup,
        page,
        page_size: 24,
      }, signal)
      if (signal?.aborted) return
      setCodes(res.items || [])
      setTotal(res.total || 0)
      setTotalCodes(res.total_codes || 0)
      if (page > 1 && !res.items.length) setPage(Math.max(1, Math.ceil(res.total / 24)))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取番号列表失败'
      if (!signal?.aborted) toast.error(msg)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [debouncedSearch, page, selectedGroup])

  useEffect(() => {
    const controller = new AbortController()
    void fetchCodes(controller.signal)
    return () => controller.abort()
  }, [fetchCodes, libraryRevision, refreshVersion])

  useEffect(() => {
    if (!scanOpen) return
    if (isScanActive(scanStatus)) {
      setScanPaths(scanStatus?.scan_paths ?? [])
      setPathsLoading(false)
      setPathsError('')
      return
    }
    const controller = new AbortController()
    setPathsLoading(true)
    setPathsError('')
    setScanPaths([])
    codeService.getScanPaths(selectedScanGroup, controller.signal).then(setScanPaths).catch((error) => {
      if (!controller.signal.aborted) setPathsError(error instanceof Error ? error.message : '获取扫描范围失败')
    }).finally(() => { if (!controller.signal.aborted) setPathsLoading(false) })
    return () => controller.abort()
  }, [scanOpen, selectedScanGroup, scanStatus?.task_id, scanStatus?.status, scanStatus?.scan_paths, groups])

  // 触发定向扫描
  const handleStartScan = async () => {
    if (!scanPaths.length || pathsLoading || scanning) return
    try {
      await startTrackedScan(selectedScanGroup, scanPaths)
      toast.success('定向探测扫描已启动')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '启动扫描失败'
      toast.error(msg)
    }
  }

  // 确认删除番号
  const confirmDeleteCode = async () => {
    if (!deletingCode) return
    try {
      await codeService.deleteCode(deletingCode, selectedGroup)
      toast.success(`番号 ${deletingCode} 已从归档中移除`)
      setRefreshVersion((value) => value + 1)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败'
      toast.error(msg)
    } finally {
      setDeletingCode(null)
    }
  }

  const handleCopy = (text: string, id: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedCode(id)
    setTimeout(() => setCopiedCode(null), 2000)
    toast.info(`已复制${label}: ${text}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="番号媒体库归档"
        description="扫描下载与归档目录确认实际文件，统计随分组和搜索条件更新"
      >
        <Button variant="outline" className="min-h-11 gap-2" disabled={loading} onClick={() => setRefreshVersion((value) => value + 1)}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />刷新
        </Button>
        <Button
          onClick={() => {
            setScanOpen(true)
            setSelectedScanGroup(selectedGroup)
          }}
          className="gap-2 bg-blue-600 hover:bg-blue-700 min-h-11 sm:min-h-9"
        >
          <Radar className="h-4 w-4" />
          {scanning ? '查看扫描进度' : '定向探测扫描'}
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3" aria-live="polite">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">番号总数</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{totalCodes.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">个</span></p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">媒体文件总数</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{total.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">个</span></p>
        </CardContent></Card>
      </div>

      {/* 搜索与过滤工具栏 */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            aria-label="搜索番号"
            placeholder="按番号代码搜索，如 ABC-123..."
            value={search}
            maxLength={64}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 font-mono text-sm"
          />
        </div>
        <select aria-label="媒体库分组筛选" value={selectedGroup ?? ''}
          onChange={(event) => { setSelectedGroup(event.target.value ? Number(event.target.value) : undefined); setPage(1) }}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto">
          <option value="">全部媒体记录</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <div className="text-xs text-slate-500 font-mono self-start sm:self-auto">
          第 {page} 页 / 共 {Math.ceil(total / 24) || 1} 页
        </div>
      </div>

      <DuplicateReview groupId={selectedGroup} refreshVersion={refreshVersion + libraryRevision} />

      {/* 骨架屏加载状态 */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Card key={i} className="p-4 space-y-3 border-slate-200/80">
              <div className="flex justify-between items-center">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-5 rounded-md" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="flex justify-between pt-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
            </Card>
          ))}
        </div>
      ) : codes.length === 0 ? (
        <EmptyState
          title="未找到番号记录"
          description={search ? '没有匹配该关键词的番号' : '暂无收录数据，可点击右上角启动定向扫描'}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {codes.map((item) => (
            <Card
              key={`${item.code}-${item.storage_path}-${item.file_name}`}
              className="border-slate-200/80 shadow-xs hover:shadow-md transition-all group"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors truncate mr-2">
                    {item.code}
                  </span>

                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleCopy(item.code, item.code, '番号')}
                          className="min-h-11 min-w-11 p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted cursor-pointer"
                        >
                          {copiedCode === item.code ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>复制番号</TooltipContent>
                    </Tooltip>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="min-h-11 min-w-11 p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted cursor-pointer"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => handleCopy(item.code, item.code, '番号')}
                          className="cursor-pointer gap-2"
                        >
                          <Copy className="h-4 w-4" />
                          <span>复制番号</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleCopy(item.storage_path, `${item.code}-p`, '存放路径')}
                          className="cursor-pointer gap-2"
                        >
                          <HardDrive className="h-4 w-4" />
                          <span>复制存放路径</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeletingCode(item.code)}
                          className="cursor-pointer gap-2 text-rose-600 focus:text-rose-600 focus:bg-rose-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>从归档移除</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-slate-500 font-mono">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 truncate cursor-help">
                        <Film className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{item.file_name}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md break-all">
                      文件名: {item.file_name}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 truncate cursor-help">
                        <HardDrive className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{item.storage_path}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md break-all">
                      路径: {item.storage_path}
                    </TooltipContent>
                  </Tooltip>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border text-[11px]">
                    <span>{formatBytes(item.file_size)}</span>
                    <Badge variant="outline" className="font-mono">{variantLabel(item.variant)}</Badge>
                    {item.part_number !== null && <Badge variant="secondary" className="font-mono">{partLabel(item.part_number)}</Badge>}
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
            className="min-h-11 sm:min-h-9"
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
            className="min-h-11 sm:min-h-9"
          >
            下一页
          </Button>
        </div>
      )}

      {/* 定向探测扫描控制抽屉 (Sheet) */}
      <Sheet open={scanOpen} onOpenChange={setScanOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-6 sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-2 text-blue-600">
              <Radar className="h-5 w-5" />
              <SheetTitle>定向探测扫描</SheetTitle>
            </div>
            <SheetDescription>
              扫描分组成员的下载与归档目录。任务可长时间在后台运行，刷新页面后继续跟踪。
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {isScanActive(scanStatus) && <ScanProgress />}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                指定扫描分组 (可选)
              </label>
              <select
                value={(isScanActive(scanStatus) ? scanStatus?.group_id : selectedScanGroup) ?? ''}
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

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">本次扫描目录</p>
                <Button asChild variant="outline" className="min-h-11"><Link to="/storages">配置目录</Link></Button>
              </div>
              {pathsLoading && <p className="text-sm text-muted-foreground">加载扫描范围…</p>}
              {pathsError && <p role="alert" className="text-sm text-destructive">{pathsError}</p>}
              {!pathsLoading && !pathsError && !scanPaths.length && <p className="text-sm text-muted-foreground">尚无可扫描目录，请配置分组成员的下载与归档路径。</p>}
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {scanPaths.map((path) => <li key={path} className="break-all rounded-md bg-muted p-2 font-mono text-xs">{path}</li>)}
              </ul>
              <p className="text-xs text-muted-foreground">忽略节点自动跳过。扫描只更新索引，文件继续按你的目录规则存放。</p>
            </div>

            {!isScanActive(scanStatus) && <Button
              onClick={handleStartScan}
              disabled={scanning || pathsLoading || !scanPaths.length || Boolean(pathsError)}
              className="w-full min-h-11 text-base font-semibold gap-2"
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
            </Button>}

            {!isScanActive(scanStatus) && <ScanProgress />}
          </div>
        </SheetContent>
      </Sheet>

      {/* 删除番号确认模态框 AlertDialog */}
      <AlertDialog open={Boolean(deletingCode)} onOpenChange={(open) => !open && setDeletingCode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认从番号库归档移除？</AlertDialogTitle>
            <AlertDialogDescription>
              将番号 <span className="font-mono font-bold text-slate-900">{deletingCode}</span> 从本地索引数据库中删除。注意：这不会删除网盘云端实际媒体文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteCode}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

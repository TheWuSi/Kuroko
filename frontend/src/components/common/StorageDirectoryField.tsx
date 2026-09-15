import { Label } from '@/components/ui/label'
import { useEffect, useId, useState } from 'react'
import { ArrowUp, ChevronRight, Folder, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { normalizeStoragePath } from '@/lib/path'
import { storageService } from '@/services/storage.service'
import type { DirectoryListing } from '@/types/api'

interface Props {
  storageId: number | null
  mountPath: string
  value: string
  onChange: (path: string) => void
  label: string
  disabled?: boolean
  allowRoot?: boolean
}

export function StorageDirectoryField({ storageId, mountPath, value, onChange, label, disabled, allowRoot = false }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState(mountPath)
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (!open || storageId === null) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setListing(null)
    storageService.getDirectories(storageId, path, refreshVersion > 0, controller.signal)
      .then(setListing)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '目录加载失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, storageId, path, refreshVersion])

  const browse = () => {
    let initial = mountPath
    try {
      const normalized = normalizeStoragePath(value)
      if (normalized === mountPath || normalized.startsWith(mountPath.replace(/\/$/, '') + '/')) initial = normalized
    } catch { /* 尚未填写目录时从挂载点开始浏览。 */ }
    setPath(initial)
    setRefreshVersion(0)
    setOpen(true)
  }

  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
    <div className="flex items-center gap-2">
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || storageId === null}
        maxLength={1024} placeholder="选择目录，或填写完整路径" className="min-h-11 min-w-0 font-mono text-sm" />
      <Button type="button" variant="outline" onClick={browse} disabled={disabled || storageId === null}
        className="min-h-11 shrink-0 gap-1.5" aria-label={`浏览${label}`}>
        <FolderOpen className="h-4 w-4" />浏览
      </Button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto bg-card text-card-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>选择{label}</DialogTitle>
          <DialogDescription>在 {mountPath} 中打开子文件夹，然后选择当前目录。</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="outline" className="min-h-11 min-w-11 px-2" aria-label="返回上级目录"
            disabled={loading || path === mountPath} onClick={() => { setRefreshVersion(0); setPath(path.slice(0, path.lastIndexOf('/')) || '/') }}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <p className="min-w-0 flex-1 break-all font-mono text-xs">{path}</p>
          <Button type="button" variant="ghost" className="min-h-11 min-w-11 px-2" aria-label="刷新目录"
            disabled={loading} onClick={() => setRefreshVersion((value) => value + 1)}><RefreshCw className="h-4 w-4" /></Button>
        </div>
        <div className="max-h-[40dvh] min-h-28 overflow-y-auto rounded-md border" aria-live="polite">
          {loading && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />读取目录中…</p>}
          {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
          {!loading && !error && listing?.directories.length === 0 && <p className="p-4 text-sm text-muted-foreground">此目录没有子文件夹，可选择当前目录。</p>}
          {listing?.directories.map((directory) => <button key={directory.path} type="button"
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
            onClick={() => { setRefreshVersion(0); setPath(directory.path) }}>
            <Folder className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 break-all font-mono text-sm">{directory.name}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>)}
        </div>
        {!allowRoot && path === mountPath && <p className="text-xs text-muted-foreground">请选择具体子目录，以限定媒体库扫描范围。</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>取消</Button>
          <Button type="button" className="min-h-11" disabled={loading || !listing || Boolean(error) || (!allowRoot && path === mountPath)}
            onClick={() => { onChange(listing!.path); setOpen(false) }}>选择当前目录</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

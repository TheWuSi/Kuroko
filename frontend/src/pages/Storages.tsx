import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { EyeOff, FolderPlus, HardDrive, Layers, Loader2, Pencil, Plus, RefreshCw, Sliders, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StorageDirectoryField } from '@/components/common/StorageDirectoryField'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { storageService } from '@/services/storage.service'
import { formatBytes } from '@/lib/format'
import { normalizeStoragePath } from '@/lib/path'
import { summarizeStorage } from '@/lib/storage'
import { toast } from '@/stores/uiStore'
import type { StorageNodeInfo, StorageGroup, StorageIgnore, StorageMemberInput } from '@/types/api'

type MemberDraft = StorageMemberInput & { storage_mount: string }

export function Storages() {
  const [storages, setStorages] = useState<StorageNodeInfo[]>([])
  const [groups, setGroups] = useState<StorageGroup[]>([])
  const [ignored, setIgnored] = useState<StorageIgnore[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ignoredOpen, setIgnoredOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<StorageGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [members, setMembers] = useState<MemberDraft[]>([])
  const [deletingGroup, setDeletingGroup] = useState<StorageGroup | null>(null)
  const [quotaNode, setQuotaNode] = useState<StorageNodeInfo | null>(null)
  const [quotaGb, setQuotaGb] = useState('1024')
  const ignoredIds = new Set(ignored.map((node) => node.storage_id))
  const summary = summarizeStorage(storages)

  const loadData = useCallback(async (refresh = false) => {
    setLoading(true)
    const results = await Promise.allSettled([
      storageService.getStorages({ refresh }),
      storageService.getGroups(),
      storageService.getIgnored(),
    ])
    if (results[0].status === 'fulfilled') setStorages(results[0].value)
    if (results[1].status === 'fulfilled') setGroups(results[1].value)
    if (results[2].status === 'fulfilled') setIgnored(results[2].value)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') toast.error(failed.reason instanceof Error ? failed.reason.message : '部分存储信息加载失败')
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const changeIgnore = async (storageId: number, value: boolean) => {
    setBusy(true)
    try {
      await storageService.setIgnored(storageId, value)
      toast.success(value ? '已忽略该节点，停止分配下载并跳过扫描' : '已恢复该节点')
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新忽略项失败')
    } finally { setBusy(false) }
  }

  const editGroup = (group: StorageGroup | null) => {
    setEditingGroup(group)
    setGroupName(group?.name ?? '')
    setMembers((group?.members ?? []).map((member) => ({
      storage_id: member.storage_id ?? storages.find((node) => node.mount_path === member.storage_mount)?.id
        ?? ignored.find((node) => node.storage_mount === member.storage_mount)?.storage_id ?? 0,
      storage_mount: member.storage_mount,
      download_path: member.download_path,
      archive_paths: [...member.archive_paths],
    })))
    setGroupOpen(true)
  }

  const toggleMember = (node: StorageNodeInfo) => {
    setMembers((previous) => previous.some((member) => member.storage_id === node.id)
      ? previous.filter((member) => member.storage_id !== node.id)
      : [...previous, { storage_id: node.id, storage_mount: node.mount_path, download_path: '', archive_paths: [] }])
  }

  const updateMember = (index: number, change: Partial<MemberDraft>) => {
    setMembers((previous) => previous.map((member, position) => position === index ? { ...member, ...change } : member))
  }

  const saveGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!groupName.trim() || !members.length) { toast.warning('请输入分组名称，并至少选择一个存储节点'); return }
    if (members.some((member) => !member.storage_id)) { toast.warning('有旧挂载已无法匹配，请移除该成员后重新选择'); return }
    setBusy(true)
    try {
      const payload = members.map((member) => ({
        storage_id: member.storage_id,
        download_path: normalizeStoragePath(member.download_path),
        archive_paths: member.archive_paths.map(normalizeStoragePath),
      }))
      if (editingGroup) await storageService.updateGroup(editingGroup.id, { name: groupName.trim(), members: payload })
      else await storageService.createGroup(groupName.trim(), payload)
      toast.success('分组与目录配置已保存')
      setGroupOpen(false)
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存分组失败')
    } finally { setBusy(false) }
  }

  const deleteGroup = async () => {
    if (!deletingGroup) return
    setBusy(true)
    try {
      await storageService.deleteGroup(deletingGroup.id)
      toast.success('分组已删除，媒体文件和扫描记录保留')
      setDeletingGroup(null)
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除分组失败')
    } finally { setBusy(false) }
  }

  const saveQuota = async (event: FormEvent) => {
    event.preventDefault()
    if (!quotaNode) return
    const bytes = Math.round(Number(quotaGb) * 1024 ** 3)
    if (!Number.isSafeInteger(bytes) || bytes <= 0) { toast.warning('请输入有效的正数容量'); return }
    setBusy(true)
    try {
      const updated = await storageService.overrideStorageSpace(quotaNode.id, bytes)
      setStorages((previous) => previous.map((node) => node.id === updated.id ? updated : node))
      if (updated.free_space === null) toast.warning(updated.space_error || '配额已保存，已用容量仍未知')
      else toast.success('存储配额已更新')
      setQuotaNode(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存配额失败')
    } finally { setBusy(false) }
  }

  return <div className="space-y-6">
    <PageHeader title="存储节点与分组" description="选择 OpenList 存储组成分组，为每个成员指定下载目录与媒体库归档目录。">
      <Button variant="outline" className="min-h-[44px] gap-2" onClick={() => void loadData(true)} disabled={loading || busy}>
        <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />刷新
      </Button>
      <Button variant="outline" className="min-h-[44px] gap-2" onClick={() => setIgnoredOpen(true)}>
        <EyeOff className="h-4 w-4" />忽略项（{ignored.length}）
      </Button>
      <Button className="min-h-[44px] gap-2" onClick={() => editGroup(null)} disabled={busy}>
        <FolderPlus className="h-4 w-4" />创建存储分组
      </Button>
    </PageHeader>

    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">纳管存储剩余容量</p>
      <p className="mt-1 font-mono text-2xl font-semibold">{formatBytes(summary.free)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        共 {summary.count} 个可见节点 · 已知总容量 {formatBytes(summary.total)}
        {summary.unknown > 0 && ' · ' + summary.unknown + ' 个节点容量未知，按 0 汇总'}
      </p>
    </div>

    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-semibold"><Layers className="h-4 w-4 text-primary" />存储分组（{groups.length}）</h2>
      {!groups.length && !loading && <EmptyState title="尚未创建分组" description="选择几个挂载存储，设置它们各自的下载目录与归档目录，即可按组调度和跨盘查重。" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const visible = group.members.filter((member) => !ignoredIds.has(member.storage_id ?? -1)
            && !ignored.some((node) => node.storage_mount === member.storage_mount))
          return <Card key={group.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
              <div className="min-w-0"><CardTitle className="break-all text-base">{group.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{visible.length} 个成员{visible.length < group.members.length && ' · ' + (group.members.length - visible.length) + ' 个已忽略'}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" className="min-h-[44px] gap-1.5" disabled={busy} onClick={() => editGroup(group)}><Pencil className="h-4 w-4" />编辑</Button>
                <Button variant="ghost" className="min-h-[44px] gap-1.5 text-destructive" disabled={busy} onClick={() => setDeletingGroup(group)}><Trash2 className="h-4 w-4" />删除</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {visible.map((member) => <div key={member.id} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <p className="break-all font-mono text-sm font-semibold">{member.storage_mount}</p>
                <div className="space-y-1 text-xs">
                  <p className="break-all"><span className="text-muted-foreground">下载：</span><span className="font-mono">{member.download_path}</span></p>
                  {member.archive_paths.map((path) => <p key={path} className="break-all"><span className="text-muted-foreground">归档：</span><span className="font-mono">{path}</span></p>)}
                  {!member.archive_paths.length && <p className="text-muted-foreground">未设置归档目录，扫描仅覆盖下载目录</p>}
                </div>
              </div>)}
              {!visible.length && <p className="text-sm text-muted-foreground">此分组的成员均已忽略，可在忽略项中恢复。</p>}
            </CardContent>
          </Card>
        })}
      </div>
    </section>

    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-semibold"><HardDrive className="h-4 w-4 text-primary" />OpenList 挂载节点（{storages.length}）</h2>
      {!storages.length && !loading && <EmptyState title="没有可见的挂载存储" description="请检查 OpenList 连接，或在忽略项中恢复节点。" />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {storages.map((node) => {
          const percent = node.total_space && node.used_space !== null ? Math.min(100, node.used_space / node.total_space * 100) : null
          return <Card key={node.id}>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm font-semibold">{node.mount_path}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{node.driver} · {node.status === 'work' ? '正常' : '不可用'}</p>
                </div>
                <Badge variant={node.space_source === 'manual' ? 'warning' : 'outline'} className="shrink-0">{node.space_source === 'manual' ? '手动配额' : '原生容量'}</Badge>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-2 font-mono"><span>已用 {formatBytes(node.used_space)}</span><span>剩余 {formatBytes(node.free_space)}</span></div>
                {percent !== null && <Progress value={percent} />}
                <p className="font-mono text-muted-foreground">总容量 {formatBytes(node.total_space)}</p>
                {node.free_space === null && <p className="text-muted-foreground">{node.space_error || '剩余容量未知'}。按 0 汇总，可指定目录下载。</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-1 border-t pt-2">
                <Button variant="ghost" className="min-h-[44px] gap-1.5 text-muted-foreground" disabled={busy} onClick={() => void changeIgnore(node.id, true)}><EyeOff className="h-4 w-4" />忽略节点</Button>
                <Button variant="ghost" className="min-h-[44px] gap-1.5" disabled={busy} onClick={() => {
                  setQuotaNode(node); setQuotaGb(node.total_space ? String(node.total_space / 1024 ** 3) : '1024')
                }}><Sliders className="h-4 w-4" />设置配额</Button>
              </div>
            </CardContent>
          </Card>
        })}
      </div>
    </section>

    <Dialog open={groupOpen} onOpenChange={(open) => { if (!busy) setGroupOpen(open) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card text-card-foreground sm:max-w-2xl">
        <DialogHeader><DialogTitle>{editingGroup ? '编辑存储分组' : '创建存储分组'}</DialogTitle>
          <DialogDescription>勾选存储，再为每个成员选择目录。同一网盘可用于多个分组，查重覆盖组内下载与归档目录。</DialogDescription>
        </DialogHeader>
        <form onSubmit={saveGroup} className="space-y-5">
          <div className="space-y-1.5"><label htmlFor="group-name" className="text-sm font-medium">分组名称</label>
            <Input id="group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={100} required disabled={busy} className="min-h-[44px]" placeholder="例如：主媒体库" />
          </div>
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">选择 OpenList 存储</legend>
            <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
              {storages.map((node) => <label key={node.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-primary/5">
                <input type="checkbox" checked={members.some((member) => member.storage_id === node.id)} onChange={() => toggleMember(node)} className="h-4 w-4 accent-primary" />
                <span className="min-w-0 break-all font-mono text-sm">{node.mount_path}</span>
              </label>)}
            </div>
            {!storages.length && <p className="text-sm text-muted-foreground">暂无可选节点，请先连接 OpenList 或恢复忽略项。</p>}
          </fieldset>
          <div className="space-y-4">
            {members.map((member, index) => ignoredIds.has(member.storage_id) ? (
              <p key={index} className="text-xs text-muted-foreground">一个已忽略成员的目录配置会保留，可在忽略项中恢复后编辑。</p>
            ) : <fieldset key={index} disabled={busy} className="min-w-0 space-y-4 rounded-lg border p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 break-all font-mono text-sm font-semibold">{member.storage_mount}</p>
                <Button type="button" variant="ghost" className="min-h-[44px] min-w-[44px] shrink-0 px-2 text-muted-foreground" aria-label={'移除成员 ' + member.storage_mount}
                  onClick={() => setMembers((previous) => previous.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              {!member.storage_id && <p className="text-sm text-destructive">此旧挂载未找到，请重新选择有效节点。</p>}
              <StorageDirectoryField label="下载目录" storageId={member.storage_id || null} mountPath={member.storage_mount}
                value={member.download_path} onChange={(path) => updateMember(index, { download_path: path })} disabled={busy} />
              <div className="space-y-3">
                {member.archive_paths.map((path, position) => <div key={position} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1"><StorageDirectoryField label={'归档目录 ' + (position + 1)} storageId={member.storage_id || null}
                    mountPath={member.storage_mount} value={path} disabled={busy}
                    onChange={(value) => updateMember(index, { archive_paths: member.archive_paths.map((entry, slot) => slot === position ? value : entry) })} /></div>
                  <Button type="button" variant="ghost" className="min-h-[44px] min-w-[44px] px-2" aria-label={'移除归档目录 ' + (position + 1)}
                    onClick={() => updateMember(index, { archive_paths: member.archive_paths.filter((_, slot) => slot !== position) })}><Trash2 className="h-4 w-4" /></Button>
                </div>)}
                <Button type="button" variant="outline" className="min-h-[44px] gap-1.5" disabled={member.archive_paths.length >= 20}
                  onClick={() => updateMember(index, { archive_paths: [...member.archive_paths, ''] })}><Plus className="h-4 w-4" />添加归档目录</Button>
              </div>
            </fieldset>)}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setGroupOpen(false)}>取消</Button>
            <Button type="submit" className="min-h-[44px] gap-2" disabled={busy || !members.length}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}保存分组
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={ignoredOpen} onOpenChange={setIgnoredOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto bg-card">
        <DialogHeader><DialogTitle>已忽略的存储节点</DialogTitle><DialogDescription>这些节点不显示在默认列表中，不参与下载、扫描和容量汇总。已有目录配置与媒体索引会保留。</DialogDescription></DialogHeader>
        {!ignored.length && <p className="text-sm text-muted-foreground">暂无忽略项。</p>}
        {ignored.map((node) => <div key={node.storage_id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 break-all font-mono text-sm">{node.storage_mount}</span>
          <Button variant="outline" disabled={busy} className="min-h-[44px] shrink-0" onClick={() => void changeIgnore(node.storage_id, false)}>恢复节点</Button>
        </div>)}
      </DialogContent>
    </Dialog>

    <Dialog open={quotaNode !== null} onOpenChange={(open) => { if (!open && !busy) setQuotaNode(null) }}>
      <DialogContent className="bg-card">
        <DialogHeader><DialogTitle>设置存储总配额</DialogTitle><DialogDescription>{quotaNode?.mount_path}：保存配额后读取用量，统计不完整时剩余空间仍显示未知。</DialogDescription></DialogHeader>
        <form onSubmit={saveQuota} className="space-y-4">
          <label htmlFor="quota-gb" className="block text-sm font-medium">总容量（GB）</label>
          <Input id="quota-gb" type="number" min="0.001" step="any" value={quotaGb} onChange={(event) => setQuotaGb(event.target.value)} required disabled={busy} className="min-h-[44px] font-mono" />
          <DialogFooter><Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setQuotaNode(null)}>取消</Button><Button type="submit" disabled={busy} className="min-h-[44px]">保存容量</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={deletingGroup !== null} onOpenChange={(open) => { if (!open && !busy) setDeletingGroup(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>删除分组“{deletingGroup?.name}”</AlertDialogTitle><AlertDialogDescription>将删除分组配置及它的重复放行规则，保留实际媒体文件与扫描记录。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy} className="min-h-[44px]">取消</AlertDialogCancel><AlertDialogAction disabled={busy} className="min-h-[44px]" onClick={(event) => { event.preventDefault(); void deleteGroup() }}>删除分组</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}

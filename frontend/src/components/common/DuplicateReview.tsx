import { useEffect, useState } from 'react'
import { Check, Copy, Loader2, Undo2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { codeService } from '@/services/code.service'
import { partLabel, variantLabel } from '@/lib/storage'
import { toast } from '@/stores/uiStore'
import type { DuplicateAllowance, DuplicateGroup } from '@/types/api'

export function DuplicateReview({ groupId, refreshVersion }: { groupId?: number; refreshVersion: number }) {
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  const [total, setTotal] = useState(0)
  const [rules, setRules] = useState<DuplicateAllowance[]>([])
  const [page, setPage] = useState(1)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const finish = (key: string) => setBusy((previous) => { const next = new Set(previous); next.delete(key); return next })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { setPage(1) }, [groupId, refreshVersion])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    Promise.all([
      codeService.getDuplicates(groupId, page, controller.signal),
      codeService.getDuplicateIgnores(groupId, controller.signal),
    ]).then(([data, allowances]) => {
      setDuplicates(data.items)
      setTotal(data.total)
      setRules(allowances)
      if (page > 1 && data.items.length === 0) setPage((value) => value - 1)
    }).catch((error) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '重复记录加载失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [groupId, refreshVersion, version, page])

  const allow = async (item: DuplicateGroup) => {
    const key = 'allow:' + item.group_id + ':' + item.code
    if (busy.has(key)) return
    setBusy((previous) => new Set([...previous, key]))
    try {
      await codeService.allowDuplicate(item.group_id, item.code, [...new Set([...item.allowed_variants, ...item.variants])])
      toast.success('版本组合已保存，相同版本或分集的重复副本仍会提示')
      setVersion((value) => value + 1)
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存放行规则失败') }
    finally { finish(key) }
  }

  const revoke = async (id: number) => {
    const key = 'rule:' + id
    if (busy.has(key)) return
    setBusy((previous) => new Set([...previous, key]))
    try {
      await codeService.revokeDuplicate(id)
      toast.success('已撤销版本组合放行')
      setVersion((value) => value + 1)
    } catch (error) { toast.error(error instanceof Error ? error.message : '撤销规则失败') }
    finally { finish(key) }
  }

  return <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base"><Copy className="h-4 w-4 text-primary" />分组内跨盘查重</CardTitle>
      <p className="text-xs text-muted-foreground">核对组内下载与归档目录。FC2 别名统一识别，不同分集可自然共存；版本放行规则随分组和番号保存。</p>
    </CardHeader>
    <CardContent>
      <Tabs defaultValue="duplicates" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:w-fit">
          <TabsTrigger value="duplicates" className="min-h-11">待处理重复（{total}）</TabsTrigger>
          <TabsTrigger value="rules" className="min-h-11">已允许组合（{rules.length}）</TabsTrigger>
        </TabsList>
        {error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" className="min-h-11" onClick={() => setVersion((value) => value + 1)}>重试</Button></p>}
        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />核对索引中…</p>}
        <TabsContent value="duplicates" className="space-y-3">
          {!loading && !error && !total && <p className="text-sm text-muted-foreground">当前索引中没有待处理的组内重复。扫描目录后会自动更新。</p>}
          {duplicates.map((item) => {
            const key = item.group_id + ':' + item.code
            const saving = busy.has('allow:' + key)
            return <div key={key} className="space-y-3 rounded-lg border p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-all font-mono font-semibold">{item.code}</span>
                  <Badge variant="outline">{item.group_name}</Badge>
                  <Badge variant="warning">{item.files.length} 份文件</Badge>
                </div>
                <Button variant="outline" className="min-h-11 shrink-0 gap-2 self-end"
                  disabled={!item.can_ignore || saving || loading}
                  aria-label={'允许 ' + item.code + ' 的版本共存'}
                  onClick={() => void allow(item)}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  允许这些版本共存
                </Button>
              </div>
              <ul className="space-y-2">
                {item.files.map((file) => <li key={file.id} className="space-y-1.5 rounded-md bg-muted/40 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono">{variantLabel(file.variant)}</Badge>
                    {file.part_number !== null && <Badge variant="outline" className="font-mono">{partLabel(file.part_number)}</Badge>}
                    {file.directory_matches.map((match) => <Badge key={match.kind + match.path} variant="outline">
                      {match.kind === 'download' ? '下载目录' : match.kind === 'archive' ? '归档目录' : '历史探测目录'}
                    </Badge>)}
                    {file.directory_matches[0] && <span className="break-all font-mono text-muted-foreground">节点 {file.directory_matches[0].storage_mount}</span>}
                  </div>
                  {[...new Set(file.directory_matches.map((match) => match.path))].map((path) =>
                    <p key={path} className="break-all text-muted-foreground">配置目录：<span className="font-mono">{path}</span></p>)}
                  <p className="break-all font-mono">{file.storage_path.replace(/\/$/, '')}/{file.file_name}</p>
                </li>)}
              </ul>
              {!item.can_ignore && <p className="text-xs text-warning">
                {item.code.startsWith('FC2-') ? '存在同版本、同一分集的重复文件。' : '存在同一版本的多份文件。'}
                版本共存不能放行这些重复副本。
              </p>}
            </div>
          })}
          {total > 30 && <div className="flex items-center justify-center gap-3">
            <Button variant="outline" disabled={page <= 1 || loading} className="min-h-11" onClick={() => setPage((value) => value - 1)}>上一页</Button>
            <span className="font-mono text-xs">{page} / {Math.ceil(total / 30)}</span>
            <Button variant="outline" disabled={page * 30 >= total || loading} className="min-h-11" onClick={() => setPage((value) => value + 1)}>下一页</Button>
          </div>}
        </TabsContent>
        <TabsContent value="rules" className="space-y-3">
          {!loading && !error && !rules.length && <p className="text-sm text-muted-foreground">尚未允许任何重复组合。</p>}
          {rules.map((rule) => <div key={rule.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1"><p className="font-mono text-sm font-semibold">{rule.code}</p>
              <p className="text-xs text-muted-foreground">{rule.group_name} · {rule.variants.map(variantLabel).join('、')} · {rule.code.startsWith('FC2-') ? '每个版本的各分集一份' : '各一份'}</p>
            </div>
            <Button variant="outline" disabled={busy.has('rule:' + rule.id) || loading} className="min-h-11 shrink-0 gap-2" onClick={() => void revoke(rule.id)}><Undo2 className="h-4 w-4" />撤销允许</Button>
          </div>)}
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>
}

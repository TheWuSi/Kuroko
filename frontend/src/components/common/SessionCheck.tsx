import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SessionCheck({ error, retry }: { error?: string; retry: () => void }) {
  return <div className="flex min-h-screen items-center justify-center bg-background p-6">
    <div className="flex max-w-md flex-col items-center gap-3 text-center">
      {error ? <>
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <p className="text-sm text-muted-foreground">登录信息与磁力草稿已保留，网络恢复后可继续。</p>
        <Button className="min-h-11" onClick={retry}>重新连接</Button>
      </> : <>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在验证会话…</p>
      </>}
    </div>
  </div>
}

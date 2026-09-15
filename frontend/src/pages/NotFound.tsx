import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { AlertCircle, Home } from 'lucide-react'

export function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-4">
      <div className="p-4 rounded-2xl bg-destructive/10 text-destructive mb-4 shadow-xs">
        <AlertCircle className="h-10 w-10" />
      </div>
      <h1 className="text-3xl font-bold font-mono text-foreground tracking-tight">404</h1>
      <h2 className="text-lg font-semibold text-foreground mt-1">未找到指定页面</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        抱歉，您访问的路由不存在或已被移除，请点击下方按钮返回系统大盘。
      </p>
      <Button asChild className="mt-6 gap-2">
        <Link to="/dashboard">
          <Home className="h-4 w-4" />
          返回总览看板
        </Link>
      </Button>
    </div>
  )
}

import React from 'react'
import { FolderOpen } from 'lucide-react'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
}

export function EmptyState({
  title = '暂无数据',
  description = '当前列表为空或没有匹配的搜索结果',
  icon = <FolderOpen className="h-10 w-10 text-muted-foreground stroke-[1.5]" />,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl border border-dashed border-border bg-muted/50">
      <div className="p-4 rounded-full bg-card shadow-xs mb-3">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

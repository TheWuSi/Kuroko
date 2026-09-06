import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Progress({ value = 0, className, ...props }: HTMLAttributes<HTMLDivElement> & { value?: number }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', className)} {...props}>
      <div
        className="h-full rounded-full bg-blue-600 transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

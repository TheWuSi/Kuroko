import * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorClassName, ...props }, ref) => {
    const clamped = Math.min(100, Math.max(0, value || 0))
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100', className)}
        {...props}
      >
        <div
          className={cn(
            'h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-in-out',
            indicatorClassName
          )}
          style={{ transform: `translateX(-${100 - clamped}%)` }}
        />
      </div>
    )
  }
)
Progress.displayName = 'Progress'

export { Progress }

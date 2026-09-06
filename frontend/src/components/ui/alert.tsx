import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mb-5 flex items-center justify-between rounded-md px-3.5 py-3 text-sm', className)}
      {...props}
    />
  )
}

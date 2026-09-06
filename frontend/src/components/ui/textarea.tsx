import type { TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-y rounded-md border border-slate-200 bg-white p-4 text-sm leading-7 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
        className,
      )}
      {...props}
    />
  )
}

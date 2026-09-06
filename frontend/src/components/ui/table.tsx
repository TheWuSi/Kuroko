import type { HTMLAttributes, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
}
export function TableHeader(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />
}
export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}
export function TableRow({ className, ...props }: TableHTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-t border-slate-100', className)} {...props} />
}
export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-2 py-3 text-[10px] uppercase tracking-[0.1em] text-slate-400', className)} {...props} />
}
export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-2 py-3', className)} {...props} />
}

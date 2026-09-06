import type { ReactNode } from 'react'
import { Alert as ShadcnAlert } from './alert'

export function Notice({
  tone,
  children,
  onClose,
}: {
  tone: 'error' | 'info'
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <ShadcnAlert className={tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}>
      {children}
      {onClose && (
        <button className="ml-4 bg-transparent text-lg" onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      )}
    </ShadcnAlert>
  )
}

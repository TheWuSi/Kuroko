import type { ReactNode } from 'react'

export function Alert({
  tone,
  children,
  onClose,
}: {
  tone: 'error' | 'info'
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <div
      className={`mb-5 flex items-center justify-between rounded-md px-3.5 py-3 text-sm ${tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}
    >
      {children}
      {onClose && (
        <button className="ml-4 bg-transparent text-lg" onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      )}
    </div>
  )
}

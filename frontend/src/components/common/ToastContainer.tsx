import { useUiStore, type ToastItem } from '@/stores/uiStore'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ToastContainer() {
  const { toasts, removeToast } = useUiStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 max-w-md w-auto sm:w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
    error: <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
    info: <Info className="h-5 w-5 text-blue-600 shrink-0" />,
  }

  const borderStyles = {
    success: 'border-emerald-200 bg-white text-slate-800',
    error: 'border-rose-200 bg-white text-slate-800',
    warning: 'border-amber-200 bg-white text-slate-800',
    info: 'border-blue-200 bg-white text-slate-800',
  }

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg transition-all animate-in slide-in-from-top-2 duration-200',
        borderStyles[toast.type]
      )}
    >
      {icons[toast.type]}
      <div className="flex-1 text-sm">
        {toast.title && <div className="font-semibold text-slate-900 mb-0.5">{toast.title}</div>}
        <div className="text-slate-600 leading-snug wrap-break-word">{toast.message}</div>
      </div>
      <button
        onClick={onClose}
        aria-label="关闭提示"
        className="min-h-11 min-w-11 -my-2 -mr-2 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-sm cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

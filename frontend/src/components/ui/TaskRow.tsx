import type { Task } from '../../types/api'
import { Badge } from './badge'
import { Progress } from './progress'

export function TaskRow({ task }: { task: Task }) {
  const badge =
    task.status === 'completed'
      ? 'bg-emerald-50 text-emerald-700'
      : task.status === 'failed'
        ? 'bg-rose-50 text-rose-700'
        : task.status === 'downloading'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-600'
  const progress = Math.min(100, Math.max(0, task.progress || 0))
  return (
    <div className="flex items-center gap-3 border-t border-slate-100 py-4">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 font-extrabold text-blue-600">
        {task.status === 'completed' ? '✓' : '↓'}
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <strong className="text-sm">{task.code}</strong>
        <small className="truncate text-xs text-slate-500">{task.target_path}</small>
      </div>
      <div className="w-52 max-[600px]:w-32">
        <div className="mb-2 flex items-center justify-between text-xs">
          <Badge className={`uppercase tracking-wide ${badge}`}>{task.status}</Badge>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} />
      </div>
    </div>
  )
}

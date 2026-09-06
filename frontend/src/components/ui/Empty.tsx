export function Empty({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) {
  return <div className="py-10 text-center text-sm text-slate-500"><span className="mb-2 block text-3xl text-slate-300">∅</span><p>{title}</p>{action && <button className="mt-2 bg-transparent text-sm text-blue-600" onClick={onClick}>{action} →</button>}</div>
}

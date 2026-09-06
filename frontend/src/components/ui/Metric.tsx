const colors: Record<string, string> = { blue: 'border-blue-600', emerald: 'border-emerald-600', orange: 'border-orange-500', pink: 'border-pink-600' }

export function Metric({ label, value, color }: { label: string; value: number | string; color: string }) {
  return <div className={`min-h-[102px] border-t-[3px] bg-white px-5 py-4 ${colors[color] || colors.blue}`}><span className="text-xs text-slate-500">{label}</span><strong className="mt-3 block text-3xl font-extrabold tracking-tight text-slate-800">{value}</strong></div>
}

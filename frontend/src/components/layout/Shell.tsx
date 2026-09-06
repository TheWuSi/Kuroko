import type { ReactNode } from 'react'
import type { User } from '../../types/api'
import { Alert } from '../ui/Alert'
import { eyebrow } from '../ui/styles'

export type PageId = 'dashboard' | 'magnets' | 'tasks' | 'codes' | 'storages' | 'settings'
export const navigation: Array<[PageId, string, string]> = [
  ['dashboard', '总览', '⌂'],
  ['magnets', '磁力解析', '↯'],
  ['tasks', '下载任务', '↓'],
  ['codes', '番号库', '#'],
  ['storages', '存储编排', '◫'],
  ['settings', '系统设置', '⚙'],
]

export function Shell({
  page,
  setPage,
  user,
  onLogout,
  error,
  setError,
  children,
}: {
  page: PageId
  setPage: (page: PageId) => void
  user: User
  onLogout: () => void
  error: string
  setError: (error: string) => void
  children: ReactNode
}) {
  const title = navigation.find(([id]) => id === page)?.[1]
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      <aside className="flex w-[238px] shrink-0 flex-col bg-[#14212b] px-4 py-7 text-slate-200 max-[900px]:w-[76px] max-[900px]:px-2 max-[600px]:fixed max-[600px]:inset-x-0 max-[600px]:bottom-0 max-[600px]:top-auto max-[600px]:z-20 max-[600px]:h-16 max-[600px]:w-full max-[600px]:flex-row max-[600px]:items-center">
        <div className="mb-9 flex items-center gap-3 px-2 max-[900px]:justify-center max-[600px]:mb-0">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 font-extrabold text-slate-800">
            K
          </span>
          <div className="max-[900px]:hidden">
            <strong className="block text-base tracking-wide">Kuroko</strong>
            <small className="text-[10px] text-slate-400">Media Operations</small>
          </div>
        </div>
        <nav className="grid gap-1 max-[600px]:flex max-[600px]:w-full max-[600px]:justify-around">
          {navigation.map(([id, label, icon]) => (
            <button
              key={id}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition max-[900px]:justify-center max-[600px]:flex-1 max-[600px]:px-1 max-[600px]:py-1 ${page === id ? 'bg-[#233541] text-white' : 'text-slate-400 hover:bg-[#233541] hover:text-white'}`}
              onClick={() => {
                setPage(id)
                setError('')
              }}
            >
              <i className="w-5 text-center text-lg not-italic">{icon}</i>
              <span className="max-[900px]:hidden max-[600px]:hidden">{label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 px-2 py-3 text-xs text-slate-400 max-[900px]:hidden">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          服务在线
          <button className="ml-auto bg-transparent text-xs text-slate-400" onClick={onLogout}>
            退出
          </button>
        </div>
      </aside>
      <main className="min-w-0 max-w-[1500px] flex-1 px-[clamp(22px,5vw,68px)] py-9 pb-24 max-[600px]:pb-24">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <p className={eyebrow}>OPERATIONS / {page.toUpperCase()}</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 font-bold text-blue-600">
              {user.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="max-[600px]:hidden">{user.username}</span>
          </div>
        </header>
        {error && (
          <Alert tone="error" onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {children}
      </main>
    </div>
  )
}

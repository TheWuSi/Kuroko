import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

type ApiResult<T> = { code: number; message: string; data: T }
type User = { id: number; username: string; role: string }
type Task = {
  task_id: string
  code: string
  status: string
  progress: number
  target_path: string
  speed?: string
  error_message?: string
}
type Config = {
  openlist: { base_url: string; auth_type: string; username: string; password?: string; token?: string }
  filter: { allowed_extensions: string[]; min_file_size_mb: number; blacklist_patterns: string[] }
  bt_parser: { service_url: string }
  probe_paths: unknown[]
}

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const token = localStorage.getItem('kuroko_token')
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const body = (await response.json()) as ApiResult<T>
  if (!response.ok || body.code !== 0) throw new Error(body.message || '请求失败')
  return body.data
}

const button =
  'inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50'
const input =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
const eyebrow = 'mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400'

function App() {
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [page, setPage] = useState('dashboard')
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ initialized: boolean }>('/auth/bootstrap-status')
      .then((data) => setInitialized(data.initialized))
      .catch((err) => setError(err.message))
    const token = localStorage.getItem('kuroko_token')
    if (token)
      api<User>('/auth/me')
        .then(setUser)
        .catch(() => localStorage.removeItem('kuroko_token'))
  }, [])

  if (initialized === null)
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">正在检查系统状态…</div>
    )
  if (!initialized)
    return (
      <AuthForm
        bootstrap
        onDone={(token, nextUser) => {
          localStorage.setItem('kuroko_token', token)
          setUser(nextUser)
          setInitialized(true)
        }}
      />
    )
  if (!user)
    return (
      <AuthForm
        onDone={(token, nextUser) => {
          localStorage.setItem('kuroko_token', token)
          setUser(nextUser)
        }}
      />
    )
  return (
    <Shell
      page={page}
      setPage={setPage}
      user={user}
      onLogout={() => {
        localStorage.removeItem('kuroko_token')
        setUser(null)
      }}
      error={error}
      setError={setError}
    />
  )
}

function AuthForm({ bootstrap = false, onDone }: { bootstrap?: boolean; onDone: (token: string, user: User) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (bootstrap && password !== confirm) return setError('两次密码不一致')
    try {
      const auth = await api<{ token: string }>(bootstrap ? '/auth/bootstrap' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      const response = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${auth.token}` } })
      const nextUser = ((await response.json()) as ApiResult<User>).data
      onDone(auth.token, nextUser)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <form
        className="w-full max-w-[420px] border border-slate-200 bg-white p-8 shadow-[0_14px_40px_rgba(18,32,43,0.06)] sm:p-10"
        onSubmit={submit}
      >
        <div className="mb-6 grid h-11 w-11 place-items-center rounded-xl bg-slate-800 text-xl font-extrabold text-white">
          K
        </div>
        <p className={eyebrow}>KUROKO CONTROL</p>
        <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-slate-900">
          {bootstrap ? '创建管理员' : '登录工作台'}
        </h1>
        <p className="mb-7 text-sm text-slate-500">
          {bootstrap ? '首次使用请设置唯一管理员账号。' : '管理磁力解析、离线下载与存储资产。'}
        </p>
        <Field label="用户名">
          <input
            className={input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        <Field label="密码">
          <input
            className={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={bootstrap ? 'new-password' : 'current-password'}
            required
            minLength={8}
          />
        </Field>
        {bootstrap && (
          <Field label="确认密码">
            <input
              className={input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <button className={`${button} mt-6 w-full bg-blue-600 text-white hover:bg-blue-700`} type="submit">
          {bootstrap ? '完成初始化' : '进入系统'}
        </button>
      </form>
    </main>
  )
}

function Shell({
  page,
  setPage,
  user,
  onLogout,
  error,
  setError,
}: {
  page: string
  setPage: (page: string) => void
  user: User
  onLogout: () => void
  error: string
  setError: (error: string) => void
}) {
  const nav = [
    ['dashboard', '总览', '⌂'],
    ['magnets', '磁力解析', '↯'],
    ['tasks', '下载任务', '↓'],
    ['codes', '番号库', '#'],
    ['storages', '存储编排', '◫'],
    ['settings', '系统设置', '⚙'],
  ]
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
          {nav.map(([id, label, icon]) => (
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
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              {nav.find(([id]) => id === page)?.[1]}
            </h1>
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
        {page === 'dashboard' && <Dashboard setPage={setPage} setError={setError} />}
        {page === 'magnets' && <MagnetParser setError={setError} />}
        {page === 'tasks' && <Tasks setError={setError} />}
        {page === 'codes' && <Codes setError={setError} />}
        {page === 'storages' && <Storages setError={setError} />}
        {page === 'settings' && <Settings setError={setError} />}
      </main>
    </div>
  )
}

function Dashboard({ setPage, setError }: { setPage: (page: string) => void; setError: (error: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [codes, setCodes] = useState(0)
  useEffect(() => {
    Promise.all([
      api<{ items: Task[] }>('/tasks?page=1&page_size=5'),
      api<{ total: number }>('/codes?page=1&page_size=1'),
    ])
      .then(([taskData, codeData]) => {
        setTasks(taskData.items)
        setCodes(codeData.total)
      })
      .catch((err) => setError(err.message))
  }, [setError])
  const active = tasks.filter((task) => ['pending', 'downloading'].includes(task.status)).length
  return (
    <>
      <section className="mb-5 flex items-center justify-between gap-5 border-l-4 border-blue-600 bg-blue-50 p-8 max-[600px]:block max-[600px]:p-6">
        <div>
          <p className={eyebrow}>MEDIA PIPELINE</p>
          <h2 className="max-w-xl text-3xl font-extrabold leading-tight tracking-tight text-slate-900">
            把每个磁力任务，变成可追踪的库资产。
          </h2>
          <p className="mt-2 text-sm text-slate-500">从清洗、去重到存储规划与入库，所有状态集中在一个工作台。</p>
        </div>
        <button
          className={`${button} mt-0 bg-blue-600 text-white hover:bg-blue-700 max-[600px]:mt-5`}
          onClick={() => setPage('magnets')}
        >
          解析新磁力 ↗
        </button>
      </section>
      <div className="mb-5 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
        <Metric label="进行中任务" value={active} color="blue" />
        <Metric label="番号总量" value={codes} color="emerald" />
        <Metric label="最近完成" value={tasks.filter((task) => task.status === 'completed').length} color="orange" />
        <Metric label="系统状态" value="READY" color="pink" />
      </div>
      <Panel
        eyebrowText="RECENT ACTIVITY"
        title="最近任务"
        action={
          <button className="text-sm text-blue-600" onClick={() => setPage('tasks')}>
            查看全部 →
          </button>
        }
      >
        {tasks.length ? (
          <div>
            {tasks.map((task) => (
              <TaskRow key={task.task_id} task={task} />
            ))}
          </div>
        ) : (
          <Empty title="还没有下载任务" action="开始解析磁力" onClick={() => setPage('magnets')} />
        )}
      </Panel>
    </>
  )
}

function Metric({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'border-blue-600',
    emerald: 'border-emerald-600',
    orange: 'border-orange-500',
    pink: 'border-pink-600',
  }
  return (
    <div className={`min-h-[102px] border-t-[3px] bg-white px-5 py-4 ${colors[color]}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <strong className="mt-3 block text-3xl font-extrabold tracking-tight text-slate-800">{value}</strong>
    </div>
  )
}
function TaskRow({ task }: { task: Task }) {
  const badge =
    task.status === 'completed'
      ? 'bg-emerald-50 text-emerald-700'
      : task.status === 'failed'
        ? 'bg-rose-50 text-rose-700'
        : task.status === 'downloading'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-600'
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
          <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${badge}`}>
            {task.status}
          </span>
          <span>{Math.round(task.progress)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <i
            className="block h-full rounded-full bg-blue-600"
            style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function MagnetParser({ setError }: { setError: (error: string) => void }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [group, setGroup] = useState('')
  const parse = async () => {
    const links = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!links.length) return
    setLoading(true)
    try {
      const data = await api<{ results: any[] }>('/magnets/parse', {
        method: 'POST',
        body: JSON.stringify({ magnet_links: links }),
      })
      setResults(data.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setLoading(false)
    }
  }
  const download = async () => {
    try {
      const tasks = results
        .filter((item) => item.verified_code)
        .map((item) => ({
          magnet: item.cleaned_magnet,
          code: item.verified_code,
          force: false,
          target_group: group || undefined,
          total_size: item.files.reduce((sum: number, file: any) => sum + file.size, 0),
        }))
      await api('/magnets/batch-download', { method: 'POST', body: JSON.stringify({ tasks }) })
      setResults([])
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }
  return (
    <>
      <Panel
        eyebrowText="INGEST"
        title="批量磁力解析"
        extra={<span className="text-xs text-slate-400">每行一个 magnet URI</span>}
      >
        <textarea
          className="min-h-44 w-full resize-y rounded-md border border-slate-200 p-4 text-sm leading-7 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="magnet:?xt=urn:btih:…&dn=ABC-123"
        />
        <div className="mt-4 flex gap-2">
          <button className={`${button} bg-blue-600 text-white hover:bg-blue-700`} onClick={parse} disabled={loading}>
            {loading ? '解析中…' : '开始解析'}
          </button>
          {results.length > 0 && (
            <button className={`${button} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={download}>
              提交可下载项
            </button>
          )}
        </div>
      </Panel>
      {results.length > 0 && (
        <Panel
          eyebrowText="PARSE RESULTS"
          title={`${results.length} 个结果`}
          extra={
            <input
              className={`${input} max-w-48`}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="目标分组（可选）"
            />
          }
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-3">
            {results.map((item, index) => (
              <article className="border border-slate-200 p-4" key={`${item.cleaned_magnet}-${index}`}>
                <div className="flex items-center justify-between gap-2">
                  <strong>{item.verified_code || '未识别番号'}</strong>
                  <span
                    className={`rounded px-2 py-1 text-[10px] font-bold ${item.exists_in_library ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}
                  >
                    {item.exists_in_library ? '已存在' : '可下载'}
                  </span>
                </div>
                <p className="my-3 break-all text-[11px] text-slate-500">{item.cleaned_magnet}</p>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{item.files.length} 个有效文件</span>
                  <span>{formatBytes(item.files.reduce((sum: number, file: any) => sum + file.size, 0))}</span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </>
  )
}

function Tasks({ setError }: { setError: (error: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const load = useCallback(
    () =>
      api<{ items: Task[] }>('/tasks?page=1&page_size=100')
        .then((data) => setTasks(data.items))
        .catch((err) => setError(err.message)),
    [setError],
  )
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 10000)
    return () => window.clearInterval(timer)
  }, [load])
  return (
    <Panel
      eyebrowText="DOWNLOAD QUEUE"
      title="任务监控"
      action={
        <button className={`${button} bg-slate-100 px-3 py-2 text-xs text-slate-700`} onClick={load}>
          刷新
        </button>
      }
    >
      {tasks.length ? tasks.map((task) => <TaskRow key={task.task_id} task={task} />) : <Empty title="暂无下载任务" />}
    </Panel>
  )
}
function Codes({ setError }: { setError: (error: string) => void }) {
  const [items, setItems] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [scan, setScan] = useState('')
  const load = useCallback(
    () =>
      api<{ items: any[] }>('/codes?page=1&page_size=200&search=' + encodeURIComponent(search))
        .then((data) => setItems(data.items))
        .catch((err) => setError(err.message)),
    [search, setError],
  )
  useEffect(() => {
    load()
  }, [load])
  const startScan = async () => {
    try {
      const data = await api<{ task_id: string }>('/codes/scan', { method: 'POST', body: JSON.stringify({}) })
      setScan(data.task_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败')
    }
  }
  return (
    <Panel
      eyebrowText="LIBRARY INDEX"
      title={`番号库 ${items.length}`}
      extra={
        <div className="flex gap-2 max-[600px]:grid">
          <input
            className={`${input} max-w-48`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="搜索番号"
          />
          <button className={`${button} bg-slate-100 px-3 py-2 text-xs text-slate-700`} onClick={startScan}>
            扫描探测路径
          </button>
        </div>
      }
    >
      {scan && <Alert tone="info">扫描任务已启动：{scan}</Alert>}
      <div className="overflow-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-slate-400">
              <th className="border-t border-slate-100 px-2 py-3">番号</th>
              <th className="border-t border-slate-100 px-2 py-3">文件</th>
              <th className="border-t border-slate-100 px-2 py-3">路径</th>
              <th className="border-t border-slate-100 px-2 py-3">大小</th>
              <th className="border-t border-slate-100 px-2 py-3">发现时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.code}-${item.file_name}`}>
                <td className="border-t border-slate-100 px-2 py-3 font-bold">{item.code}</td>
                <td className="border-t border-slate-100 px-2 py-3">{item.file_name}</td>
                <td className="border-t border-slate-100 px-2 py-3 text-slate-500">{item.storage_path}</td>
                <td className="border-t border-slate-100 px-2 py-3">{formatBytes(item.file_size)}</td>
                <td className="border-t border-slate-100 px-2 py-3">
                  {new Date(item.discovered_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <Empty title="番号库为空" />}
    </Panel>
  )
}
function Storages({ setError }: { setError: (error: string) => void }) {
  const [groups, setGroups] = useState<any[]>([])
  const [storages, setStorages] = useState<any[]>([])
  useEffect(() => {
    Promise.all([api<{ groups: any[] }>('/storage-groups'), api<{ storages: any[] }>('/storages')])
      .then(([a, b]) => {
        setGroups(a.groups)
        setStorages(b.storages)
      })
      .catch((err) => setError(err.message))
  }, [setError])
  return (
    <>
      <div className="mb-5 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
        {storages.map((item) => (
          <Metric
            key={item.id}
            label={item.mount_path}
            value={item.free_space == null ? '—' : formatBytes(item.free_space)}
            color="blue"
          />
        ))}
      </div>
      <Panel eyebrowText="STORAGE TOPOLOGY" title="存储分组">
        {groups.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-3">
            {groups.map((group) => (
              <article className="border border-slate-200 p-4" key={group.id}>
                <div className="flex items-center justify-between">
                  <strong>{group.name}</strong>
                  <span className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                    {group.storage_paths.length} 路径
                  </span>
                </div>
                {group.storage_paths.map((path: string) => (
                  <p className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-500" key={path}>
                    ◫ {path}
                  </p>
                ))}
              </article>
            ))}
          </div>
        ) : (
          <Empty title="尚未配置存储分组" />
        )}
      </Panel>
    </>
  )
}
function Settings({ setError }: { setError: (error: string) => void }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api<Config>('/config')
      .then(setConfig)
      .catch((err) => setError(err.message))
  }, [setError])
  if (!config)
    return (
      <Panel title="系统设置">
        <p className="text-sm text-slate-500">加载配置中…</p>
      </Panel>
    )
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const data = await api<Config>('/config', { method: 'PUT', body: JSON.stringify(config) })
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Panel eyebrowText="RUNTIME CONFIG" title="系统设置">
      <form className="grid grid-cols-2 gap-5 max-[600px]:grid-cols-1" onSubmit={save}>
        <Field label="OpenList 地址">
          <input
            className={input}
            value={config.openlist.base_url}
            onChange={(e) => setConfig({ ...config, openlist: { ...config.openlist, base_url: e.target.value } })}
            placeholder="http://localhost:5244"
          />
        </Field>
        <Field label="认证方式">
          <select
            className={input}
            value={config.openlist.auth_type}
            onChange={(e) => setConfig({ ...config, openlist: { ...config.openlist, auth_type: e.target.value } })}
          >
            <option value="token">Token</option>
            <option value="password">账号密码</option>
          </select>
        </Field>
        <Field label="BT 解析服务">
          <input
            className={input}
            value={config.bt_parser.service_url}
            onChange={(e) => setConfig({ ...config, bt_parser: { ...config.bt_parser, service_url: e.target.value } })}
            placeholder="http://localhost:8080"
          />
        </Field>
        <Field label="最小文件大小（MB）">
          <input
            className={input}
            type="number"
            value={config.filter.min_file_size_mb}
            onChange={(e) =>
              setConfig({ ...config, filter: { ...config.filter, min_file_size_mb: Number(e.target.value) } })
            }
          />
        </Field>
        <Field label="视频扩展名（逗号分隔）">
          <input
            className={input}
            value={config.filter.allowed_extensions.join(',')}
            onChange={(e) =>
              setConfig({
                ...config,
                filter: {
                  ...config.filter,
                  allowed_extensions: e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </Field>
        <div className="col-span-full">
          <button className={`${button} bg-blue-600 text-white hover:bg-blue-700`} type="submit" disabled={saving}>
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </form>
    </Panel>
  )
}

function Panel({
  eyebrowText,
  title,
  action,
  extra,
  children,
}: {
  eyebrowText?: string
  title: string
  action?: ReactNode
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mb-5 border border-slate-200 bg-white p-7 max-[600px]:p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          {eyebrowText && <p className={eyebrow}>{eyebrowText}</p>}
          <h3 className="text-lg font-extrabold text-slate-800">{title}</h3>
        </div>
        {action || extra}
      </div>
      {children}
    </section>
  )
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-xs font-bold text-slate-600">
      {label}
      {children}
    </label>
  )
}
function Alert({ tone, children, onClose }: { tone: 'error' | 'info'; children: ReactNode; onClose?: () => void }) {
  return (
    <div
      className={`mb-5 flex items-center justify-between rounded-md px-3.5 py-3 text-sm ${tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}
    >
      {children}
      {onClose && (
        <button className="ml-4 bg-transparent text-lg" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  )
}
function Empty({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) {
  return (
    <div className="py-10 text-center text-sm text-slate-500">
      <span className="mb-2 block text-3xl text-slate-300">∅</span>
      <p>{title}</p>
      {action && (
        <button className="mt-2 bg-transparent text-sm text-blue-600" onClick={onClick}>
          {action} →
        </button>
      )}
    </div>
  )
}
function formatBytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

export default App

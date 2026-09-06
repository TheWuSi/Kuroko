import { useState, type FormEvent } from 'react'
import { bootstrap, getCurrentUser, login } from '../../api/auth'
import type { User } from '../../types/api'
import { Alert } from '../ui/Alert'
import { Field } from '../ui/Field'
import { button, eyebrow, input } from '../ui/styles'

export function AuthForm({ isBootstrap = false, onDone }: { isBootstrap?: boolean; onDone: (token: string, user: User) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (isBootstrap && password !== confirm) return setError('两次密码不一致')
    try {
      const auth = isBootstrap ? await bootstrap(username, password) : await login(username, password)
      const user = await getCurrentUser(auth.token)
      onDone(auth.token, user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-5"><form className="w-full max-w-[420px] border border-slate-200 bg-white p-8 shadow-[0_14px_40px_rgba(18,32,43,0.06)] sm:p-10" onSubmit={submit}><div className="mb-6 grid h-11 w-11 place-items-center rounded-xl bg-slate-800 text-xl font-extrabold text-white">K</div><p className={eyebrow}>KUROKO CONTROL</p><h1 className="mb-2 text-3xl font-extrabold tracking-tight text-slate-900">{isBootstrap ? '创建管理员' : '登录工作台'}</h1><p className="mb-7 text-sm text-slate-500">{isBootstrap ? '首次使用请设置唯一管理员账号。' : '管理磁力解析、离线下载与存储资产。'}</p><Field label="用户名"><input className={input} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></Field><Field label="密码"><input className={input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isBootstrap ? 'new-password' : 'current-password'} required minLength={8} /></Field>{isBootstrap && <Field label="确认密码"><input className={input} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required minLength={8} /></Field>}{error && <Alert tone="error">{error}</Alert>}<button className={`${button} mt-6 w-full bg-blue-600 text-white hover:bg-blue-700`} type="submit">{isBootstrap ? '完成初始化' : '进入系统'}</button></form></main>
}

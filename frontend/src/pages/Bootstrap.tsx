import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sparkles, ShieldCheck, User, KeyRound, Loader2, ArrowRight } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'

export function Bootstrap() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const { initialized, checkAuth } = useAuthStore()

  // 若系统已经完成初始化，直接重定向至登录页
  useEffect(() => {
    if (initialized === true) {
      navigate('/login', { replace: true })
    }
  }, [initialized, navigate])

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUser = username.trim()
    if (!trimmedUser || !password) {
      toast.warning('请填写完整的账号与密码')
      return
    }
    if (password.length < 8) {
      toast.warning('密码长度至少为 8 位字符')
      return
    }
    if (password !== confirmPassword) {
      toast.warning('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    try {
      await authService.bootstrap(trimmedUser, password)
      toast.success('系统初始化完成，已自动登录管理员账号')
      await checkAuth()
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '初始化失败'
      toast.error(msg)
      // 若后端提示已初始化，引导跳转回登录页
      if (msg.includes('已完成初始化')) {
        await checkAuth()
        navigate('/login', { replace: true })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-slate-50">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 mb-3">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Kuroko 初始化向导</h1>
          <p className="text-sm text-slate-500 mt-1">系统首次部署，请创建首个超级管理员账号</p>
        </div>

        <Card className="shadow-lg border-slate-200/80">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Step 1 of 1 · Bootstrap</span>
            </div>
            <CardTitle>创建超级管理员</CardTitle>
            <CardDescription>该凭据将用于系统登录、OpenList 离线调度及核心敏感配置管理</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBootstrap} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">管理员用户名</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="text"
                    required
                    autoFocus
                    className="pl-10 font-mono"
                    placeholder="请输入管理员用户名"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 block">登录密码</label>
                  <span className="text-[11px] text-slate-400">至少 8 位字符</span>
                </div>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="password"
                    required
                    placeholder="至少 8 位字符"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">确认密码</label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="password"
                    required
                    placeholder="请再次输入相同密码"
                    className="pl-10"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full mt-2 min-h-11 text-base font-semibold"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在创建管理员账号...
                  </>
                ) : (
                  <>
                    完成初始化并进入系统
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>系统已完成过初始化？</span>
              <Link
                to="/login"
                className="font-medium text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                直接登录
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

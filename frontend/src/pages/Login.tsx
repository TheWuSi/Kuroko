import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sparkles, KeyRound, User as UserIcon, Loader2, AlertCircle, ShieldAlert } from 'lucide-react'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import { loginReturnPath } from '@/lib/authSession'

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { initialized, checkAuth } = useAuthStore()

  // 若检测到系统尚未完成初始化，自动引导进入初始化向导
  useEffect(() => {
    if (initialized === false) {
      navigate('/bootstrap', { replace: true })
    }
  }, [initialized, navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUser = username.trim()
    if (!trimmedUser || !password) {
      toast.warning('请输入用户名和密码')
      return
    }

    if (password.length < 8) {
      toast.warning('密码长度至少为 8 位字符')
      return
    }

    setSubmitting(true)
    try {
      await authService.login(trimmedUser, password)
      toast.success('登录成功')
      if (await checkAuth()) navigate(loginReturnPath(location.state?.from), { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-slate-50">
      <div className="w-full max-w-md">
        {/* 品牌 Logo 标题 */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 mb-3">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Kuroko</h1>
          <p className="text-sm text-slate-500 mt-1 font-mono">
            番号管理与自动化离线下载调度系统
          </p>
        </div>

        {/* 尚未初始化警示条（若状态未更新时的防御性提示） */}
        {initialized === false && (
          <div className="mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              检测到系统尚未初始化，请先创建首个超级管理员账号。
            </div>
            <Link
              to="/bootstrap"
              className="font-semibold text-amber-900 underline hover:text-amber-700 whitespace-nowrap"
            >
              前往初始化
            </Link>
          </div>
        )}

        {/* 登录卡片 */}
        <Card className="shadow-lg border-slate-200/80">
          <CardHeader className="pb-4">
            <CardTitle>管理员登录</CardTitle>
            <CardDescription>请输入凭据以访问控制台</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">
                  用户名
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="text"
                    required
                    autoFocus
                    className="pl-10"
                    placeholder="请输入管理员用户名"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 block">
                    密码
                  </label>
                  <span className="text-[11px] text-slate-400">至少 8 位字符</span>
                </div>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    type="password"
                    required
                    className="pl-10"
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full mt-2 min-h-[44px] text-base font-semibold"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在验证凭据...
                  </>
                ) : (
                  '立即登录'
                )}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />
                受保护的内部管理系统
              </span>
              <span className="font-mono text-[11px]">v2.1</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Server,
  Radio,
  Filter,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  X,
} from 'lucide-react'
import { configService } from '@/services/config.service'
import { toast } from '@/stores/uiStore'
import type { SystemConfigData } from '@/types/api'

export function Settings() {
  const [config, setConfig] = useState<SystemConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 测试状态
  const [testingOpenList, setTestingOpenList] = useState(false)
  const [openListTestResult, setOpenListTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const [testingBt, setTestingBt] = useState(false)
  const [btTestResult, setBtTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // 扩展名标签输入
  const [newExt, setNewExt] = useState('')
  const [newBlacklist, setNewBlacklist] = useState('')

  useEffect(() => {
    configService
      .getConfig()
      .then((data) => setConfig(data))
      .catch((err) => toast.error(err instanceof Error ? err.message : '加载系统设置失败'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) return
    setSaving(true)
    try {
      const updated = await configService.updateConfig(config)
      setConfig(updated)
      toast.success('系统配置已成功保存并即时生效')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存配置失败'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  // 测试 OpenList
  const handleTestOpenList = async () => {
    if (!config) return
    setTestingOpenList(true)
    setOpenListTestResult(null)
    try {
      const res = await configService.testOpenList(config.openlist)
      if (res.connected) {
        setOpenListTestResult({
          success: true,
          message: `连接成功 (OpenList 版本: ${res.version || '未知'}, 延时: ${res.latency_ms ?? 0}ms)`,
        })
      } else {
        setOpenListTestResult({ success: false, message: '未能连接到指定 OpenList 服务' })
      }
    } catch (err: unknown) {
      setOpenListTestResult({
        success: false,
        message: err instanceof Error ? err.message : '连接测试发生错误',
      })
    } finally {
      setTestingOpenList(false)
    }
  }

  // 测试 magnet-metadata-api
  const handleTestBtParser = async () => {
    if (!config) return
    setTestingBt(true)
    setBtTestResult(null)
    try {
      const res = await configService.testBtParser({ service_url: config.bt_parser.service_url })
      if (res.connected) {
        setBtTestResult({
          success: true,
          message: `服务就绪 (${res.service_name || 'DHT Engine'}, 延时: ${res.latency_ms ?? 0}ms)`,
        })
      } else {
        setBtTestResult({ success: false, message: 'BT 元数据解析服务未响应' })
      }
    } catch (err: unknown) {
      setBtTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'BT 服务测试失败',
      })
    } finally {
      setTestingBt(false)
    }
  }

  // 添加扩展名
  const handleAddExt = () => {
    if (!newExt.trim() || !config) return
    let val = newExt.trim().toLowerCase()
    if (!val.startsWith('.')) val = `.${val}`
    if (!config.filter.allowed_extensions.includes(val)) {
      setConfig({
        ...config,
        filter: {
          ...config.filter,
          allowed_extensions: [...config.filter.allowed_extensions, val],
        },
      })
    }
    setNewExt('')
  }

  // 删除扩展名
  const handleRemoveExt = (ext: string) => {
    if (!config) return
    setConfig({
      ...config,
      filter: {
        ...config.filter,
        allowed_extensions: config.filter.allowed_extensions.filter((e) => e !== ext),
      },
    })
  }

  // 添加黑名单正则
  const handleAddBlacklist = () => {
    if (!newBlacklist.trim() || !config) return
    const val = newBlacklist.trim()
    if (!config.filter.blacklist_patterns.includes(val)) {
      setConfig({
        ...config,
        filter: {
          ...config.filter,
          blacklist_patterns: [...config.filter.blacklist_patterns, val],
        },
      })
    }
    setNewBlacklist('')
  }

  // 删除黑名单正则
  const handleRemoveBlacklist = (pattern: string) => {
    if (!config) return
    setConfig({
      ...config,
      filter: {
        ...config.filter,
        blacklist_patterns: config.filter.blacklist_patterns.filter((p) => p !== pattern),
      },
    })
  }

  if (loading || !config) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="系统参数配置"
        description="维护 OpenList 聚合连接、BT 元数据解析服务、内容过滤规则及定向探测路径"
      >
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存全部配置
        </Button>
      </PageHeader>

      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. OpenList 连接配置 */}
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-blue-600">
              <Server className="h-5 w-5" />
              <CardTitle>OpenList 服务连接</CardTitle>
            </div>
            <CardDescription>
              Kuroko 离线下载与文件管理底层生态，支持账号密码或 API Token 鉴权
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700 block">服务 Base URL</label>
                <Input
                  placeholder="http://localhost:5244"
                  value={config.openlist.base_url}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      openlist: { ...config.openlist, base_url: e.target.value },
                    })
                  }
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">认证模式</label>
                <select
                  value={config.openlist.auth_type}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      openlist: {
                        ...config.openlist,
                        auth_type: e.target.value as 'password' | 'token',
                      },
                    })
                  }
                  className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm"
                >
                  <option value="password">账号密码模式 (自动换取与刷新 Token)</option>
                  <option value="token">Direct Token 模式 (直连长效令牌)</option>
                </select>
              </div>

              {config.openlist.auth_type === 'password' ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 block">用户名</label>
                    <Input
                      value={config.openlist.username || ''}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          openlist: { ...config.openlist, username: e.target.value },
                        })
                      }
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-700 block">密码</label>
                    <Input
                      type="password"
                      placeholder="已隐藏或留空以保持现有密码"
                      value={config.openlist.password || ''}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          openlist: { ...config.openlist, password: e.target.value },
                        })
                      }
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700 block">API Token</label>
                  <Input
                    type="password"
                    placeholder="请输入 OpenList API Token"
                    value={config.openlist.token || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        openlist: { ...config.openlist, token: e.target.value },
                      })
                    }
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestOpenList}
                disabled={testingOpenList}
                className="gap-2 text-xs"
              >
                {testingOpenList ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Server className="h-3.5 w-3.5" />
                )}
                测试 OpenList 连通性
              </Button>
              {openListTestResult && (
                <span
                  className={`text-xs flex items-center gap-1.5 font-medium ${
                    openListTestResult.success ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {openListTestResult.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  {openListTestResult.message}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2. magnet-metadata-api 服务配置 */}
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-blue-600">
              <Radio className="h-5 w-5" />
              <CardTitle>BT 元数据解析服务 (magnet-metadata-api)</CardTitle>
            </div>
            <CardDescription>
              对接 Go 语言高性能 DHT 元数据提取服务，用于快速抓取种子内部文件树与体积
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-700 block">服务 URL</label>
                <Input
                  placeholder="http://localhost:8080"
                  value={config.bt_parser.service_url}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      bt_parser: { ...config.bt_parser, service_url: e.target.value },
                    })
                  }
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">请求超时 (秒)</label>
                <Input
                  type="number"
                  min="10"
                  max="120"
                  value={config.bt_parser.timeout_seconds || 45}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      bt_parser: {
                        ...config.bt_parser,
                        timeout_seconds: Number(e.target.value) || 45,
                      },
                    })
                  }
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestBtParser}
                disabled={testingBt}
                className="gap-2 text-xs"
              >
                {testingBt ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Radio className="h-3.5 w-3.5" />
                )}
                测试 BT 解析服务
              </Button>
              {btTestResult && (
                <span
                  className={`text-xs flex items-center gap-1.5 font-medium ${
                    btTestResult.success ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {btTestResult.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  {btTestResult.message}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 3. 过滤规则管道 */}
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-blue-600">
              <Filter className="h-5 w-5" />
              <CardTitle>内容过滤管道规则</CardTitle>
            </div>
            <CardDescription>
              在解析种子文件与探测扫描时自动过滤宣传垃圾文件、小样本及夹带广告
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* 扩展名 Tags */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                允许的视频扩展名白名单
              </label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-slate-200 bg-slate-50/50 min-h-[44px] items-center">
                {config.filter.allowed_extensions.map((ext) => (
                  <Badge
                    key={ext}
                    variant="outline"
                    className="font-mono text-xs gap-1 bg-white pl-2 pr-1 py-1"
                  >
                    {ext}
                    <button
                      type="button"
                      onClick={() => handleRemoveExt(ext)}
                      className="hover:text-rose-600 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="输入扩展名，如 .mp4 或 mkv"
                  value={newExt}
                  onChange={(e) => setNewExt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddExt()
                    }
                  }}
                  className="max-w-xs font-mono text-xs"
                />
                <Button type="button" variant="secondary" size="sm" onClick={handleAddExt}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  添加
                </Button>
              </div>
            </div>

            {/* 最小体积 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                最小多媒体文件大小 (MB)
              </label>
              <Input
                type="number"
                min="0"
                value={config.filter.min_file_size_mb}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    filter: {
                      ...config.filter,
                      min_file_size_mb: Number(e.target.value) || 0,
                    },
                  })
                }
                className="max-w-xs font-mono text-sm"
              />
              <p className="text-[11px] text-slate-400">小于该体积的文件将被视为广告或宣传样片并自动过滤</p>
            </div>

            {/* 正则黑名单 */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                广告与黑名单关键词正则表达式
              </label>
              <div className="space-y-1.5">
                {config.filter.blacklist_patterns.map((pattern) => (
                  <div
                    key={pattern}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs"
                  >
                    <span className="text-slate-800 truncate">{pattern}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBlacklist(pattern)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="输入正则表达式，例如: .*广告.* 或 .*t.me.*"
                  value={newBlacklist}
                  onChange={(e) => setNewBlacklist(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddBlacklist()
                    }
                  }}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="secondary" size="sm" onClick={handleAddBlacklist}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  添加正则
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

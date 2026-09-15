import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageVersion: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export function normalizeVersion(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 128) return null
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/.exec(value)
  if (!match || match[2]?.split('.').some((part) => /^0\d+$/.test(part))) return null
  return match[1]
}

export function resolveAppVersion({ root = repositoryRoot, version = process.env.KUROKO_VERSION, fallback = packageVersion } = {}): string {
  if (version) {
    const normalized = normalizeVersion(version)
    if (!normalized) throw new Error('KUROKO_VERSION 必须是有效的版本标签，例如 v0.5.0')
    return normalized
  }

  // 发布镜像不携带 .git，由构建参数传入 tag；源码开发读取当前提交可追溯的最新 tag。
  if (existsSync(path.join(root, '.git'))) {
    try {
      const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--match', '[0-9]*'], {
        cwd: root, encoding: 'utf8', timeout: 2000, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      const normalized = normalizeVersion(tag)
      if (normalized) return normalized
    } catch { /* 源码包或无标签的浅克隆使用项目元数据。 */ }
  }

  const normalized = normalizeVersion(fallback)
  if (!normalized) throw new Error('前端项目元数据缺少有效版本号')
  return normalized
}

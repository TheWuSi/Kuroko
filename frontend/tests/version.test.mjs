import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeVersion, resolveAppVersion } from '../scripts/version.ts'

test('界面版本移除 v 前缀，保留预发布与构建标记，并拒绝无效输入', () => {
  for (const [input, expected] of [['v0.5.0', '0.5.0'], ['1.2.3', '1.2.3'], ['v1.2.3-rc.1+build.7', '1.2.3-rc.1+build.7']]) {
    assert.equal(normalizeVersion(input), expected)
  }
  for (const input of [null, 5, '', 'latest', 'v01.2.3', 'v1.2', 'v1.2.3-rc.01', 'v1.2.3\n', '1.2.3+<script>', '1'.repeat(129)]) {
    assert.equal(normalizeVersion(input), null)
  }
})

test('发布参数优先，源码开发跟随可追溯的 Git tag，无仓库时使用元数据', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kuroko-version-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const resolve = (version = '') => resolveAppVersion({ root, version, fallback: '0.5.0' })
  assert.equal(resolve(), '0.5.0')
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git('init')
  git('-c', 'user.name=Kuroko Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '版本测试')
  git('tag', 'v0.6.0')
  assert.equal(resolve(), '0.6.0')
  git('-c', 'user.name=Kuroko Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '版本后的开发提交')
  assert.equal(resolve(), '0.6.0')
  assert.equal(resolve('v0.7.0-rc.1'), '0.7.0-rc.1')
  assert.throws(() => resolve('latest'), /KUROKO_VERSION/)
})

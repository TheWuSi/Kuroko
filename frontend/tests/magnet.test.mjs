import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanBatchMagnets, cleanMagnetUri } from '../src/lib/magnet.ts'

const hash = '0123456789abcdef0123456789abcdef01234567'

test('批量净化保持 URN 冒号，去除 Tracker 并修复旧编码', () => {
  const input = [
    `magnet:?xt=urn:btih:${hash}&dn=ABC-123&tr=https://tracker.invalid`,
    `magnet:?xt=urn%3Abtih%3A${hash.toUpperCase()}&tr=udp://tracker.invalid`,
  ].join('\n')
  const result = cleanBatchMagnets(input)
  assert.deepEqual(result.validMagnets, [
    `magnet:?xt=urn:btih:${hash}&dn=ABC-123`,
    `magnet:?xt=urn:btih:${hash}`,
  ])
  assert.equal(result.totalTrackersRemoved, 2)
  assert.equal(cleanBatchMagnets(result.cleanedText).cleanedText, result.cleanedText)
})

test('显示名中的中文与参数分隔符编码后仍可还原', () => {
  const dn = '中文 &tr=保留在名称 #1'
  const result = cleanMagnetUri(`magnet:?dn=${encodeURIComponent(dn)}&xt=urn:btih:${hash}`)
  assert.equal(result.dn, dn)
  const params = new URLSearchParams(result.cleaned.slice(8))
  assert.equal(params.get('dn'), dn)
  assert.deepEqual([...params.keys()], ['xt', 'dn'])
})

test('规范化 Base32 并拒绝无效 Hash 和控制字符', () => {
  assert.equal(cleanMagnetUri(`magnet:?xt=urn:btih:${'A'.repeat(32)}`).infoHash, '0'.repeat(40))
  assert.equal(cleanMagnetUri(`magnet:?xt=urn:btih:${'g'.repeat(40)}`), null)
  assert.equal(cleanMagnetUri(`magnet:?xt=urn:btih:${hash}\u0000`), null)
})

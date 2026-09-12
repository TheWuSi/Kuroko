import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeStorage } from '../src/lib/storage.ts'

test('未知容量按零汇总，忽略节点不参与统计', () => {
  assert.deepEqual(summarizeStorage([
    { total_space: 1000, free_space: 400, ignored: false },
    { total_space: null, free_space: null, ignored: false },
    { total_space: 9000, free_space: 8000, ignored: true },
  ]), { total: 1000, free: 400, unknown: 1, count: 2 })
  assert.equal(summarizeStorage([{ total_space: null, free_space: null }]).free, 0)
  assert.equal(summarizeStorage([]).free, 0)
})

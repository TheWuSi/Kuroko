import assert from 'node:assert/strict'
import test from 'node:test'
import { createMagnetDraft, DRAFT_PREFIX } from '../src/lib/magnetDraft.ts'

class MemoryStorage {
  values = new Map()
  fail = false
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { if (this.fail) throw new Error('配额已满'); this.values.set(key, value) }
}
const jobId = '11111111-1111-4111-8111-111111111111'
const submissionId = '22222222-2222-4222-8222-222222222222'
const links = Array.from({ length: 60 }, (_, index) => `magnet:?xt=urn:btih:${(index + 1).toString(16).padStart(40, '0')}&dn=ABC-${index + 100}`)
function setup() {
  const storage = new MemoryStorage()
  const cache = createMagnetDraft(() => storage)
  cache.initialize(1)
  return { storage, cache }
}
function parsed(cache) {
  cache.edit({ text: links.join('\n'), targetPath: '/drive/Video', selectedStorage: '73' })
  const request = cache.beginParse({ target_path: '/drive/Video' })
  const job = { job_id: jobId, request_id: request.requestId, scope: request.scope,
    items: links.map((magnet, index) => ({ index, magnet })), outcomes: [] }
  cache.bindJob(job)
  return job
}
function submitted(cache, statuses) {
  const request = cache.beginSubmission(jobId, links.map((_, index) => index), { target_path: '/drive/Video' }, false)
  return { submission_id: submissionId, job_id: jobId, request_id: request.requestId, status: 'completed',
    items: statuses.map((status, index) => ({ index, status, result: null })) }
}

test('60 条磁力和半截输入即时保存，切页、关页、重登后原样恢复，账号隔离', () => {
  const { cache, storage } = setup()
  const draft = `${links.join('\n')}\nmagnet:?xt=还没输完`
  cache.edit({ text: draft, targetPath: '/drive/Video' })
  const reloaded = createMagnetDraft(() => storage)
  reloaded.initialize(1)
  assert.equal(reloaded.store.getState().draft.text, draft)
  reloaded.initialize(null)
  reloaded.initialize(2)
  assert.equal(reloaded.store.getState().draft.text, '')
  reloaded.initialize(1)
  assert.equal(reloaded.store.getState().draft.text, draft)
  assert.equal(reloaded.store.getState().draft.targetPath, '/drive/Video')
})

test('创建解析响应丢失后保留同一请求编号，不创建第二批任务', () => {
  const { cache, storage } = setup()
  cache.edit({ text: links.join('\n') })
  const first = cache.beginParse({})
  const reloaded = createMagnetDraft(() => storage)
  reloaded.initialize(1)
  assert.equal(reloaded.beginParse({}).requestId, first.requestId)
  reloaded.bindJob({ job_id: jobId, request_id: first.requestId, items: links.map((magnet, index) => ({ magnet, index })) })
  assert.equal(reloaded.store.getState().draft.jobId, jobId)
})

test('部分成功只移走已确认项，重复跳过、失败和待核实仍在输入框', () => {
  const { cache } = setup()
  parsed(cache)
  const response = submitted(cache, [...Array(56).fill('submitted'), 'skipped', 'skipped', 'unknown', 'failed'])
  response.items[56].result = { reason: 'already_submitted' }
  response.items[57].result = { reason: 'already_exists' }
  cache.acceptSubmission(response)
  assert.equal(cache.store.getState().draft.text, links.slice(57).join('\n'))
  assert.deepEqual(cache.store.getState().draft.indices, [57, 58, 59])
  assert.equal(cache.store.getState().submissionRequest, null)
  assert.equal(cache.store.getState().draft.jobId, jobId)
})

test('全部成功清空输入并保留位置，恢复历史能一键撤销且不自动提交', () => {
  const { cache, storage } = setup()
  const job = parsed(cache)
  cache.acceptSubmission(submitted(cache, Array(60).fill('submitted')))
  assert.equal(cache.store.getState().draft.text, '')
  assert.equal(cache.store.getState().draft.targetPath, '/drive/Video')
  const reloaded = createMagnetDraft(() => storage)
  reloaded.initialize(1)
  assert.equal(reloaded.store.getState().draft.text, '')
  reloaded.edit({ text: '用户的新草稿' })
  assert.equal(reloaded.restore(job), true)
  assert.equal(reloaded.store.getState().draft.text, links.join('\n'))
  assert.equal(reloaded.store.getState().submissionRequest, null)
  assert.equal(reloaded.undo(), true)
  assert.equal(reloaded.store.getState().draft.text, '用户的新草稿')
  assert.equal(reloaded.undo(), false)
})

test('后台提交完成不能覆盖后来编辑的新草稿', () => {
  const { cache } = setup()
  parsed(cache)
  const response = submitted(cache, Array(60).fill('submitted'))
  cache.edit({ text: '新一批尚未完成的输入' })
  cache.acceptSubmission(response)
  assert.equal(cache.store.getState().draft.text, '新一批尚未完成的输入')
  assert.equal(cache.store.getState().submissionRequest, null)
})

test('刷新后仍能核对提交结果并清空成功项；重复接受结果不会清除新输入', () => {
  const { cache, storage } = setup()
  parsed(cache)
  const response = submitted(cache, Array(60).fill('submitted'))
  cache.acceptSubmission({ ...response, status: 'running' })
  const reloaded = createMagnetDraft(() => storage)
  reloaded.initialize(1)
  assert.equal(reloaded.store.getState().submissionRequest.submissionId, submissionId)
  reloaded.acceptSubmission(response)
  assert.equal(reloaded.store.getState().draft.text, '')
  reloaded.edit({ text: '新输入' })
  reloaded.acceptSubmission(response)
  assert.equal(reloaded.store.getState().draft.text, '新输入')
})

test('缓存写入失败保留输入，恢复及自动清空必须先成功保存', () => {
  const { cache, storage } = setup()
  const job = parsed(cache)
  const response = submitted(cache, Array(60).fill('submitted'))
  storage.fail = true
  cache.acceptSubmission(response)
  assert.equal(cache.store.getState().draft.text, links.join('\n'))
  assert.match(cache.store.getState().error, /未能写入/)
  cache.edit({ text: '最新输入仍显示' })
  assert.equal(cache.store.getState().draft.text, '最新输入仍显示')
  assert.equal(cache.restore(job), false)
  assert.equal(cache.store.getState().draft.text, '最新输入仍显示')
})

test('损坏草稿不崩溃也不删除原缓存', () => {
  const { cache, storage } = setup()
  storage.setItem(DRAFT_PREFIX + '2', '{broken')
  cache.initialize(2)
  assert.equal(cache.store.getState().draft.text, '')
  assert.match(cache.store.getState().error, /无法读取/)
  assert.equal(storage.getItem(DRAFT_PREFIX + '2'), '{broken')
})

test('另一标签页更新草稿后，旧标签页的提交完成不能覆盖磁盘上的新输入', () => {
  const { cache, storage } = setup()
  parsed(cache)
  const response = submitted(cache, Array(60).fill('submitted'))
  const second = createMagnetDraft(() => storage)
  second.initialize(1)
  second.edit({ text: '另一标签页的新草稿' })
  cache.acceptSubmission(response)
  assert.equal(JSON.parse(storage.getItem(DRAFT_PREFIX + '1')).draft.text, '另一标签页的新草稿')
  cache.sync()
  assert.equal(cache.store.getState().draft.text, '另一标签页的新草稿')
  cache.acceptSubmission(response)
  assert.equal(cache.store.getState().draft.text, '另一标签页的新草稿')
})

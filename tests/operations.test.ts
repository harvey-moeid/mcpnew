import test from 'node:test'
import assert from 'node:assert/strict'
import { requireConfirmation, waitForRun, probeUrl } from '../src/operations.ts'

const run = (id: number, sha: string, overrides = {}) => ({ id, head_sha: sha, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', html_url: 'https://github.com/run/' + id, created_at: new Date().toISOString(), ...overrides })

test('confirmation requires exact target, including case and repo', () => {
  for (const value of [undefined, true, 'yes', 'other/repo@main', 'owner/repo@MAIN']) {
    assert.throws(() => requireConfirmation(value, 'owner/repo@main'), /Confirmation required/)
  }
  assert.doesNotThrow(() => requireConfirmation('owner/repo@main', 'owner/repo@main'))
})

test('workflow polling ignores wrong commit, old dispatch and push runs', async () => {
  const now = Date.now()
  const result = await waitForRun(async () => [run(1, 'other'), run(2, 'target', { created_at: new Date(now - 60000).toISOString() }), run(3, 'target', { event: 'push' }), run(4, 'target')], { sha: 'target', after: now, timeoutMs: 100, intervalMs: 1 })
  assert.equal(result.id, 4)
})

test('workflow polling pins run ID across polls and returns failures', async () => {
  let calls = 0
  const result = await waitForRun(async () => ++calls === 1 ? [run(4, 'target', { status: 'in_progress' })] : [run(5, 'target'), run(4, 'target', { conclusion: 'failure' })], { sha: 'target', timeoutMs: 1000, intervalMs: 1 })
  assert.equal(result.id, 4)
  assert.equal(result.conclusion, 'failure')
  await assert.rejects(waitForRun(async () => [], { timeoutMs: 10, intervalMs: 1 }), /run_id or commit_sha/)
  await assert.rejects(waitForRun(async () => [], { sha: 'target', timeoutMs: 10, intervalMs: 1 }), /Timed out/)
})

test('smoke probe retries status/content failures and records timing', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('not ready', { status: 503 }) : new Response('healthy service'))
  const result = await probeUrl({ url: 'https://example.test', expectedStatus: 200, expectedText: 'healthy', timeoutMs: 1000, attempts: 3, delayMs: 0 })
  assert.equal(result.ok, true)
  assert.equal(result.attempts.length, 2)
  assert.ok(result.attempts.every(a => a.elapsed_ms >= 0))
})

test('smoke probe rejects wrong content and hides reflected network errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('wrong content'))
  const options = { url: 'https://example.test', expectedStatus: 200, expectedText: 'healthy', timeoutMs: 1000, attempts: 1, delayMs: 0 }
  assert.equal((await probeUrl(options)).ok, false)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('sensitive value') })
  assert.ok(!JSON.stringify(await probeUrl(options)).includes('sensitive value'))
})

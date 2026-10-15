import test from 'node:test'
import assert from 'node:assert/strict'
import { listPagesProjects, getPagesProject, listPagesDeployments, triggerPagesDeployment, rollbackWorker, verifyCloudflareToken } from '../src/cloudflare.ts'
const env = { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private-token' } as Env

test('all Pages tools use the expected API paths, pagination and form format', async t => {
  const calls: Array<{ url: string; options: RequestInit }> = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options }); return Response.json({ success: true, result: [] })
  })
  await listPagesProjects(env)
  await listPagesProjects(env, 2, 10)
  await getPagesProject(env, 'example')
  await listPagesDeployments(env, 'example', 5, 3)
  await triggerPagesDeployment(env, 'example', 'staging')
  assert.match(calls[0].url, /projects\?page=1&per_page=10$/)
  assert.match(calls[1].url, /projects\?page=2&per_page=10$/)
  assert.match(calls[2].url, /projects\/example$/)
  assert.match(calls[3].url, /deployments\?page=3&per_page=5$/)
  assert.ok(calls[4].options.body instanceof FormData)
  assert.equal((calls[4].options.body as FormData).get('branch'), 'staging')
  assert.equal(new Headers(calls[4].options.headers).has('Content-Type'), false)
})

test('rollback only deploys the explicitly chosen version and token verification omits extras', async t => {
  const calls: Array<{ url: string; options: RequestInit }> = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options })
    return Response.json({ success: true, result: { status: 'active', token: 'reflected-secret', id: 'id', versions: [] } })
  })
  await rollbackWorker(env, 'worker', 'selected-version')
  assert.deepEqual(JSON.parse(calls[0].options.body as string).versions, [{ version_id: 'selected-version', percentage: 100 }])
  const result = await verifyCloudflareToken(env, 'account')
  assert.match(calls[1].url, /accounts\/account\/tokens\/verify$/)
  assert.equal(result.status, 'active')
  assert.ok(!JSON.stringify(result).includes('reflected-secret'))
})

test('Worker details omit binding values and preserve partial results', async t => {
  const { workerDetails } = await import('../src/cloudflare.ts')
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/settings')) return Response.json({ success: true, result: { bindings: [{ name: 'SECRET', type: 'secret_text', text: 'private-binding-value' }] } })
    if (url.endsWith('/schedules')) return Response.json({ success: false, errors: [] }, { status: 403 })
    return Response.json({ success: true, result: { deployments: [{ id: 'deployment', versions: [{ version_id: 'version' }] }] } })
  })
  const result = await workerDetails(env, 'worker')
  assert.deepEqual(result.bindings, [{ name: 'SECRET', type: 'secret_text' }])
  assert.deepEqual(result.unavailable, ['crons'])
  assert.ok(!JSON.stringify(result).includes('private-binding-value'))
})

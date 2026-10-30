import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const compiled = await build({ entryPoints: ['src/cloudflare.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const cloudflare = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const { listPagesProjects, getPagesProject, listPagesDeployments, triggerPagesDeployment, rollbackWorker, verifyCloudflareToken } = cloudflare
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
  const { workerDetails } = cloudflare
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

test('R2 admin binary reads are lossless and bounded; reserved private keys cannot bypass owner routes', async t => {
  const { getR2Object, putR2Object, deleteR2Object } = cloudflare
  const binary = new Uint8Array([0, 255, 128, 1])
  let calls = 0, last: RequestInit | undefined
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => { calls++; last = options; return new Response(binary) })
  assert.equal((await getR2Object(env, 'files', 'archive.zip', 'base64')).content, Buffer.from(binary).toString('base64'))
  await assert.rejects(getR2Object(env, 'files', 'archive.zip'), /binary/)
  await putR2Object(env, 'files', 'archive.zip', '', 'application/zip', true, binary)
  assert.deepEqual(last?.body, binary)
  assert.ok(last?.signal)
  assert.equal(new Headers(last?.headers).get('If-None-Match'), null)
  const before = calls
  await assert.rejects(getR2Object(env, 'files', 'dashboard-files/other/secret'), /Managed private/)
  await assert.rejects(deleteR2Object(env, 'files', 'dashboard-files/other/secret'), /Managed private/)
  await assert.rejects(putR2Object(env, 'files', 'big.txt', 'x'.repeat(1024 * 1024 + 1)), /exceeds/)
  assert.equal(calls, before)
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { headers: { 'Content-Length': String(1024 * 1024 + 1) } }))
  await assert.rejects(getR2Object(env, 'files', 'big.zip', 'base64'), /size/)
})

test('Cloudflare retries transient safe reads at most once and never replays writes', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++; assert.ok(options.signal); assert.equal(options.redirect, 'error')
    return Response.json({ success: false, errors: [{ message: 'unavailable' }] }, { status: 503 })
  })
  await assert.rejects(listPagesProjects(env))
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(triggerPagesDeployment(env, 'project', 'staging'))
  assert.equal(calls, 1)
})


test('R2 REST preserves literal object slashes and top-level pagination, including hidden-only pages', async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url)
    if (url.includes('?')) return Response.json({ success: true, result: [{ key: 'dashboard-files/other/private', size: 1 }], result_info: { is_truncated: true, cursor: 'next' } })
    return new Response('text')
  })
  const listing = await cloudflare.listR2Objects(env, 'files', { prefix: 'folder/', cursor: 'prior', limit: 20 })
  assert.deepEqual(listing.objects, [])
  assert.equal(listing.truncated, true)
  assert.equal(listing.cursor, 'next')
  const content = await cloudflare.getR2Object(env, 'files', 'folder/日本 #.txt')
  assert.equal(content.content, 'text')
  assert.ok(calls[1].endsWith('/objects/folder/' + encodeURIComponent('日本 #.txt')))
  assert.ok(!calls[1].includes('%2F'))
  await assert.rejects(cloudflare.getR2Object(env, 'files', 'x/../secret'), /dot path/)
  const before = calls.length
  await assert.rejects(cloudflare.putR2Object(env, 'files', 'new.txt', 'text'), /Safe create-only/)
  assert.equal(calls.length, before)
})

test('Worker deployments accept documented API shape and reject malformed data without a TypeError', async t => {
  const { getWorkerDeployments } = cloudflare
  let upstream: unknown = { success: true, result: {
    deployments: [{ id: 'deployment-1', created_on: '2026-10-30T08:00:00Z',
      versions: [{ version_id: 'version-1', percentage: 100 }] }],
  } }
  let throwNetwork = false
  t.mock.method(globalThis, 'fetch', async () => {
    if (throwNetwork) throw new TypeError('Failed to fetch')
    return Response.json(upstream)
  })

  assert.equal((await getWorkerDeployments(env, 'worker')).deployments[0].versions?.[0].version_id, 'version-1')
  upstream = { success: true, result: { deployments: [] } }
  assert.deepEqual((await getWorkerDeployments(env, 'worker')).deployments, [])
  upstream = { success: true, result: { deployments: {} } }
  await assert.rejects(getWorkerDeployments(env, 'worker'), (error: unknown) =>
    error instanceof Error && error.name === 'CloudflareApiError')
  upstream = { success: true, result: { deployments: [{ id: 'deployment-1', versions: {} }] } }
  await assert.rejects(getWorkerDeployments(env, 'worker'), (error: unknown) =>
    error instanceof Error && error.name === 'CloudflareApiError')
  upstream = { success: true, result: { deployments: [{ id: 'deployment-1', versions: [null] }] } }
  await assert.rejects(getWorkerDeployments(env, 'worker'), (error: unknown) =>
    error instanceof Error && error.name === 'CloudflareApiError')
  throwNetwork = true
  await assert.rejects(getWorkerDeployments(env, 'worker'), (error: unknown) =>
    error instanceof Error && error.name === 'CloudflareApiError')
})

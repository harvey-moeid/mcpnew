import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchUrl, webSearch, WebFetchError, WebSearchError } from '../src/web.ts'

test('fetch_url preserves HTML extraction, output limits and split UTF-8', async t => {
  const bytes = new TextEncoder().encode('<p>Halo 🌏 &amp; dunia</p><script>hidden()</script>')
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/html' } }))
  const result = await fetchUrl('https://example.test')
  assert.equal(result.text, 'Halo 🌏 & dunia')
  assert.equal(result.truncated, false)
  const limited = await fetchUrl('https://example.test', { maxLength: 4 })
  assert.equal(limited.text, 'Halo')
  assert.equal(limited.truncated, true)
})

test('fetch_url cancels an endless chunked response at the byte limit', async t => {
  let pulls = 0, cancelled = false
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(65536).fill(97)) },
    cancel() { cancelled = true },
  })))
  const result = await fetchUrl('https://example.test', { maxLength: 30000 })
  assert.equal(result.text.length, 30000)
  assert.equal(result.truncated, true)
  assert.equal(cancelled, true)
  assert.ok(pulls <= 18, `response kept streaming (${pulls} chunks)`)
})

test('byte truncation stays visible even when HTML extraction produces short output', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    '<script>' + 'a'.repeat(1024 * 1024 - 30) + '</script><p>OK</p>' + ' '.repeat(100),
    { headers: { 'Content-Type': 'text/html' } },
  ))
  const result = await fetchUrl('https://example.test')
  assert.equal(result.text, 'OK')
  assert.equal(result.truncated, true)
})

test('fetch_url times out a stalled body even if upstream cancellation never finishes', async t => {
  let cancelled = false
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    cancel() { cancelled = true; return new Promise<void>(() => {}) },
  })))
  await assert.rejects(fetchUrl('https://example.test', { timeoutMs: 20 }),
    error => error instanceof WebFetchError && /Timed out after 20ms/.test(error.message))
  assert.equal(cancelled, true)
})

test('byte truncation inside a script does not expose script text as page content', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<script>' + 'x'.repeat(1024 * 1024 + 1),
    { headers: { 'Content-Type': 'text/html' } }))
  const result = await fetchUrl('https://example.test')
  assert.equal(result.text, '')
  assert.equal(result.truncated, true)
})

test('fetch_url normalizes header and body failures and handles empty responses', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('connection failed') })
  await assert.rejects(fetchUrl('https://example.test'), WebFetchError)
  mock.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('body failed')) },
  })))
  await assert.rejects(fetchUrl('https://example.test'), /body failed/)
  mock.mock.mockImplementation(async () => new Response(null, { status: 204 }))
  const result = await fetchUrl('https://example.test')
  assert.equal(result.text, '')
  assert.equal(result.truncated, false)
  assert.equal(result.status, 204)
})

test('web_search also bounds and times out response bodies', async t => {
  const env = { BRAVE_API_KEY: 'test-key' } as Env
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream()))
  await assert.rejects(webSearch(env, 'query', 1, 20), /Timed out after 20ms/)
  mock.mock.mockImplementation(async () => new Response('x'.repeat(1024 * 1024 + 1)))
  await assert.rejects(webSearch(env, 'query', 1), /1 MiB limit/)
  mock.mock.mockImplementation(async () => Response.json({ web: { results: [
    { title: 'Result', url: 'https://example.test', description: '<b>Hello</b>' },
  ] } }))
  assert.deepEqual(await webSearch(env, 'query', 1), [
    { title: 'Result', url: 'https://example.test', description: 'Hello' },
  ])
  await assert.rejects(webSearch({} as Env, 'query', 1), WebSearchError)
})

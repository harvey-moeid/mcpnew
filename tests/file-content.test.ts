import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const compiled = await build({ entryPoints: ['src/file-content.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { readFileBytes, allowedUploadUrl, fetchUploadBytes, storeFileBytes, decodeFileBase64, detectFileType } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

test('file readers count actual bytes, preserve binary and reject dishonest sizes', async () => {
  const binary = new Uint8Array([0, 255, 128, 1])
  assert.deepEqual(await readFileBytes(new Blob([binary]).stream(), 4), binary)
  await assert.rejects(readFileBytes(new Blob([binary]).stream(), 3), /exceeds/)
  await assert.rejects(readFileBytes(new Blob([binary]).stream(), 5), /does not match/)
  await assert.rejects(readFileBytes(new Blob([binary]).stream(), undefined, undefined, 3), /exceeds/)
  await assert.rejects(readFileBytes(null, 1), /contents/)
  await assert.rejects(readFileBytes(null, 25 * 1024 * 1024 + 1), /size/)
  assert.equal((await readFileBytes(null, 0)).length, 0)
  assert.deepEqual(decodeFileBase64('AP+AAQ==', 4), binary)
  for (const invalid of ['AP+AAQ=', 'AP+AAQ==\n', 'data:;base64,AP+AAQ==', 'AB==']) assert.throws(() => decodeFileBase64(invalid, 4), /base64/)
})

test('body timeout releases a stalled reader without awaiting an uncooperative cancel hook', async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20)
  let cancelled = false
  try {
    await assert.rejects(readFileBytes(new ReadableStream({ pull() { return new Promise(() => {}) }, cancel() { cancelled = true; return new Promise(() => {}) } }), 4, controller.signal), /aborted/)
    assert.equal(cancelled, true)
  } finally { clearTimeout(timer) }
})

test('URL imports reject SSRF forms before network and never follow redirects or forward credentials', async t => {
  const hosts = 'downloads.mycompany.com'
  for (const value of ['http://downloads.mycompany.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://2130706433/a', 'https://localhost/a', 'https://downloads.mycompany.com.evil.com/a', 'https://downloads.mycompany.com@evil.com/a', 'https://user:secret@downloads.mycompany.com/a', 'https://downloads.mycompany.com:8443/a', 'file:///etc/passwd', 'https://downloads.mycompany.com./a']) assert.throws(() => allowedUploadUrl(value, hosts), /Source/)
  assert.throws(() => allowedUploadUrl('https://downloads.mycompany.com/a', ''), /Source/)
  const url = allowedUploadUrl('https://downloads.mycompany.com/file.zip?signature=test', hosts)
  const calls: RequestInit[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls.push(init); return new Response('redirect', { status: 302, headers: { Location: 'https://127.0.0.1/private' } }) })
  await assert.rejects(fetchUploadBytes(url), /redirect/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].redirect, 'manual')
  assert.equal(new Headers(calls[0].headers).has('Authorization'), false)
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([0, 255, 1]), { headers: { 'Content-Length': '3' } }))
  assert.deepEqual(await fetchUploadBytes(url), new Uint8Array([0, 255, 1]))
})

test('storage verifies R2 HEAD metadata and supplies native checksum validation', async () => {
  let stored: any, writes = 0
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])
  const bucket = { async put(key: string, body: Uint8Array, options: R2PutOptions) {
    writes++; assert.deepEqual(body, bytes); assert.equal(options.onlyIf?.etagDoesNotMatch, '*')
    assert.equal(options.customMetadata?.sha256, options.sha256)
    stored = { key, size: body.length, etag: 'etag', uploaded: new Date(), customMetadata: options.customMetadata, httpMetadata: options.httpMetadata }
    return stored
  }, async head() { return stored } }
  const object = await storeFileBytes(bucket, 'key', 'misleading.txt', bytes)
  assert.equal(object.httpMetadata.contentType, 'image/png')
  assert.match(object.customMetadata.sha256, /^[a-f0-9]{64}$/)
  bucket.head = async () => ({ ...stored, size: 999 })
  await assert.rejects(storeFileBytes(bucket, 'other', 'x', bytes), /verification/)
  assert.equal(writes, 2)
  assert.equal(detectFileType('x.unknown', new Uint8Array()), 'application/octet-stream')
})

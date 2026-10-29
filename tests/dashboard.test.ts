import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { beginTransaction, consumeTransaction, createSession, readSession, isAllowedUser, digest } from '../src/dashboard-auth.ts'

const origin = 'https://mcpnew.muidsoft.com'
const compiled = await build({ stdin: { contents: "export { GitHubHandler } from './src/github-handler'; export { checkSummary } from './src/dashboard-api'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false })
const { GitHubHandler, checkSummary } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

function environment() {
  const values = new Map<string, string>()
  const authRequest = { responseType: 'code', clientId: 'mcp-client', redirectUri: 'https://client.example/callback', scope: [], state: 'client-state' }
  const auditBindings: unknown[][] = []
  const env = {
    GITHUB_CLIENT_ID: 'test-app', GITHUB_CLIENT_SECRET: 'test-secret', COOKIE_ENCRYPTION_KEY: 'a-test-only-encryption-secret',
    GITHUB_ALLOWED_USERS: 'harvey-moeid', PROTECTED_BRANCHES: 'main,master', ALLOW_DIRECT_PUSH_TO_PROTECTED: 'true',
    OAUTH_KV: {
      async put(key: string, value: string) { values.set(key, value) },
      async get(key: string) { return values.get(key) ?? null },
      async delete(key: string) { values.delete(key) },
    },
    AUDIT_DB: { prepare(sql: string) {
      assert.ok(sql.includes('WHERE actor = ?'))
      return { bind(...args: unknown[]) { auditBindings.push(args); return { async first() { return null }, async all() { return { results: [] } } } } }
    } },
    OAUTH_PROVIDER: {
      async parseAuthRequest() { return authRequest },
      async lookupClient() { return { clientId: 'mcp-client', clientName: 'Test client' } },
      async completeAuthorization() { return { redirectTo: 'https://client.example/callback?code=test' } },
    },
  } as unknown as Env
  return { env, values, auditBindings }
}
function cookieHeader(setCookie: string) { return setCookie.split(';')[0] }
async function request(env: Env, path: string, options: RequestInit = {}) {
  return GitHubHandler.fetch(new Request(origin + path, options), env, {}) as Promise<Response>
}
async function authenticated(env: Env) {
  return cookieHeader(await createSession(env, { login: 'harvey-moeid', name: 'Harvey', avatarUrl: 'https://avatars.githubusercontent.com/u/1', accessToken: 'private-test-token' }))
}

function githubMock(t: import('node:test').TestContext, login = 'harvey-moeid') {
  return t.mock.method(globalThis, 'fetch', async (url: string | Request, _options?: RequestInit) => {
    const value = String(url)
    if (value.includes('/login/oauth/access_token')) return Response.json({ access_token: 'private-test-token' })
    if (value === 'https://api.github.com/user') return Response.json({ login, name: 'Harvey', avatar_url: 'https://avatars.githubusercontent.com/u/1', id: 1 })
    throw new Error('Unexpected network request: ' + value)
  })
}

test('PR checks only report success for recognized completed conclusions or successful statuses', () => {
  for (const check of [{}, { status: 'completed' }, { status: 'completed', conclusion: null },
    { status: 'completed', conclusion: 'stale' }, { state: 'unrecognized' }]) {
    assert.equal(checkSummary([{ status: 'completed', conclusion: 'success' }, check]), 'unknown')
  }
  assert.equal(checkSummary([]), 'none')
  assert.equal(checkSummary([{ state: 'success' }, ...['success', 'neutral', 'skipped'].map(conclusion => ({ status: 'completed', conclusion }))]), 'success')
  assert.equal(checkSummary([{ status: 'queued' }]), 'pending')
  assert.equal(checkSummary([{ status: 'completed', conclusion: 'cancelled' }]), 'cancelled')
  assert.equal(checkSummary([{ state: 'error' }, {}]), 'failure')
})

test('dashboard shell is public but every private API requires a session', async () => {
  const { env } = environment()
  const page = await request(env, '/dashboard')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Masuk dengan GitHub/)
  assert.match(page.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/)
  for (const path of ['session', 'repositories', 'repository?repo=harvey-moeid/mcpnew', 'deployments', 'audit']) {
    assert.equal((await request(env, '/dashboard/api/' + path)).status, 401)
  }
})

test('dashboard assets are served with correct types and valid JavaScript', async () => {
  const { env } = environment()
  const script = await request(env, '/dashboard/app.js')
  assert.match(script.headers.get('content-type')!, /text\/javascript/)
  const source = await script.text()
  assert.doesNotThrow(() => new Function(source))
  const css = await request(env, '/dashboard/style.css')
  assert.match(css.headers.get('content-type')!, /text\/css/)
  assert.match(await css.text(), /max-width:700px/)
})

test('dashboard login is unavailable without an explicit allowlist', async () => {
  const { env } = environment()
  env.GITHUB_ALLOWED_USERS = ''
  assert.equal((await request(env, '/dashboard/login')).status, 503)
  assert.equal(isAllowedUser('anyone', '', true), false)
  assert.equal(isAllowedUser('HARVEY-MOEID', 'harvey-moeid', true), true)
})

test('dashboard Cloudflare metadata requires its administrator allowlist before any upstream request', async t => {
  const { env } = environment()
  env.CLOUDFLARE_API_TOKEN = 'cloudflare-test-token'
  env.CLOUDFLARE_ACCOUNT_ID = 'test-account'
  const headers = { Cookie: await authenticated(env) }
  const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, result: { deployments: [] } }))
  for (const allowlist of ['other-admin', '', ' ']) {
    env.CLOUDFLARE_ALLOWED_USERS = allowlist
    const session = await request(env, '/dashboard/api/session', { headers })
    assert.equal((await session.json()).configuration.cloudflare, false)
    const denied = await request(env, '/dashboard/api/deployments', { headers })
    assert.equal(denied.status, 403)
    assert.ok(!(await denied.text()).includes('cloudflare-test-token'))
  }
  assert.equal(upstream.mock.callCount(), 0)
  for (const allowlist of ['HARVEY-MOEID', undefined]) {
    env.CLOUDFLARE_ALLOWED_USERS = allowlist
    const session = await request(env, '/dashboard/api/session', { headers })
    assert.equal((await session.json()).configuration.cloudflare, true)
    assert.equal((await request(env, '/dashboard/api/deployments', { headers })).status, 200)
  }
  assert.equal(upstream.mock.callCount(), 2)
})

test('upstream OAuth state is opaque, browser bound and expires', async t => {
  const { env, values } = environment()
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  assert.match(transaction.state, /^[a-f0-9]{64}$/)
  assert.match(transaction.cookie, /HttpOnly; Secure; SameSite=Lax/)
  assert.equal(await consumeTransaction(env, new Request(origin), transaction.state), null)
  const browser = new Request(origin, { headers: { Cookie: cookieHeader(transaction.cookie) } })
  t.mock.method(Date, 'now', () => new Date().getTime() + 11 * 60 * 1000)
  assert.equal(await consumeTransaction(env, browser, transaction.state), null)
  assert.equal(values.size, 1)
})

test('forged callback never reaches GitHub', async t => {
  const { env } = environment()
  const fetchMock = githubMock(t)
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  const response = await request(env, '/callback?code=code&state=' + transaction.state)
  assert.equal(response.status, 400)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('valid callback creates an encrypted session and clears transaction cookie', async t => {
  const { env, values } = environment()
  const fetchMock = githubMock(t)
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  const headers = { Cookie: cookieHeader(transaction.cookie) }
  const response = await request(env, '/callback?code=code&state=' + transaction.state, { headers })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/dashboard')
  const cookies = response.headers.getSetCookie()
  assert.ok(cookies.some(value => value.includes('Max-Age=0')))
  const sessionCookie = cookies.find(value => value.startsWith('__Host-ops_session='))!
  assert.ok(sessionCookie)
  assert.ok(!sessionCookie.includes('private-test-token'))
  assert.ok(!Array.from(values.values()).some(value => value.includes('private-test-token')))
  const sessionResponse = await request(env, '/dashboard/api/session', { headers: { Cookie: cookieHeader(sessionCookie) } })
  const publicData = await sessionResponse.text()
  assert.equal(sessionResponse.status, 200)
  assert.ok(!publicData.includes('private-test-token'))
  assert.equal(JSON.parse(publicData).user.login, 'harvey-moeid')
  assert.equal((await request(env, '/callback?code=code&state=' + transaction.state, { headers })).status, 400)
  assert.equal(fetchMock.mock.callCount(), 2)
})

test('OAuth callback submits token request as form data and never retries the single-use code', async t => {
  const { env } = environment()
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  const originalFetch = t.mock.method(globalThis, 'fetch', async (_url: string | Request, options?: RequestInit) => {
    assert.equal(options?.headers && (options.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded')
    const form = options?.body as URLSearchParams
    assert.equal(form.get('client_id'), 'test-app')
    assert.equal(form.get('client_secret'), 'test-secret')
    assert.equal(form.get('code'), 'single-use-code')
    return new Response('', { status: 502 })
  })
  const response = await request(env, '/callback?code=single-use-code&state=' + transaction.state,
    { headers: { Cookie: cookieHeader(transaction.cookie) } })
  assert.equal(response.status, 502)
  assert.match(await response.text(), /token exchange failed/i)
  assert.equal(originalFetch.mock.callCount(), 1)
})

test('OAuth callback differentiates GitHub profile errors from token-exchange errors', async t => {
  const { env } = environment()
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  const mock = t.mock.method(globalThis, 'fetch', async (url: string | Request) => {
    if (String(url).includes('/login/oauth/access_token')) return Response.json({ access_token: 'test-token' })
    return new Response('', { status: 403 })
  })
  const response = await request(env, '/callback?code=code&state=' + transaction.state,
    { headers: { Cookie: cookieHeader(transaction.cookie) } })
  assert.equal(response.status, 502)
  assert.match(await response.text(), /GitHub user profile/i)
  assert.equal(mock.mock.callCount(), 2)
})

test('OAuth callback recognizes incorrect credentials without disclosing the response body', async t => {
  const { env } = environment()
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: 'incorrect_client_credentials',
    error_description: 'private diagnostic content must not be exposed',
  }))
  const response = await request(env, '/callback?code=code&state=' + transaction.state,
    { headers: { Cookie: cookieHeader(transaction.cookie) } })
  assert.equal(response.status, 502)
  const body = await response.text()
  assert.match(body, /credentials were rejected/i)
  assert.ok(!body.includes('private diagnostic content'))
})

test('a disallowed GitHub account cannot acquire a dashboard session', async t => {
  const { env, values } = environment()
  githubMock(t, 'not-allowed')
  const transaction = await beginTransaction(env, { kind: 'dashboard' })
  const response = await request(env, '/callback?code=code&state=' + transaction.state, { headers: { Cookie: cookieHeader(transaction.cookie) } })
  assert.equal(response.status, 403)
  assert.ok(!Array.from(values.keys()).some(key => key.startsWith('ops:session:')))
})

test('expired or tampered sessions fail closed and allowlist changes revoke access', async t => {
  const { env, values } = environment()
  const sessionCookie = await authenticated(env)
  const browser = new Request(origin, { headers: { Cookie: sessionCookie } })
  assert.equal((await readSession(env, browser))?.login, 'harvey-moeid')
  env.GITHUB_ALLOWED_USERS = 'another-user'
  assert.equal(await readSession(env, browser), null)
  env.GITHUB_ALLOWED_USERS = 'harvey-moeid'
  const otherCookie = await authenticated(env)
  const key = 'ops:session:' + await digest(otherCookie.split('=')[1])
  values.set(key, values.get(key)!.slice(0, -10) + 'garbage')
  assert.equal(await readSession(env, new Request(origin, { headers: { Cookie: otherCookie } })), null)
  const expiringCookie = await authenticated(env)
  t.mock.method(Date, 'now', () => new Date().getTime() + 9 * 60 * 60 * 1000)
  assert.equal(await readSession(env, new Request(origin, { headers: { Cookie: expiringCookie } })), null)
})

test('logout requires same-origin POST and invalidates the stored session', async () => {
  const { env } = environment()
  const sessionCookie = await authenticated(env)
  assert.equal((await request(env, '/dashboard/api/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: 'https://other.example' } })).status, 403)
  const response = await request(env, '/dashboard/api/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: origin } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie')!, /Max-Age=0/)
  assert.equal((await request(env, '/dashboard/api/session', { headers: { Cookie: sessionCookie } })).status, 401)
})

test('Cancel denies MCP authorization without starting a GitHub login', async t => {
  const { env } = environment()
  const fetchMock = githubMock(t)
  const consent = await request(env, '/authorize?client_id=mcp-client')
  const html = await consent.text()
  const token = html.match(/name="state" value="([a-f0-9]{64})"/)![1]
  const response = await request(env, '/authorize', { method: 'POST', headers: { Cookie: cookieHeader(consent.headers.get('set-cookie')!), Origin: origin }, body: new URLSearchParams({ action: 'deny', state: token }) })
  const redirect = new URL(response.headers.get('location')!)
  assert.equal(response.status, 302)
  assert.equal(redirect.hostname, 'client.example')
  assert.equal(redirect.searchParams.get('error'), 'access_denied')
  assert.equal(redirect.searchParams.get('state'), 'client-state')
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('MCP approval preserves the connector flow with browser-bound callback state', async t => {
  const { env } = environment()
  githubMock(t)
  const consent = await request(env, '/authorize?client_id=mcp-client')
  assert.equal(consent.headers.get('Referrer-Policy'), 'same-origin')
  const token = (await consent.text()).match(/name="state" value="([a-f0-9]{64})"/)![1]
  const approve = await request(env, '/authorize', { method: 'POST', headers: { Cookie: cookieHeader(consent.headers.get('set-cookie')!), Origin: origin }, body: new URLSearchParams({ action: 'approve', state: token }) })
  assert.equal(approve.status, 302)
  const upstream = new URL(approve.headers.get('location')!)
  assert.equal(upstream.hostname, 'github.com')
  const callbackCookies = approve.headers.getSetCookie().filter(value => !value.includes('Max-Age=0')).map(cookieHeader).join('; ')
  const complete = await request(env, '/callback?code=code&state=' + upstream.searchParams.get('state'), { headers: { Cookie: callbackCookies } })
  assert.equal(complete.status, 302)
  assert.equal(new URL(complete.headers.get('location')!).hostname, 'client.example')
  assert.ok(!complete.headers.getSetCookie().some(value => value.startsWith('__Host-ops_session=')))
})

test('MCP approval rejects foreign, null and missing origins without consuming state', async () => {
  const { env } = environment()
  const consent = await request(env, '/authorize?client_id=mcp-client')
  const token = (await consent.text()).match(/name="state" value="([a-f0-9]{64})"/)![1]
  const cookie = cookieHeader(consent.headers.get('set-cookie')!)
  for (const invalidOrigin of ['https://other.example', 'null', undefined]) {
    const headers: Record<string, string> = { Cookie: cookie }
    if (invalidOrigin !== undefined) headers.Origin = invalidOrigin
    const response = await request(env, '/authorize', {
      method: 'POST', headers,
      body: new URLSearchParams({ action: 'approve', state: token }),
    })
    assert.equal(response.status, 403)
    assert.equal(await response.text(), 'Invalid approval origin')
  }
  const response = await request(env, '/authorize', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ action: 'approve', state: token }),
  })
  assert.equal(response.status, 302)
  assert.equal(new URL(response.headers.get('location')!).hostname, 'github.com')
})

test('missing audit table returns a diagnostic code without exposing internal errors', async () => {
  const { env } = environment()
  ;(env as unknown as { AUDIT_DB: unknown }).AUDIT_DB = {
    prepare() { throw new Error('database internals must not be returned to the browser') },
  }
  const response = await request(env, '/dashboard/api/audit', { headers: { Cookie: await authenticated(env) } })
  assert.equal(response.status, 503)
  const body = await response.json() as { code: string; error: string; requestId: string }
  assert.equal(body.code, 'AUDIT_UNAVAILABLE')
  assert.match(body.error, /AUDIT_DB/)
  assert.match(body.requestId, /^[a-f0-9-]{36}$/)
  assert.ok(!JSON.stringify(body).includes('database internals must not be returned'))
})

test('health checks the audit table and reports unavailable without failing the entire health check', async t => {
  const { env } = environment()
  let query = ''
  ;(env as unknown as { AUDIT_DB: unknown }).AUDIT_DB = {
    prepare(sql: string) {
      query = sql
      throw new Error('no such table: audit_log')
    },
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ login: 'harvey-moeid' }))
  const response = await request(env, '/dashboard/api/health', { headers: { Cookie: await authenticated(env) } })
  assert.equal(response.status, 200)
  const body = await response.json() as { github: string; database: string }
  assert.equal(body.github, 'available')
  assert.equal(body.database, 'unavailable')
  assert.match(query, /FROM audit_log/)
})

test('private audit queries bind the signed-in actor and validate pagination', async () => {
  const { env, auditBindings } = environment()
  const headers = { Cookie: await authenticated(env) }
  assert.equal((await request(env, '/dashboard/api/audit?errors=true&before=42', { headers })).status, 200)
  assert.deepEqual(auditBindings[0], ['harvey-moeid', 42])
  assert.equal((await request(env, '/dashboard/api/audit?before=invalid', { headers })).status, 400)
  assert.equal((await request(env, '/dashboard/api/repository?repo=..%2F..', { headers })).status, 400)
  assert.equal((await request(env, '/dashboard/api/repositories?page=0', { headers })).status, 400)
})

test('repo PR status combines Actions and legacy status without leaking tokens', async t => {
  const { env } = environment()
  const headers = { Cookie: await authenticated(env) }
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('/pulls?')) return Response.json([{ number: 1, title: 'Update', html_url: 'https://github.com/owner/repo/pull/1', draft: false, created_at: new Date().toISOString(), user: { login: 'author' }, head: { sha: 'abc', ref: 'feature' }, base: { ref: 'main' } }])
    if (url.includes('/actions/runs')) return Response.json({ workflow_runs: [] })
    if (url.includes('/check-runs')) return Response.json({ check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }] })
    if (url.includes('/status?')) return Response.json({ statuses: [{ context: 'external', state: 'failure' }] })
    throw new Error('Unexpected request')
  })
  const response = await request(env, '/dashboard/api/repository?repo=owner/repo', { headers })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.pullRequests[0].status, 'failure')
  assert.ok(!JSON.stringify(data).includes('private-test-token'))
})

test('unconfigured deployment has an honest empty state', async () => {
  const { env } = environment()
  const response = await request(env, '/dashboard/api/deployments', { headers: { Cookie: await authenticated(env) } })
  assert.deepEqual(await response.json(), { configured: false, deployments: [] })
})

function fileStorage(env: Env) {
  const objects = new Map<string, { data: Uint8Array; metadata: Record<string, string> }>()
  const gets: string[] = []
  let listOptions: R2ListOptions | undefined
  const object = (key: string, stored: { data: Uint8Array; metadata: Record<string, string> }) => ({
    key, size: stored.data.length, uploaded: new Date('2026-10-28T00:00:00Z'),
    customMetadata: stored.metadata, httpMetadata: { contentType: 'application/octet-stream' },
  })
  env.FILES_BUCKET = {
    async put(key: string, body: ReadableStream | null, options: R2PutOptions) {
      if (options.onlyIf && objects.has(key)) return null
      const data = new Uint8Array(await new Response(body).arrayBuffer())
      const stored = { data, metadata: options.customMetadata ?? {} }
      objects.set(key, stored)
      return object(key, stored)
    },
    async head(key: string) { const stored = objects.get(key); return stored ? object(key, stored) : null },
    async get(key: string) {
      gets.push(key)
      const stored = objects.get(key)
      return stored ? { ...object(key, stored), body: new Blob([stored.data]).stream() } : null
    },
    async list(options: R2ListOptions) {
      listOptions = options
      return { objects: Array.from(objects.entries()).filter(([key]) => key.startsWith(options.prefix!))
        .map(([key, value]) => object(key, value)), truncated: true, cursor: 'opaque-next-page' }
    },
  } as unknown as R2Bucket
  return { objects, gets, options: () => listOptions }
}

test('R2 files require login, reject cross-origin uploads, and report absent storage', async () => {
  const { env } = environment()
  const path = '/dashboard/api/files'
  assert.equal((await request(env, path)).status, 401)
  assert.equal((await request(env, path, { method: 'POST' })).status, 401)
  assert.equal((await request(env, path + '/download?key=test')).status, 401)
  const Cookie = await authenticated(env)
  const listing = await request(env, path, { headers: { Cookie } })
  assert.equal((await listing.json()).configured, false)
  assert.equal((await request(env, path, { method: 'POST', headers: { Cookie, Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await request(env, path, { method: 'POST', headers: { Cookie, Origin: origin } })).status, 503)
})

test('R2 round trip preserves binary files, Unicode names, duplicate names and private pagination', async () => {
  const { env } = environment()
  const storage = fileStorage(env)
  const Cookie = await authenticated(env)
  const name = 'laporan 日本 🐱.zip'
  const bytes = new Uint8Array([0, 255, 128, 13, 10, 1])
  for (let i = 0; i < 2; i++) {
    const response = await request(env, '/dashboard/api/files?name=' + encodeURIComponent(name), {
      method: 'POST', headers: { Cookie, Origin: origin, 'Content-Length': String(bytes.length) }, body: bytes,
    })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).file.name, name)
  }
  assert.equal(storage.objects.size, 2)
  storage.objects.set('dashboard-files/another-user/secret', { data: bytes, metadata: { filename: 'secret' } })
  const listing = await request(env, '/dashboard/api/files?cursor=previous', { headers: { Cookie } })
  const data = await listing.json()
  assert.equal(data.files.length, 2)
  assert.equal(data.cursor, 'opaque-next-page')
  assert.equal(storage.options()?.prefix, 'dashboard-files/harvey-moeid/')
  assert.equal(storage.options()?.cursor, 'previous')
  const download = await request(env, '/dashboard/api/files/download?key=' + encodeURIComponent(data.files[0].key), { headers: { Cookie } })
  assert.equal(download.status, 200)
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes)
  assert.match(download.headers.get('Content-Disposition')!, /attachment;.*filename\*=UTF-8''/)
  assert.ok(download.headers.get('Content-Disposition')!.includes(encodeURIComponent(name)))
  assert.equal(download.headers.get('Content-Type'), 'application/octet-stream')
  assert.equal(download.headers.get('Cache-Control'), 'no-store')
  assert.equal(download.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.ok(!JSON.stringify(data).includes('private-test-token'))
})

test('R2 rejects another user key before storage access, including prefix tricks', async () => {
  const { env } = environment()
  const storage = fileStorage(env)
  const Cookie = await authenticated(env)
  for (const key of ['dashboard-files/another-user/secret', 'dashboard-files/harvey-moeid-evil/file', 'unrelated/file']) {
    const response = await request(env, '/dashboard/api/files/download?key=' + encodeURIComponent(key), { headers: { Cookie } })
    assert.equal(response.status, 404)
  }
  assert.equal(storage.gets.length, 0)
  assert.equal((await request(env, '/dashboard/api/files/download?key=dashboard-files/harvey-moeid/missing', { headers: { Cookie } })).status, 404)
})

test('R2 validates file names and size before writes; empty files are supported', async () => {
  const { env } = environment()
  const storage = fileStorage(env)
  const Cookie = await authenticated(env)
  const upload = (name: string, length?: string) => request(env, '/dashboard/api/files?name=' + encodeURIComponent(name), {
    method: 'POST', headers: { Cookie, Origin: origin, ...(length === undefined ? {} : { 'Content-Length': length }) },
  })
  for (const name of ['', ' ', '../secret', 'folder/file', 'back\\slash', 'bad\r\nname', '..', '🐱'.repeat(65)]) {
    assert.equal((await upload(name, '0')).status, 400)
  }
  assert.equal((await upload('a')).status, 411)
  assert.equal((await upload('a', 'invalid')).status, 411)
  assert.equal((await upload('a', String(25 * 1024 * 1024 + 1))).status, 413)
  assert.equal(storage.objects.size, 0)
  assert.equal((await upload('empty.txt', '0')).status, 201)
  assert.equal(Array.from(storage.objects.values())[0].data.length, 0)
})

test('R2 outages return a safe error rather than exposing storage details', async () => {
  const { env } = environment()
  env.FILES_BUCKET = { async list() { throw new Error('sensitive internal bucket detail') } } as unknown as R2Bucket
  const response = await request(env, '/dashboard/api/files', { headers: { Cookie: await authenticated(env) } })
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('sensitive internal'))
})


async function testUploadTicket(env: Env, values: Map<string, string>, overrides: Record<string, unknown> = {}) {
  const token = 'a'.repeat(64)
  const key = 'file-upload:' + await digest(token)
  const ticket = { login: 'harvey-moeid', key: 'dashboard-files/harvey-moeid/uuid/report.zip', name: 'report.zip', size: 4, expiresAt: Date.now() + 600000, ...overrides }
  values.set(key, JSON.stringify(ticket))
  return { token, ticket, key }
}

test('workspace ticket upload stores binary file visible in dashboard; download still requires owner login', async () => {
  const { env, values } = environment()
  const storage = fileStorage(env)
  const { token, ticket, key } = await testUploadTicket(env, values)
  const body = new Uint8Array([0, 255, 128, 1])
  const response = await request(env, '/file-transfers/upload', { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Length': '4' }, body })
  assert.equal(response.status, 201)
  const data = await response.json()
  assert.equal(data.requiresLogin, true)
  assert.equal(data.file.key, ticket.key)
  assert.deepEqual(storage.objects.get(ticket.key)?.data, body)
  assert.ok(!values.has(key))
  const Cookie = await authenticated(env)
  const listing = await request(env, '/dashboard/api/files', { headers: { Cookie } })
  assert.equal((await listing.json()).files[0].key, ticket.key)
  const downloadPath = '/dashboard/api/files/download?key=' + encodeURIComponent(ticket.key)
  assert.equal((await request(env, downloadPath)).status, 401)
  assert.equal((await request(env, downloadPath, { headers: { Authorization: 'Bearer ' + token } })).status, 401)
  assert.equal((await request(env, downloadPath, { headers: { Cookie } })).status, 200)
  assert.equal((await request(env, '/file-transfers/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Length': '4' }, body })).status, 401)
  // Simulate a stale KV replica replaying the ticket after completion: conditional R2 put must reject it.
  values.set(key, JSON.stringify(ticket))
  assert.equal((await request(env, '/file-transfers/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Length': '4' }, body })).status, 409)
})

test('workspace upload rejects missing, expired, revoked or wrong-size tickets before storage writes', async () => {
  const { env, values } = environment()
  const storage = fileStorage(env)
  const send = (token?: string, size = '4') => request(env, '/file-transfers/upload', { method: 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Length': size } })
  assert.equal((await send()).status, 401)
  assert.equal((await send('b'.repeat(64))).status, 401)
  let issued = await testUploadTicket(env, values, { expiresAt: Date.now() - 1 })
  assert.equal((await send(issued.token)).status, 401)
  issued = await testUploadTicket(env, values)
  assert.equal((await send(issued.token, '5')).status, 400)
  env.GITHUB_ALLOWED_USERS = 'another-user'
  assert.equal((await send(issued.token)).status, 401)
  assert.equal(storage.objects.size, 0)
})

test('workspace upload rejects absent contents and preserves tickets during database outages', async t => {
  const { env, values } = environment()
  const storage = fileStorage(env)
  const { token, key } = await testUploadTicket(env, values)
  const headers = { Authorization: 'Bearer ' + token, 'Content-Length': '4' }
  const noBody = await request(env, '/file-transfers/upload', { method: 'POST', headers })
  assert.equal(noBody.status, 400)
  const original = env.AUDIT_DB.prepare.bind(env.AUDIT_DB)
  t.mock.method(env.AUDIT_DB, 'prepare', (sql: string) => {
    if (sql.includes('dashboard_file_state')) throw new Error('sensitive database failure')
    return original(sql)
  })
  const failed = await request(env, '/file-transfers/upload', { method: 'POST', headers, body: new Uint8Array([1, 2, 3, 4]) })
  assert.equal(failed.status, 503)
  assert.ok(!JSON.stringify(await failed.json()).includes('sensitive database failure'))
  assert.ok(values.has(key))
  assert.equal(storage.objects.size, 0)
})

test('another logged-in dashboard account cannot download the owner file', async () => {
  const { env } = environment()
  const storage = fileStorage(env)
  const key = 'dashboard-files/harvey-moeid/uuid/private.zip'
  storage.objects.set(key, { data: new Uint8Array([1]), metadata: { filename: 'private.zip' } })
  env.GITHUB_ALLOWED_USERS = 'harvey-moeid,another-user'
  const Cookie = cookieHeader(await createSession(env, { login: 'another-user', name: 'Other', avatarUrl: '', accessToken: 'other-test-token' }))
  const response = await request(env, '/dashboard/api/files/download?key=' + encodeURIComponent(key), { headers: { Cookie } })
  assert.equal(response.status, 404)
  assert.equal(storage.gets.length, 0)
})

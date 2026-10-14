import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { beginTransaction, consumeTransaction, createSession, readSession, isAllowedUser, digest } from '../src/dashboard-auth.ts'

const origin = 'https://mcpnew.muidsoft.com'
const compiled = await build({ entryPoints: ['src/github-handler.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { GitHubHandler } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

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
      return { bind(...args: unknown[]) { auditBindings.push(args); return { async all() { return { results: [] } } } } }
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

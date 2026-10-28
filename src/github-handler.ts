import { Hono } from 'hono'
import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from './utils'
import { beginTransaction, consumeTransaction, createSession, isAllowedUser, sameOrigin } from './dashboard-auth'
import { sharedFileKey } from './file-management'
import { fileDownload } from './files'
import { fileTransfers } from './file-transfers'
import { dashboardApi } from './dashboard-api'
import { dashboardHtml, dashboardScript, dashboardStyles } from './dashboard-page'

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  // Form POSTs need their same-origin Origin header for the approval CSRF check.
  // no-referrer can serialize that header as "null" for navigation requests.
  c.header('Referrer-Policy', c.req.path.startsWith('/shared-files/') ? 'no-referrer' : 'same-origin')
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
})

app.get('/', c => c.html(dashboardHtml))
app.get('/dashboard', c => c.html(dashboardHtml))
app.get('/dashboard/app.js', c => c.body(dashboardScript, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }))
app.get('/dashboard/style.css', c => c.body(dashboardStyles, 200, { 'Content-Type': 'text/css; charset=utf-8' }))
app.route('/dashboard/api', dashboardApi)
app.route('/file-transfers', fileTransfers)
app.get('/shared-files/:token', async c => {
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  try {
    const key = await sharedFileKey(c.env, c.req.param('token'))
    if (!key || !c.env.FILES_BUCKET) return c.text('Link tidak tersedia atau sudah kedaluwarsa.', 404)
    const object = await c.env.FILES_BUCKET.get(key)
    if (!object) return c.text('Link tidak tersedia atau sudah kedaluwarsa.', 404)
    return fileDownload(object)
  } catch { return c.text('File sementara tidak dapat diakses.', 503) }
})
app.get('/dashboard/login', async c => {
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET || !c.env.COOKIE_ENCRYPTION_KEY || !c.env.GITHUB_ALLOWED_USERS?.trim()) {
    return c.text('Dashboard belum dikonfigurasi. Hubungi pengelola layanan.', 503)
  }
  const transaction = await beginTransaction(c.env, { kind: 'dashboard' })
  return redirectToGitHub(c.req.raw, transaction.state, c.env, { 'Set-Cookie': transaction.cookie })
})

app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  if (!oauthReqInfo.clientId) return c.text('Invalid authorization request: missing client_id', 400)

  const alreadyApproved = await clientIdAlreadyApproved(
    c.req.raw,
    oauthReqInfo.clientId,
    c.env.COOKIE_ENCRYPTION_KEY
  )
  if (alreadyApproved) {
    const transaction = await beginTransaction(c.env, { kind: 'mcp', request: oauthReqInfo })
    return redirectToGitHub(c.req.raw, transaction.state, c.env, { 'Set-Cookie': transaction.cookie })
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId)
  const transaction = await beginTransaction(c.env, { kind: 'mcp', request: oauthReqInfo })
  const response = renderApprovalDialog(c.req.raw, {
    client,
    server: {
      name: 'GitHub Ops MCP Server',
      description:
        'Lets Claude create repositories, push commits, open pull requests, and read files on your behalf, using your own GitHub account via OAuth.',
    },
    state: { oauthReqInfo },
    stateToken: transaction.state,
  })
  response.headers.set('Set-Cookie', transaction.cookie)
  return response
})

app.post('/authorize', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Invalid approval origin', 403)
  const form = await c.req.raw.formData()
  const state = form.get('state')
  const action = form.get('action')
  const transaction = typeof state === 'string' ? await consumeTransaction(c.env, c.req.raw, state) : null
  if (!transaction || transaction.transaction.kind !== 'mcp') {
    return c.text('Invalid or expired approval request. Please try connecting again.', 400)
  }
  c.header('Set-Cookie', transaction.clearCookie)
  const oauthReqInfo = transaction.transaction.request
  if (action !== 'approve') {
    const redirect = new URL(oauthReqInfo.redirectUri)
    redirect.searchParams.set('error', 'access_denied')
    if (oauthReqInfo.state) redirect.searchParams.set('state', oauthReqInfo.state)
    return c.redirect(redirect.toString(), 302)
  }
  const approval = await parseRedirectApproval(new Request(c.req.url, {
    method: 'POST', headers: { 'Cookie': c.req.header('Cookie') ?? '' },
    body: new URLSearchParams({ action: 'approve', state: btoa(JSON.stringify({ oauthReqInfo })) }),
  }), c.env.COOKIE_ENCRYPTION_KEY)
  const upstream = await beginTransaction(c.env, { kind: 'mcp', request: oauthReqInfo })
  const response = redirectToGitHub(c.req.raw, upstream.state, c.env)
  response.headers.append('Set-Cookie', transaction.clearCookie)
  response.headers.append('Set-Cookie', approval.headers['Set-Cookie'])
  response.headers.append('Set-Cookie', upstream.cookie)
  return response
})

function redirectToGitHub(
  request: Request,
  state: string,
  env: Env,
  extraHeaders: Record<string, string> = {}
) {
  const upstreamUrl = new URL('https://github.com/login/oauth/authorize')
  upstreamUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  upstreamUrl.searchParams.set('redirect_uri', new URL('/callback', request.url).href)
  upstreamUrl.searchParams.set('scope', 'repo read:user workflow')
  upstreamUrl.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: { ...extraHeaders, Location: upstreamUrl.toString() },
  })
}

app.get('/callback', async (c) => {
  const rawState = c.req.query('state')
  const code = c.req.query('code')
  const upstreamError = c.req.query('error')
  if (!rawState) {
    return c.text('Missing state or code from GitHub callback', 400)
  }
  const transaction = await consumeTransaction(c.env, c.req.raw, rawState)
  if (!transaction) return c.text('Invalid or expired login. Please start again.', 400)
  c.header('Set-Cookie', transaction.clearCookie)
  if (upstreamError) return c.text('GitHub login was cancelled. You can close this page or start again.', 400)
  if (!code) return c.text('Missing code from GitHub callback', 400)

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', c.req.url).href,
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!tokenResponse.ok) {
    return c.text('Failed to exchange code with GitHub', 502)
  }

  const tokenBody = await tokenResponse.json<{ access_token?: string; error?: string }>()
  if (!tokenBody.access_token) {
    return c.text(`GitHub OAuth error: ${tokenBody.error ?? 'no access_token returned'}`, 400)
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'User-Agent': 'github-mcp-server',
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!userResponse.ok) {
    return c.text('Failed to fetch GitHub user profile', 502)
  }
  const githubUser = await userResponse.json<{ login: string; name: string | null; id: number; avatar_url: string }>()

  // Optional allowlist: restrict this server to specific GitHub usernames.
  if (!isAllowedUser(githubUser.login, c.env.GITHUB_ALLOWED_USERS, transaction.transaction.kind === 'dashboard')) {
    return c.text(`GitHub user "${githubUser.login}" is not authorized to use this server.`, 403)
  }

  if (transaction.transaction.kind === 'dashboard') {
    const sessionCookie = await createSession(c.env, {
      login: githubUser.login, name: githubUser.name ?? githubUser.login,
      avatarUrl: githubUser.avatar_url, accessToken: tokenBody.access_token,
    })
    const response = new Response(null, { status: 302, headers: { Location: '/dashboard' } })
    response.headers.append('Set-Cookie', transaction.clearCookie)
    response.headers.append('Set-Cookie', sessionCookie)
    return response
  }
  const oauthReqInfo: AuthRequest = transaction.transaction.request

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: githubUser.login,
    metadata: { label: githubUser.name ?? githubUser.login },
    scope: oauthReqInfo.scope,
    props: {
      login: githubUser.login,
      name: githubUser.name ?? githubUser.login,
      accessToken: tokenBody.access_token,
    },
  })

  return new Response(null, { status: 302, headers: { Location: redirectTo, 'Set-Cookie': transaction.clearCookie } })
})

export { app as GitHubHandler }

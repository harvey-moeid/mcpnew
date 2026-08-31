import { Hono } from 'hono'
import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from './utils'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) =>
  c.text(
    'This is a remote MCP server. Add it as a custom connector in Claude — see the README for setup.'
  )
)

app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  if (!oauthReqInfo.clientId) return c.text('Invalid authorization request: missing client_id', 400)

  const alreadyApproved = await clientIdAlreadyApproved(
    c.req.raw,
    oauthReqInfo.clientId,
    c.env.COOKIE_ENCRYPTION_KEY
  )
  if (alreadyApproved) {
    return redirectToGitHub(c.req.raw, oauthReqInfo, c.env)
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId)

  return renderApprovalDialog(c.req.raw, {
    client,
    server: {
      name: 'GitHub Ops MCP Server',
      description:
        'Lets Claude create repositories, push commits, open pull requests, and read files on your behalf, using your own GitHub account via OAuth.',
    },
    state: { oauthReqInfo },
  })
})

app.post('/authorize', async (c) => {
  const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY)

  if (!state.oauthReqInfo?.clientId) {
    return c.text('Invalid or expired approval request. Please try connecting again.', 400)
  }

  return redirectToGitHub(c.req.raw, state.oauthReqInfo, c.env, headers)
})

async function redirectToGitHub(
  request: Request,
  oauthReqInfo: AuthRequest,
  env: Env,
  extraHeaders: Record<string, string> = {}
) {
  const upstreamUrl = new URL('https://github.com/login/oauth/authorize')
  upstreamUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  upstreamUrl.searchParams.set('redirect_uri', new URL('/callback', request.url).href)
  upstreamUrl.searchParams.set('scope', 'repo read:user')
  upstreamUrl.searchParams.set('state', btoa(JSON.stringify(oauthReqInfo)))

  return new Response(null, {
    status: 302,
    headers: { ...extraHeaders, Location: upstreamUrl.toString() },
  })
}

app.get('/callback', async (c) => {
  const rawState = c.req.query('state')
  const code = c.req.query('code')
  const upstreamError = c.req.query('error')

  if (upstreamError) {
    return c.text(`GitHub denied the request: ${upstreamError}`, 400)
  }
  if (!rawState || !code) {
    return c.text('Missing state or code from GitHub callback', 400)
  }

  let oauthReqInfo: AuthRequest
  try {
    oauthReqInfo = JSON.parse(atob(rawState)) as AuthRequest
  } catch {
    return c.text('Invalid state parameter', 400)
  }
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid state: missing client_id', 400)
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', c.req.url).href,
    }),
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
  })
  if (!userResponse.ok) {
    return c.text('Failed to fetch GitHub user profile', 502)
  }
  const githubUser = await userResponse.json<{ login: string; name: string | null; id: number }>()

  // Optional allowlist: restrict this server to specific GitHub usernames.
  const allowedUsers = (c.env.GITHUB_ALLOWED_USERS ?? '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean)
  if (allowedUsers.length > 0 && !allowedUsers.includes(githubUser.login.toLowerCase())) {
    return c.text(`GitHub user "${githubUser.login}" is not authorized to use this server.`, 403)
  }

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

  return Response.redirect(redirectTo)
})

export { app as GitHubHandler }

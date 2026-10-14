import type { AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider'

const COOKIE_NAME = 'github_mcp_approved_clients'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

// --- Signed cookie helpers (HMAC-SHA256 via WebCrypto, no extra deps) ---

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function verifyValue(value: string, signature: string, secret: string): Promise<boolean> {
  const expected = await signValue(value, secret)
  // Not constant-time, but signature forgery risk here is low value
  // (worst case: skip the "already approved" convenience dialog).
  return expected === signature
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

/**
 * Reads and verifies the signed "approved clients" cookie, returning the
 * list of client ids it contains (or an empty array if missing/invalid).
 * Shared by clientIdAlreadyApproved (read-only check) and
 * parseRedirectApproval (merge-before-write), so both agree on what
 * "already approved" means.
 */
async function readApprovedClients(request: Request, cookieSecret: string): Promise<string[]> {
  const raw = getCookie(request, COOKIE_NAME)
  if (!raw) return []

  const [payload, signature] = raw.split('.')
  if (!payload || !signature) return []

  const valid = await verifyValue(payload, signature, cookieSecret)
  if (!valid) return []

  try {
    const parsed = JSON.parse(atob(payload))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Checks whether this browser has already approved the given OAuth client,
 * based on a signed cookie set after a previous approval. Avoids re-showing
 * the consent screen on every single connection attempt.
 */
export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  cookieSecret: string
): Promise<boolean> {
  const approvedClients = await readApprovedClients(request, cookieSecret)
  return approvedClients.includes(clientId)
}

interface ApprovalState {
  oauthReqInfo: AuthRequest
}

/**
 * Renders a minimal consent screen: "Claude wants to access your GitHub
 * account through this MCP server." Submitting posts back to /authorize.
 */
export function renderApprovalDialog(
  request: Request,
  options: {
    client: ClientInfo | null
    server: { name: string; description: string }
    state: ApprovalState
  }
): Response {
  const encodedState = btoa(JSON.stringify(options.state))
  const clientName = options.client?.clientName ?? options.client?.clientId ?? 'An MCP client'

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Authorize ${escapeHtml(options.server.name)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; }
    h1 { font-size: 1.4rem; }
    p { color: #4b5563; line-height: 1.5; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.5rem; margin-top: 1.5rem; }
    button { padding: 0.6rem 1.2rem; border-radius: 6px; border: none; font-size: 0.95rem; cursor: pointer; }
    .approve { background: #16a34a; color: white; margin-right: 0.5rem; }
    .deny { background: #f3f4f6; color: #1a1a1a; }
  </style>
</head>
<body>
  <h1>${escapeHtml(options.server.name)}</h1>
  <p>${escapeHtml(options.server.description)}</p>
  <div class="card">
    <p><strong>${escapeHtml(clientName)}</strong> wants to connect using your GitHub account.
    You'll be redirected to GitHub to sign in, then asked to approve access.</p>
    <form method="POST" action="${new URL('/authorize', request.url).pathname}">
      <input type="hidden" name="state" value="${encodedState}" />
      <button class="approve" type="submit" name="action" value="approve">Continue with GitHub</button>
      <button class="deny" type="submit" name="action" value="deny">Cancel</button>
    </form>
  </div>
</body>
</html>`

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

/**
 * Parses the POSTed approval form and, on approval, returns headers that set
 * the "already approved" cookie for next time. The new client id is merged
 * with whatever was already in the cookie, so approving one client doesn't
 * un-approve another.
 */
export async function parseRedirectApproval(
  request: Request,
  cookieSecret: string
): Promise<{ state: ApprovalState; headers: Record<string, string> }> {
  const form = await request.formData()
  const encodedState = form.get('state')
  const action = form.get('action')

  if (typeof encodedState !== 'string') {
    throw new Error('Missing state in approval form')
  }

  const state = JSON.parse(atob(encodedState)) as ApprovalState
  const headers: Record<string, string> = {}

  if (action === 'approve' && state.oauthReqInfo?.clientId) {
    const existing = await readApprovedClients(request, cookieSecret)
    const merged = Array.from(new Set([...existing, state.oauthReqInfo.clientId]))
    const payload = btoa(JSON.stringify(merged))
    const signature = await signValue(payload, cookieSecret)
    headers['Set-Cookie'] =
      `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${signature}`)}; ` +
      `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ONE_YEAR_SECONDS}`
  }

  return { state, headers }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

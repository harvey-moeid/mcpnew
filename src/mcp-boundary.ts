import installation from '../installation.json' with { type: 'json' }

export function rejectMcpRequest(request: Request, env: Env): Response | undefined {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/mcp')) return
  if (!['/mcp', '/mcp/'].includes(url.pathname)) return new Response('Not found', { status: 404 })
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!local && url.origin !== installation.publicOrigin) return new Response('Invalid MCP host', { status: 403 })
  const origin = request.headers.get('origin')
  const allowed = [installation.publicOrigin, ...(env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)]
  if (origin && !allowed.includes(origin) && !(local && origin === url.origin)) return new Response('Invalid MCP origin', { status: 403 })
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isAllowedUser } from './dashboard-auth'

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let redacted = text
  for (const secret of secrets) if (secret && secret.length >= 4) redacted = redacted.split(secret).join('[REDACTED]')
  return redacted.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, '[REDACTED]')
}

function redactValue(value: unknown, secrets: Array<string | undefined>): unknown {
  if (typeof value === 'string') return redactSecrets(value, secrets)
  if (Array.isArray(value)) return value.map(item => redactValue(item, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]))
  return value
}

// Applied at registration so legacy and newly added tools share the same boundary.
export function secureToolRegistration(server: McpServer, env: Env, login: string, githubToken: string) {
  const register = server.registerTool.bind(server)
  server.registerTool = (name, config, callback) => {
    const guarded = new Proxy(callback, { async apply(target, thisArg, args) {
      if (!login || !isAllowedUser(login, env.GITHUB_ALLOWED_USERS, true)) {
        return { isError: true, content: [{ type: 'text', text: 'Access denied. Reconnect with an allowed GitHub account.' }] }
      }
      // Cloudflare credentials are shared administrator authority, unlike per-user GitHub OAuth.
      const cloudflare = /^(?:worker_|kv_|d1_|r2_|pages_|zone_|dns_|cloudflare_|get_worker_|(?:list|get|put|delete)_r2_)/.test(name)
      if (cloudflare && !isAllowedUser(login, env.CLOUDFLARE_ALLOWED_USERS ?? env.GITHUB_ALLOWED_USERS, true)) {
        return { isError: true, content: [{ type: 'text', text: 'Cloudflare administration denied for this account.' }] }
      }
      const secrets = [githubToken, env.CLOUDFLARE_API_TOKEN, env.GITHUB_CLIENT_SECRET, env.COOKIE_ENCRYPTION_KEY, env.BRAVE_API_KEY]
      try {
        const response = await Reflect.apply(target, thisArg, args)
        const redacted = redactValue(response, secrets)
        if (new TextEncoder().encode(JSON.stringify(redacted)).byteLength > 4 * 1024 * 1024) return { isError: true, content: [{ type: 'text', text: 'Tool response exceeds 4 MiB. Use pagination, smaller selections or authenticated file downloads.' }] }
        return redacted
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Tool failed. Check permissions and reconnect if authentication expired.' }] }
      }
    } })
    return Reflect.apply(register, server, [name, config, guarded])
  }
}

import { createGitHubClient } from './github-client'
import { verifyCloudflareToken } from './cloudflare'
import { isAllowedUser } from './dashboard-auth'
import { filePrefix } from './files'

export async function connectionHealth(env: Env, login: string, token: string) {
  const cloudflareConfigured = Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID)
  const cloudflareAllowed = isAllowedUser(login, env.CLOUDFLARE_ALLOWED_USERS ?? env.GITHUB_ALLOWED_USERS, true)
  const probes = await Promise.allSettled([
    createGitHubClient(token).rest.users.getAuthenticated(),
    // Validate the table the dashboard actually reads, not only D1 connectivity.
    // Delay prepare() into a promise so missing bindings/schema fail this probe only.
    Promise.resolve().then(() => env.AUDIT_DB.prepare('SELECT id FROM audit_log LIMIT 1').first()),
    env.FILES_BUCKET ? env.FILES_BUCKET.list({ prefix: filePrefix(login), limit: 1 }) : Promise.reject(),
    cloudflareConfigured && cloudflareAllowed ? verifyCloudflareToken(env, 'user') : Promise.reject(),
  ])
  return { checkedAt: new Date().toISOString(), github: probes[0].status === 'fulfilled' ? 'available' : 'unavailable',
    database: probes[1].status === 'fulfilled' ? 'available' : 'unavailable',
    files: !env.FILES_BUCKET ? 'not_configured' : probes[2].status === 'fulfilled' ? 'available' : 'unavailable',
    cloudflare: !cloudflareAllowed ? 'not_authorized' : !cloudflareConfigured ? 'not_configured' : probes[3].status === 'fulfilled' && probes[3].value.status === 'active' ? 'active' : 'unavailable',
    scope: 'Read probes only; Cloudflare token validity does not prove every resource permission or tool health.' }
}

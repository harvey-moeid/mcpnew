import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateInstallation } from '../scripts/check-installation.mjs'
import { runSmoke } from '../scripts/smoke.mjs'
import { Script } from 'node:vm'
import { dashboardHtml, dashboardScript } from '../src/dashboard-page.ts'
import installation from '../installation.json' with { type: 'json' }

test('dashboard renders installation links and emits valid browser JavaScript', () => {
  assert.ok(dashboardHtml.includes(`${installation.publicOrigin}/mcp`))
  assert.ok(dashboardHtml.includes(`https://github.com/${installation.githubOwner}/${installation.githubRepo}`))
  assert.doesNotThrow(() => new Script(dashboardScript))
})

test('installation check rejects portable placeholders and accepts consistent new-account settings', async () => {
  const config = JSON.parse(await readFile(new URL('../installation.example.json', import.meta.url), 'utf8'))
  let toml = await readFile(new URL('../wrangler.example.toml', import.meta.url), 'utf8')
  assert.ok(validateInstallation(config, toml).length > 0)
  Object.assign(config, { publicOrigin: 'https://new-mcp.example.com', githubOwner: 'new-owner',
    githubRepo: 'new-repo', githubRef: 'main', workerName: 'new-mcp' })
  toml = toml.replaceAll('ganti-nama-worker', 'new-mcp').replaceAll('ganti-nama-database', 'new-audit')
    .replaceAll('GANTI_USERNAME_GITHUB', 'new-owner').replaceAll('GANTI_KV_NAMESPACE_ID', 'a'.repeat(32))
    .replaceAll('GANTI_D1_DATABASE_ID', '00000000-0000-0000-0000-000000000001')
  assert.deepEqual(validateInstallation(config, toml), [])
  assert.ok(validateInstallation({ ...config, workerName: 'different-worker' }, toml).length > 0)
  assert.ok(validateInstallation({ ...config, publicOrigin: 'https://new-mcp.example.com/path' }, toml).length > 0)
  assert.ok(validateInstallation(config, toml.replace('GITHUB_ALLOWED_USERS = "new-owner"', 'GITHUB_ALLOWED_USERS = ""')).length > 0)
})

const origin = 'https://new-mcp.example.com'
function mockSite(mcpStatus: number) {
  return async (input: string) => {
    const path = new URL(input).pathname
    if (path.includes('oauth-authorization-server')) return Response.json({
      issuer: origin, authorization_endpoint: origin + '/authorize',
      protected_resources: [origin + '/mcp'], code_challenge_methods_supported: ['S256'],
    })
    if (path === '/mcp') return new Response(null, { status: mcpStatus })
    if (path === '/dashboard/api/session') return Response.json({}, { status: 401 })
    return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
  }
}

test('post-deploy smoke passes valid endpoints and fails if anonymous MCP access opens', async () => {
  const errors: string[] = []
  const logger = { log() {}, error(message: string) { errors.push(message) } }
  assert.equal(await runSmoke(origin, mockSite(401), logger), 0)
  assert.equal(await runSmoke(origin, mockSite(200), logger), 1)
  assert.match(errors.join('\n'), /FAIL \/mcp/)
})

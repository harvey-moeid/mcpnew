import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export async function runSmoke(origin, request = fetch, logger = console) {
  const parsed = new URL(origin)
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password || /GANTI_/i.test(origin)) {
    throw new Error('Gunakan origin HTTPS yang sudah dikonfigurasi, tanpa slash akhir.')
  }
  const probes = [
    ['/', 200, 'text/html'],
    ['/dashboard', 200, 'text/html'],
    ['/.well-known/oauth-authorization-server', 200, 'application/json'],
    ['/mcp', 401, null],
    ['/dashboard/api/session', 401, 'application/json'],
  ]
  let failures = 0
  for (const [path, expectedStatus, type] of probes) {
    let response
    try {
      response = await request(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
      if (response.status !== expectedStatus) throw new Error(`HTTP ${response.status}, expected ${expectedStatus}`)
      if (type && !response.headers.get('content-type')?.includes(type)) throw new Error('Content-Type tidak sesuai')
      if (path.includes('oauth-authorization-server')) {
        const metadata = await response.json()
        if (metadata.issuer !== origin || metadata.authorization_endpoint !== `${origin}/authorize` ||
            !metadata.code_challenge_methods_supported?.includes('S256') ||
            !metadata.protected_resources?.includes(`${origin}/mcp`)) throw new Error('Metadata OAuth/origin/PKCE tidak sesuai')
      }
      logger.log(`PASS ${path} (${response.status})`)
    } catch (error) {
      failures++
      logger.error(`FAIL ${path}: ${error.message}`)
    } finally {
      if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {})
    }
  }
  logger.log('Login OAuth, hak akses, operasi GitHub, dan pemuatan skill tetap harus diuji melalui koneksi MCP.')
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(new URL('../installation.json', import.meta.url), 'utf8'))
  if (await runSmoke(process.argv[2] ?? config.publicOrigin)) process.exitCode = 1
}

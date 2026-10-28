import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { createSession, beginTransaction } from '../src/dashboard-auth.ts'

const origin = 'https://mcpnew.muidsoft.com'
const cookie = (value: string) => value.split(';')[0]

test('isolated workerd: OAuth discovery, DCR, invalid MCP token, real D1 tickets and binary R2 round trip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcpnew-runtime-'))
  const outfile = join(directory, 'index.js')
  execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', directory], { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: directory }, stdio: 'pipe' })
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, modulesRoot: directory, scriptPath: outfile, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    kvNamespaces: ['OAUTH_KV'], d1Databases: ['AUDIT_DB'], r2Buckets: ['FILES_BUCKET'],
    durableObjects: { MCP_OBJECT: { className: 'MyMCP', useSQLite: true } },
    bindings: { FILES_BUCKET_NAME: 'local-files', GITHUB_ALLOWED_USERS: 'owner,other', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'runtime-test-secret', COOKIE_ENCRYPTION_KEY: 'runtime-test-encryption-key', PROTECTED_BRANCHES: 'main,master', ALLOW_DIRECT_PUSH_TO_PROTECTED: 'false' },
    outboundService(request) {
      if (request.url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'runtime-github-test-token' })
      if (request.url === 'https://api.github.com/user') return Response.json({ login: 'owner', name: 'Owner', avatar_url: '', id: 1 })
      throw new Error('Unexpected outbound network request: ' + new URL(request.url).origin)
    },
  }))
  try {
    const db = await mf.getD1Database('AUDIT_DB'), kv = await mf.getKVNamespace('OAUTH_KV')
    for (const file of ['0001_create_audit_log.sql', '0002_file_management.sql', '0003_upload_sessions.sql']) {
      const sql = (await readFile('migrations/' + file, 'utf8')).replace(/^--.*$/gm, '')
      for (const statement of sql.split(';').map(sql => sql.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    const env = { OAUTH_KV: kv, COOKIE_ENCRYPTION_KEY: 'runtime-test-encryption-key', GITHUB_ALLOWED_USERS: 'owner,other' } as unknown as Env
    const request = (path: string, options: RequestInit = {}) => mf.dispatchFetch(origin + path, { redirect: 'manual', ...options })
    const discovery = await request('/.well-known/oauth-authorization-server')
    assert.equal(discovery.status, 200)
    const metadata = await discovery.json()
    assert.equal(metadata.authorization_endpoint, origin + '/authorize')
    assert.ok(metadata.code_challenge_methods_supported.includes('S256'))
    assert.equal((await request('/.well-known/oauth-protected-resource/mcp')).status, 200)
    const anonymous = await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(anonymous.status, 401)
    assert.match(anonymous.headers.get('www-authenticate')!, /resource_metadata/)
    assert.equal((await request('/mcp', { headers: { Authorization: 'Bearer invalid' } })).status, 401)
    assert.equal((await request('/mcp', { headers: { Origin: 'https://evil.invalid' } })).status, 403)
    assert.equal((await request('/mcp-typo')).status, 404)
    const registered = await request('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Isolated test client', redirect_uris: ['http://localhost:3000/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })
    assert.equal(registered.status, 201, await registered.clone().text())
    const clientId = (await registered.json()).client_id
    assert.ok(clientId)
    const verifier = 'v'.repeat(64)
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    const redirectUri = 'http://localhost:3000/callback'
    const authorize = await request('/authorize?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'client-state', code_challenge: challenge, code_challenge_method: 'S256', resource: origin + '/mcp' }))
    assert.equal(authorize.status, 200)
    const browserCookies = authorize.headers.getSetCookie().map(cookie).join('; ')
    const consentState = (await authorize.text()).match(/name="state" value="([^"]+)"/)![1]
    const consent = await request('/authorize', { method: 'POST', headers: { Cookie: browserCookies, Origin: origin }, body: new URLSearchParams({ state: consentState, action: 'approve' }) })
    assert.equal(consent.status, 302)
    const upstreamState = new URL(consent.headers.get('location')!).searchParams.get('state')!
    const mcpCallback = await request('/callback?code=github-test-code&state=' + upstreamState, { headers: { Cookie: consent.headers.getSetCookie().map(cookie).join('; ') } })
    assert.equal(mcpCallback.status, 302)
    const authorizationCode = new URL(mcpCallback.headers.get('location')!).searchParams.get('code')!
    assert.ok(authorizationCode)
    const tokenResponse = await request('/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: authorizationCode, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: origin + '/mcp' }) })
    assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text())
    const tokens = await tokenResponse.json()
    assert.ok(tokens.access_token); assert.ok(tokens.refresh_token)
    let sessionId: string | null = null
    const rpc = async (method: string, params: unknown, id: number) => {
      const response = await request('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.access_token, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-06-18', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
      assert.equal(response.status, 200, await response.clone().text())
      sessionId = response.headers.get('mcp-session-id') ?? sessionId
      const text = await response.text()
      const message = response.headers.get('content-type')?.includes('event-stream') ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))).find(message => message.id === id) : JSON.parse(text)
      assert.ok(message && !message.error, JSON.stringify(message))
      return message.result
    }
    const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'MCPNEW isolated regression', version: '1.0.0' } }, 1)
    assert.equal(initialized.serverInfo.name, 'BYGA MCP')
    const listed = await rpc('tools/list', {}, 2)
    const names = listed.tools.map((tool: any) => tool.name)
    for (const required of ['upload_file', 'create_file_upload', 'cancel_file_upload', 'list_files', 'get_file_download', 'push_files', 'search_repositories', 'get_workflow_jobs', 'list_skills', 'read_skill_file']) assert.ok(names.includes(required), required)
    assert.equal(new Set(names).size, names.length)
    const skills = await rpc('tools/call', { name: 'list_skills', arguments: {} }, 3)
    assert.equal(JSON.parse(skills.content[0].text).length, 5)
    const invalidTool = await rpc('tools/call', { name: 'create_file_upload', arguments: { filename: '../invalid', size: -1 } }, 4)
    assert.equal(invalidTool.isError, true)
    const inline = await rpc('tools/call', { name: 'upload_file', arguments: { filename: 'inline.bin', content_base64: 'AP+AAQ==' } }, 5)
    assert.ok(!inline.isError)
    const inlineFile = JSON.parse(inline.content[0].text)
    const inlineDownload = await request('/dashboard/api/files/download?key=' + encodeURIComponent(inlineFile.file.key), { headers: { Cookie: cookie(await createSession(env, { login: 'owner', name: 'Owner', avatarUrl: '', accessToken: 'test-github' })) } })
    assert.deepEqual(new Uint8Array(await inlineDownload.arrayBuffer()), new Uint8Array([0, 255, 128, 1]))
    const adminCreated = await rpc('tools/call', { name: 'put_r2_object', arguments: { bucket: 'local-files', key: 'artifacts/raw.bin', content: 'AP+AAQ==', encoding: 'base64', content_type: 'application/octet-stream' } }, 6)
    assert.ok(!adminCreated.isError, JSON.stringify(adminCreated))
    const nativeBucket = await mf.getR2Bucket('FILES_BUCKET')
    assert.deepEqual(new Uint8Array(await (await nativeBucket.get('artifacts/raw.bin'))!.arrayBuffer()), new Uint8Array([0, 255, 128, 1]))
    const duplicateAdmin = await rpc('tools/call', { name: 'put_r2_object', arguments: { bucket: 'local-files', key: 'artifacts/raw.bin', content: 'replacement' } }, 7)
    assert.equal(duplicateAdmin.isError, true)
    const refreshed = await request('/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, resource: origin + '/mcp' }) })
    assert.equal(refreshed.status, 200, await refreshed.clone().text())
    assert.ok((await refreshed.json()).access_token)

    // Real callback router/provider environment with mocked upstream GitHub only.
    const transaction = await beginTransaction(env, { kind: 'dashboard' })
    const callback = await request('/callback?code=test&state=' + transaction.state, { headers: { Cookie: cookie(transaction.cookie) } })
    assert.equal(callback.status, 302)
    const Cookie = cookie(callback.headers.getSetCookie().find(value => value.startsWith('__Host-ops_session='))!)
    assert.ok(Cookie)
    const health = await request('/dashboard/api/health', { headers: { Cookie } })
    assert.equal(health.status, 200)
    const healthData = await health.json()
    assert.equal(healthData.github, 'available'); assert.equal(healthData.files, 'available'); assert.equal(healthData.database, 'available'); assert.equal(healthData.cloudflare, 'not_configured')
    const other = cookie(await createSession(env, { login: 'other', name: 'Other', avatarUrl: '', accessToken: 'other-test-token' }))
    assert.equal((await request('/dashboard/api/files/uploads', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
    const makeTicket = async (name: string, size: number) => {
      const response = await request('/dashboard/api/files/uploads', { method: 'POST', headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: name, size }) })
      assert.equal(response.status, 201, await response.clone().text())
      return response.json()
    }
    const bytes = Uint8Array.from({ length: 65537 }, (_, i) => i % 256)
    const ticket = await makeTicket('binary 日本.zip', bytes.length)
    const send = (ticket: any, body: Uint8Array) => request('/file-transfers/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + ticket.uploadToken, 'Content-Length': String(body.length) }, body })
    const uploaded = await send(ticket, bytes)
    assert.equal(uploaded.status, 201, await uploaded.clone().text())
    const data = await uploaded.json()
    assert.equal(data.verified, true)
    assert.match(data.file.sha256, /^[a-f0-9]{64}$/)
    assert.equal(data.file.contentType, 'application/zip')
    const downloadPath = '/dashboard/api/files/download?key=' + encodeURIComponent(ticket.key)
    assert.equal((await request(downloadPath)).status, 401)
    assert.equal((await request(downloadPath, { headers: { Cookie: other } })).status, 404)
    const download = await request(downloadPath, { headers: { Cookie } })
    assert.equal(download.status, 200)
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes)
    assert.equal((await send(ticket, bytes)).status, 409)
    const status = await request('/file-transfers/status', { headers: { Authorization: 'Bearer ' + ticket.uploadToken } })
    assert.equal((await status.json()).status, 'completed')
    const cancelPath = (id: string) => '/dashboard/api/files/uploads/' + id + '/cancel'
    assert.equal((await request(cancelPath(ticket.uploadId), { method: 'POST', headers: { Cookie, Origin: origin } })).status, 409)
    const pending = await makeTicket('cancel.zip', 4)
    assert.equal((await request(cancelPath(pending.uploadId), { method: 'POST', headers: { Cookie: other, Origin: origin } })).status, 404)
    assert.equal((await request(cancelPath(pending.uploadId), { method: 'POST', headers: { Cookie, Origin: 'https://evil.invalid' } })).status, 403)
    assert.equal((await request(cancelPath(pending.uploadId), { method: 'POST', headers: { Cookie, Origin: origin } })).status, 200)
    assert.equal((await send(pending, new Uint8Array(4))).status, 409)
    assert.equal(await (await mf.getR2Bucket('FILES_BUCKET')).head(pending.key), null)
    // Cancel a real in-flight body after the D1 claim, before the last bytes arrive.
    const inFlight = await makeTicket('in-flight.zip', 4)
    let streamController: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; controller.enqueue(new Uint8Array([1, 2])) } })
    const receiving = request('/file-transfers/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + inFlight.uploadToken, 'Content-Length': '4' }, body: stream, duplex: 'half' } as RequestInit)
    let claimed = false
    for (let i = 0; i < 100; i++) {
      const row = await db.prepare('SELECT status FROM file_upload_sessions WHERE id = ?').bind(inFlight.uploadId).first<any>()
      if (row?.status === 'uploading') { claimed = true; break }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(claimed, true)
    assert.equal((await request(cancelPath(inFlight.uploadId), { method: 'POST', headers: { Cookie, Origin: origin } })).status, 200)
    streamController!.enqueue(new Uint8Array([3, 4])); streamController!.close()
    assert.equal((await receiving).status, 409)
    assert.equal(await (await mf.getR2Bucket('FILES_BUCKET')).head(inFlight.key), null)
    const parallel = await makeTicket('parallel.zip', 4)
    const simultaneous = await Promise.all([send(parallel, new Uint8Array(4)), send(parallel, new Uint8Array(4))])
    assert.deepEqual(simultaneous.map(response => response.status).sort(), [201, 409])
    // Revocable bearer downloads use real D1 expiry; private downloads remain the default.
    const shared = await request('/dashboard/api/files/manage/share', { method: 'POST', headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ticket.key, hours: 1 }) })
    assert.equal(shared.status, 201)
    const share = await shared.json(), sharePath = new URL(share.url).pathname
    assert.deepEqual(new Uint8Array(await (await request(sharePath)).arrayBuffer()), bytes)
    await db.prepare('UPDATE dashboard_file_shares SET expires_at = 0 WHERE id = ?').bind(share.id).run()
    assert.equal((await request(sharePath)).status, 404)
    const expired = await makeTicket('expired.zip', 4)
    await db.prepare('UPDATE file_upload_sessions SET expires_at = 0 WHERE id = ?').bind(expired.uploadId).run()
    assert.equal((await send(expired, new Uint8Array(4))).status, 409)
    const oversized = await request('/dashboard/api/files/uploads', { method: 'POST', headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'big.zip', size: 25 * 1024 * 1024 + 1 }) })
    assert.equal(oversized.status, 413)
    await db.prepare('DROP TABLE file_upload_sessions').run()
    const missingMigration = await request('/dashboard/api/files/uploads', { method: 'POST', headers: { Cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'migration.zip', size: 4 }) })
    assert.equal(missingMigration.status, 503)
    assert.ok(!(await missingMigration.text()).includes('no such table'))
    const migration = (await readFile('migrations/0003_upload_sessions.sql', 'utf8')).replace(/^--.*$/gm, '')
    for (const statement of migration.split(';').map(sql => sql.trim()).filter(Boolean)) await db.prepare(statement).run()
    const recovered = await makeTicket('recovered.zip', 4)
    assert.equal((await send(recovered, new Uint8Array(4))).status, 201)
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }) }
})

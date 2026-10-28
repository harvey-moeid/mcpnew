import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['src/mcp-agent.ts'], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'mcp-runtime-stubs', setup(build) {
  build.onResolve({ filter: /^(agents\/mcp|@modelcontextprotocol\/sdk\/server\/mcp.js)$/ }, args => ({ path: args.path, namespace: 'test-runtime' }))
  build.onLoad({ filter: /.*/, namespace: 'test-runtime' }, args => ({ contents: args.path === 'agents/mcp' ? 'export class McpAgent {}' : `export class McpServer { tools = new Map(); registerTool(name, config, handler) { this.tools.set(name, { config, handler }); } registerPrompt() {} }` }))
} }] })
const { MyMCP } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

async function setup(rest = {}) {
  const audit: unknown[][] = []
  const values = new Map<string, string>()
  const agent = new MyMCP()
  agent.props = { login: 'actor', name: 'Actor', accessToken: 'private-github-token' }
  agent.env = {
    GITHUB_ALLOWED_USERS: 'actor', PROTECTED_BRANCHES: 'main,master', ALLOW_DIRECT_PUSH_TO_PROTECTED: 'false',
    CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private-cloudflare-token',
    OAUTH_KV: { async get(key: string) { return values.get(key) ?? (key.startsWith('default-repo:') ? 'wrong/default' : null) }, async put(key: string, value: string) { values.set(key, value) }, async delete(key: string) { values.delete(key) } },
    AUDIT_DB: { prepare() { return { bind(...args: unknown[]) { audit.push(args); return { async run() {}, async first() { return null }, async all() { return { results: [] } } } } } } },
  }
  agent.octokit = () => ({ rest })
  await agent.init()
  return { tools: agent.server.tools as Map<string, any>, audit, env: agent.env, values }
}

test('repository writes cannot inherit default repo and every destructive tool requires confirmation', async () => {
  const { tools } = await setup()
  for (const [name, { config }] of tools) {
    if (config.annotations?.destructiveHint) assert.ok(config.inputSchema.confirm, name)
    if (config.annotations?.readOnlyHint === false && config.inputSchema?.owner && config.inputSchema?.repo) {
      assert.equal(config.inputSchema.owner.safeParse(undefined).success, false, name)
      assert.equal(config.inputSchema.repo.safeParse(undefined).success, false, name)
    }
  }
  const deletion = await tools.get('worker_delete').handler({ script_name: 'production', confirm: 'staging' })
  assert.equal(deletion.isError, true)
  assert.match(deletion.content[0].text, /Confirmation required/)
})

test('protected branch deletion and direct deployment are blocked before GitHub calls', async () => {
  const { tools } = await setup()
  assert.equal((await tools.get('delete_branch').handler({ owner: 'owner', repo: 'repo', branch: 'main', confirm: 'owner/repo@main' })).isError, true)
  const result = await tools.get('deploy_and_push').handler({ owner: 'owner', repo: 'repo', branch: 'main', files: [], workflow_id: 'deploy.yml', message: 'update' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /blocked/)
})

const sha = 'a'.repeat(40)
function deploymentRest(conclusion: string) {
  return { git: {
    async getRef() { return { data: { object: { sha: 'base' } } } },
    async getCommit() { return { data: { tree: { sha: 'tree' } } } },
    async createBlob() { return { data: { sha: 'blob' } } },
    async createTree() { return { data: { sha: 'new-tree' } } },
    async createCommit() { return { data: { sha, html_url: 'https://github.com/commit/' + sha } } },
    async updateRef() {},
  }, actions: {
    async createWorkflowDispatch() {},
    async listWorkflowRuns(args: any) {
      assert.equal(args.head_sha, sha)
      assert.equal(args.event, 'workflow_dispatch')
      return { data: { workflow_runs: [{ id: 42, head_sha: sha, event: 'workflow_dispatch', created_at: new Date().toISOString(), status: 'completed', conclusion, html_url: 'https://github.com/run/42' }] } }
    },
  } }
}
const deployArgs = { owner: 'owner', repo: 'repo', branch: 'feature', files: [{ path: 'index.html', content: 'updated' }], message: 'update', workflow_id: 'deploy.yml', wait: true, timeout_seconds: 10, smoke_test_url: 'https://example.test', expected_text: 'healthy' }

test('deploy waits for the pushed commit and runs smoke only on successful workflow', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('healthy'))
  const { tools, audit } = await setup(deploymentRest('success'))
  const result = await tools.get('deploy_and_push').handler(deployArgs)
  assert.equal(result.isError, false)
  const output = JSON.parse(result.content[0].text)
  assert.equal(output.commit, sha)
  assert.equal(output.run_id, 42)
  assert.equal(output.smoke.ok, true)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(audit[0][0], 'actor')
  const failed = await setup(deploymentRest('failure'))
  assert.equal((await failed.tools.get('deploy_and_push').handler(deployArgs)).isError, true)
  assert.equal(fetch.mock.callCount(), 1)
})

test('secret responses and audit never expose reflected API secret values', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, errors: [{ message: 'sensitive-secret-value' }] }, { status: 400 }))
  const { tools, audit } = await setup()
  const result = await tools.get('worker_secret_put').handler({ script_name: 'worker', secret_name: 'KEY', secret_value: 'sensitive-secret-value' })
  assert.equal(result.isError, true)
  assert.ok(!JSON.stringify({ result, audit }).includes('sensitive-secret-value'))
  assert.equal(audit[0][0], 'actor')
  assert.equal(audit[0][1], 'worker_secret_put')
  assert.equal(audit[0][3], 1)
})

test('dispatch failure reports an already-pushed commit without re-pushing or probing', async t => {
  const rest = deploymentRest('success')
  rest.actions.createWorkflowDispatch = async () => { throw new Error('dispatch failed') }
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected probe') })
  const { tools } = await setup(rest)
  const result = await tools.get('deploy_and_push').handler(deployArgs)
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, new RegExp(sha + ' was pushed'))
  assert.equal(fetch.mock.callCount(), 0)
})

test('PR merge pins reviewed SHA and reports API refusal as an error', async () => {
  const { tools } = await setup({ pulls: { async merge(args: any) {
    assert.equal(args.sha, sha)
    return { data: { merged: false, message: 'Checks pending' } }
  } } })
  const result = await tools.get('merge_pull_request').handler({ owner: 'owner', repo: 'repo', pull_number: 12, confirm: 'owner/repo#12', expected_head_sha: sha, merge_method: 'squash' })
  assert.equal(result.isError, true)
})

test('page selectors reach GitHub list API and audit reads are scoped to the actor', async () => {
  const { tools } = await setup({ repos: { async listForAuthenticatedUser(args: any) {
    assert.equal(args.page, 3)
    return { data: [] }
  } } })
  const result = await tools.get('list_repositories').handler({ type: 'owner', page: 3, per_page: 20 })
  assert.ok(!result.isError)
  const denied = await tools.get('get_audit_log').handler({ actor: 'another-user', limit: 20 })
  assert.equal(denied.isError, true)
})


test('MCP uploads binary files to owner dashboard storage and returns login-only URLs', async () => {
  const { tools, env, audit } = await setup()
  const writes: { key: string; bytes: Uint8Array; options: R2PutOptions }[] = []
  env.FILES_BUCKET = { async put(key: string, bytes: Uint8Array, options: R2PutOptions) {
    writes.push({ key, bytes, options })
    return { key, size: bytes.length, uploaded: new Date(), customMetadata: options.customMetadata }
  } }
  const bytes = new Uint8Array([0, 255, 128, 1])
  const content_base64 = Buffer.from(bytes).toString('base64')
  const response = await tools.get('upload_file').handler({ filename: '日本.zip', content_base64 })
  assert.ok(!response.isError)
  const data = JSON.parse(response.content[0].text)
  assert.equal(data.requiresLogin, true)
  assert.match(data.downloadUrl, /\/dashboard\/api\/files\/download\?key=/)
  assert.match(data.file.key, /^dashboard-files\/actor\//)
  assert.deepEqual(writes[0].bytes, bytes)
  assert.equal(writes[0].options.customMetadata?.filename, '日本.zip')
  assert.ok(!JSON.stringify(audit).includes(content_base64))
  const malformed = await tools.get('upload_file').handler({ filename: 'a', content_base64: 'not-base64!' })
  assert.equal(malformed.isError, true)
  assert.equal(writes.length, 1)
  const oversized = await tools.get('upload_file').handler({ filename: 'a', content_base64: Buffer.alloc(1024 * 1024 + 1).toString('base64') })
  assert.equal(oversized.isError, true)
  assert.equal(writes.length, 1)
})

test('workspace upload tickets are short lived, hashed in KV and never placed in download URLs or audit', async () => {
  const { tools, env, values, audit } = await setup()
  env.FILES_BUCKET = {}
  const response = await tools.get('create_file_upload').handler({ filename: 'report.pdf', size: 2048 })
  assert.ok(!response.isError)
  const data = JSON.parse(response.content[0].text)
  assert.match(data.uploadToken, /^[a-f0-9]{64}$/)
  assert.ok(Date.parse(data.expiresAt) > Date.now())
  assert.ok(Date.parse(data.expiresAt) <= Date.now() + 600000)
  assert.equal(data.requiresLogin, true)
  assert.ok(!data.downloadUrl.includes(data.uploadToken))
  assert.ok(!JSON.stringify([...values.entries(), audit]).includes(data.uploadToken))
  const ticket = JSON.parse([...values.values()][0])
  assert.equal(ticket.size, 2048)
  assert.equal(ticket.login, 'actor')
  assert.equal(ticket.key, data.key)
  assert.equal((await tools.get('create_file_upload').handler({ filename: '../secret', size: 1 })).isError, true)
  assert.equal((await tools.get('create_file_upload').handler({ filename: 'big.zip', size: 26 * 1024 * 1024 })).isError, true)
})

test('file tools recheck allowlist and refuse cross-account download keys before R2 reads', async () => {
  const { tools, env } = await setup()
  let reads = 0
  env.FILES_BUCKET = { async head() { reads++; return null } }
  assert.equal((await tools.get('get_file_download').handler({ key: 'dashboard-files/another-user/secret' })).isError, true)
  assert.equal(reads, 0)
  env.GITHUB_ALLOWED_USERS = 'another-user'
  assert.equal((await tools.get('create_file_upload').handler({ filename: 'a', size: 0 })).isError, true)
  assert.equal((await tools.get('list_files').handler({})).isError, true)
})

test('MCP file listing uses the same per-account prefix and cursor as the dashboard', async () => {
  const { tools, env } = await setup()
  env.FILES_BUCKET = { async list(options: R2ListOptions) {
    assert.equal(options.prefix, 'dashboard-files/actor/')
    assert.equal(options.cursor, 'prior')
    return { objects: [{ key: 'dashboard-files/actor/uuid/name.zip', uploaded: new Date(), size: 123, customMetadata: { filename: 'name.zip' } }], truncated: true, cursor: 'next' }
  } }
  const response = await tools.get('list_files').handler({ cursor: 'prior' })
  const data = JSON.parse(response.content[0].text)
  assert.equal(data.cursor, 'next')
  assert.equal(data.files[0].requiresLogin, true)
})

test('all administrative R2 tools recheck revoked or empty allowlists in an established session', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }))
  const { tools, env } = await setup()
  const calls = [
    ['list_r2_objects', { bucket: 'files', limit: 50 }],
    ['get_r2_object', { bucket: 'files', key: 'report.txt' }],
    ['put_r2_object', { bucket: 'files', key: 'report.txt', content: 'x' }],
    ['delete_r2_object', { bucket: 'files', key: 'report.txt', confirm: 'files:report.txt' }],
    ['r2_bucket_create', { name: 'files' }],
    ['r2_bucket_list', { per_page: 100 }],
    ['r2_bucket_delete', { name: 'files', confirm: 'files' }],
  ] as const
  for (const allowlist of ['another-user', '']) {
    env.GITHUB_ALLOWED_USERS = allowlist
    for (const [name, args] of calls) {
      const result = await tools.get(name).handler(args)
      assert.equal(result.isError, true, name)
      assert.match(result.content[0].text, /R2 access denied/, name)
    }
  }
  assert.equal(fetch.mock.callCount(), 0)
  env.GITHUB_ALLOWED_USERS = ' ACTOR '
  assert.ok(!(await tools.get('put_r2_object').handler({ bucket: 'files', key: 'report.txt', content: 'x' })).isError)
  assert.equal(fetch.mock.callCount(), 1)
})

test('R2 text creation preserves existing bytes and overwrite requires explicit target confirmation', async t => {
  let stored: string | undefined
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (new Headers(options.headers).get('If-None-Match') === '*' && stored !== undefined) return new Response(null, { status: 412 })
    stored = options.body as string
    return new Response(null, { status: 200 })
  })
  const { tools } = await setup()
  const tool = tools.get('put_r2_object')
  const args = { bucket: 'files', key: 'config.json', content: 'original', content_type: 'application/json' }
  assert.equal(tool.config.inputSchema.overwrite.parse(undefined), false)
  assert.equal(tool.config.annotations.destructiveHint, true)
  assert.ok(!(await tool.handler(args)).isError)
  const collision = await tool.handler({ ...args, content: 'replacement' })
  assert.equal(collision.isError, true)
  assert.match(collision.content[0].text, /already exists/)
  assert.equal(stored, 'original')
  for (const confirm of [undefined, 'files:other.json']) {
    const denied = await tool.handler({ ...args, content: 'replacement', overwrite: true, confirm })
    assert.equal(denied.isError, true)
    assert.match(denied.content[0].text, /Confirmation required/)
  }
  assert.equal(fetch.mock.callCount(), 2)
  const replaced = await tool.handler({ ...args, content: 'replacement', overwrite: true, confirm: 'files:config.json' })
  assert.ok(!replaced.isError)
  assert.equal(stored, 'replacement')
  assert.equal(fetch.mock.callCount(), 3)
})

test('database failure prevents inline R2 writes and ticket creation without leaking provider errors', async t => {
  const { tools, env, values } = await setup()
  let writes = 0
  env.FILES_BUCKET = { async put() { writes++; throw new Error('unexpected write') } }
  const original = env.AUDIT_DB.prepare.bind(env.AUDIT_DB)
  t.mock.method(env.AUDIT_DB, 'prepare', (sql: string) => {
    if (sql.includes('dashboard_file_state')) throw new Error('sensitive provider failure')
    return original(sql)
  })
  for (const [name, args] of [
    ['upload_file', { filename: 'report.txt', content_base64: 'eA==' }],
    ['create_file_upload', { filename: 'report.txt', size: 1 }],
  ] as const) {
    const result = await tools.get(name).handler(args)
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /D1 migrations/)
    assert.ok(!JSON.stringify(result).includes('sensitive provider failure'))
  }
  assert.equal(writes, 0)
  assert.equal([...values.keys()].filter(key => key.startsWith('file-upload:')).length, 0)
})

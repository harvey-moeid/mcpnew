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
  const agent = new MyMCP()
  agent.props = { login: 'actor', name: 'Actor', accessToken: 'private-github-token' }
  agent.env = {
    PROTECTED_BRANCHES: 'main,master', ALLOW_DIRECT_PUSH_TO_PROTECTED: 'false',
    CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'private-cloudflare-token',
    OAUTH_KV: { async get() { return 'wrong/default' } },
    AUDIT_DB: { prepare() { return { bind(...args: unknown[]) { audit.push(args); return { async run() {} } } } } },
  }
  agent.octokit = () => ({ rest })
  await agent.init()
  return { tools: agent.server.tools as Map<string, any>, audit }
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

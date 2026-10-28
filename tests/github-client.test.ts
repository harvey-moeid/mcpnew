import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const compiled = await build({ stdin: { contents: "export { withErrorHandling } from './src/error-handling'; export { createGitHubClient } from './src/github-client'; export { commitFiles } from './src/github-validation'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false })
const { createGitHubClient, commitFiles, withErrorHandling } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

test('GitHub client bounds read retries and never replays a failed write', async () => {
  const client = createGitHubClient('test-token')
  let calls = 0
  const fetch = async () => { calls++; return Response.json({ message: 'Unavailable' }, { status: 503 }) }
  await assert.rejects(client.request('GET /repos/{owner}/{repo}', { owner: 'owner', repo: 'repo', request: { fetch } }))
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(client.request('POST /user/repos', { name: 'repo', request: { fetch } }))
  assert.equal(calls, 1)
})

test('atomic commit schema rejects duplicates, traversal, excessive fanout and byte overflow', () => {
  assert.ok(commitFiles.safeParse([{ path: '.github/workflows/ci.yml', content: 'valid' }]).success)
  for (const files of [[], [{ path: '../secrets', content: 'x' }], [{ path: '/absolute', content: 'x' }], [{ path: 'a', content: 'x' }, { path: 'a', content: 'y' }], Array.from({ length: 101 }, (_, i) => ({ path: String(i), content: 'x' })), [{ path: 'x', content: '🐱'.repeat(300000) }]]) assert.equal(commitFiles.safeParse(files).success, false)
})


test('expired GitHub authentication and denied repository permissions remain actionable and are not retried', async () => {
  for (const status of [401, 403, 404, 429]) {
    const client = createGitHubClient('test-token')
    let calls = 0
    const fetch = async () => { calls++; return Response.json({ message: 'Permission denied' }, { status }) }
    const handler = withErrorHandling(async () => { await client.request('GET /repos/{owner}/{repo}', { owner: 'owner', repo: 'private', request: { fetch } }); return { content: [] } })
    const result = await handler()
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, status === 401 ? /Reconnect/ : status === 403 ? /denied/ : status === 404 ? /access/ : /rate limit/)
    assert.equal(calls, 1)
  }
})

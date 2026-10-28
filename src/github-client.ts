import { Octokit } from 'octokit'

export function createGitHubClient(token: string): Octokit {
  // Octokit's default retry plugin replays writes; disable it and install a read-only policy.
  const client = new Octokit({ auth: token, request: { timeout: 15000 }, retry: { enabled: false }, throttle: { enabled: false } })
  client.hook.wrap('request', async (request, options) => {
    try { return await request(options) }
    catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
      if (['GET', 'HEAD'].includes(options.method) && [502, 503, 504].includes(Number(status))) return request(options)
      throw error
    }
  })
  return client
}

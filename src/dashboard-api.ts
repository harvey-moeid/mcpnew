import { Hono } from 'hono'
import { dashboardFiles } from './dashboard-files'
import { readSession, destroySession, sameOrigin, type DashboardSession } from './dashboard-auth'
import { getWorkerDeployments, CloudflareApiError } from './cloudflare'
import installation from '../installation.json' with { type: 'json' }

type DashboardVariables = { session: DashboardSession }
export const dashboardApi = new Hono<{ Bindings: Env; Variables: DashboardVariables }>()

class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function github<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'User-Agent': 'github-ops-dashboard', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    const message = response.status === 401 ? 'Sesi GitHub berakhir. Keluar lalu masuk kembali.'
      : response.status === 403 || response.status === 429 ? 'GitHub membatasi permintaan atau akses ditolak. Coba lagi nanti.'
      : response.status === 404 ? 'Repo tidak ditemukan atau akun ini tidak memiliki akses.'
      : 'GitHub sedang tidak dapat dihubungi. Coba lagi nanti.'
    throw new GitHubError(response.status, message)
  }
  return response.json<T>()
}

dashboardApi.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  const session = await readSession(c.env, c.req.raw)
  if (!session) return c.json({ error: 'Masuk dengan GitHub untuk membuka dashboard.' }, 401)
  c.set('session', session)
  await next()
})

dashboardApi.onError((error, c) => {
  if (error instanceof GitHubError) return c.json({ error: error.message },
    error.status === 401 ? 401 : error.status === 404 ? 404 : 502)
  if (error instanceof CloudflareApiError) return c.json({ error: 'Koneksi Cloudflare gagal. Periksa izin koneksi atau coba lagi nanti.' }, 502)
  return c.json({ error: 'Data belum dapat dimuat. Coba lagi nanti.' }, 503)
})

dashboardApi.route('/files', dashboardFiles)

dashboardApi.get('/session', c => {
  const { login, name, avatarUrl, expiresAt } = c.get('session')
  return c.json({ user: { login, name, avatarUrl }, expiresAt,
    configuration: { cloudflare: Boolean(c.env.CLOUDFLARE_API_TOKEN && c.env.CLOUDFLARE_ACCOUNT_ID),
      audit: Boolean(c.env.AUDIT_DB), protectedBranches: c.env.PROTECTED_BRANCHES ?? 'main,master',
      directPushAllowed: c.env.ALLOW_DIRECT_PUSH_TO_PROTECTED === 'true',
      endpoint: `${new URL(c.req.url).origin}/mcp`, worker: installation.workerName } })
})

dashboardApi.post('/logout', async c => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Permintaan tidak valid.' }, 403)
  c.header('Set-Cookie', await destroySession(c.env, c.req.raw))
  return c.json({ ok: true })
})

type Repository = { id: number; name: string; full_name: string; description: string | null;
  private: boolean; html_url: string; language: string | null; updated_at: string;
  pushed_at: string; default_branch: string; archived: boolean; stargazers_count: number; open_issues_count: number }

dashboardApi.get('/repositories', async c => {
  const page = Number(c.req.query('page') ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > 100) return c.json({ error: 'Halaman tidak valid.' }, 400)
  const repos = await github<Repository[]>(c.get('session').accessToken,
    `/user/repos?sort=pushed&direction=desc&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`)
  return c.json({ repositories: repos.map(repo => ({ id: repo.id, name: repo.name, fullName: repo.full_name,
    description: repo.description, private: repo.private, url: repo.html_url, language: repo.language,
    updatedAt: repo.pushed_at || repo.updated_at, defaultBranch: repo.default_branch,
    archived: repo.archived, stars: repo.stargazers_count, issues: repo.open_issues_count })),
    page, hasMore: repos.length === 100 })
})

type PullRequest = { number: number; title: string; html_url: string; draft: boolean; created_at: string;
  user: { login: string } | null; head: { sha: string; ref: string }; base: { ref: string } }
type Check = { name: string; status: string; conclusion: string | null; html_url: string; started_at: string }
type WorkflowRun = { id: number; name: string; html_url: string; status: string; conclusion: string | null;
  head_branch: string; created_at: string; head_sha: string; run_number: number }

export function checkSummary(checks: Array<{ status?: string; conclusion?: string | null; state?: string }>): string {
  if (!checks.length) return 'none'
  if (checks.some(check => ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(check.conclusion ?? '') || ['failure', 'error'].includes(check.state ?? ''))) return 'failure'
  if (checks.some(check => check.status && check.status !== 'completed' || check.state === 'pending')) return 'pending'
  if (checks.some(check => check.conclusion === 'cancelled')) return 'cancelled'
  return 'success'
}

dashboardApi.get('/repository', async c => {
  const repo = c.req.query('repo') ?? ''
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo.split('/')[1])) return c.json({ error: 'Pilih repo yang valid.' }, 400)
  const token = c.get('session').accessToken
  const [pulls, workflowResult] = await Promise.all([
    github<PullRequest[]>(token, `/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=30`),
    github<{ workflow_runs: WorkflowRun[] }>(token, `/repos/${repo}/actions/runs?per_page=12`)
      .then(value => ({ runs: value.workflow_runs, error: null as string | null }))
      .catch(() => ({ runs: [] as WorkflowRun[], error: 'Riwayat Actions tidak tersedia untuk repo ini.' })),
  ])
  const items = []
  // Bound concurrency and request count; the UI clearly labels this as the 30 most recent PRs.
  for (let offset = 0; offset < pulls.length; offset += 5) {
    const batch = await Promise.all(pulls.slice(offset, offset + 5).map(async pr => {
      const checkResults = await Promise.allSettled([
        github<{ check_runs: Check[] }>(token, `/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`),
        github<{ statuses: Array<{ context: string; state: string; target_url: string | null }> }>(token, `/repos/${repo}/commits/${pr.head.sha}/status?per_page=100`),
      ])
      const checks = checkResults[0].status === 'fulfilled' ? checkResults[0].value.check_runs : []
      const statuses = checkResults[1].status === 'fulfilled' ? checkResults[1].value.statuses : []
      const latest = Array.from(new Map(checks.slice().reverse().map(check => [check.name, check])).values())
      return { number: pr.number, title: pr.title, url: pr.html_url, draft: pr.draft,
        author: pr.user?.login ?? 'GitHub', branch: pr.head.ref, base: pr.base.ref, createdAt: pr.created_at,
        status: checkResults.some(result => result.status === 'rejected') ? 'unknown' : checkSummary([...latest, ...statuses]),
        checks: latest.map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion })) }
    }))
    items.push(...batch)
  }
  return c.json({ repo, pullRequests: items, hasMorePullRequests: pulls.length === 30,
    runs: workflowResult.runs.map(run => ({ id: run.id, name: run.name, url: run.html_url,
      status: run.status, conclusion: run.conclusion, branch: run.head_branch, createdAt: run.created_at,
      sha: run.head_sha.slice(0, 7), number: run.run_number })), runsError: workflowResult.error,
    updatedAt: new Date().toISOString() })
})

dashboardApi.get('/deployments', async c => {
  if (!c.env.CLOUDFLARE_API_TOKEN || !c.env.CLOUDFLARE_ACCOUNT_ID) return c.json({ configured: false, deployments: [] })
  const result = await getWorkerDeployments(c.env, installation.workerName)
  return c.json({ configured: true, deployments: result.deployments.slice(0, 20).map(deployment => ({
    id: deployment.id, createdAt: deployment.created_on, strategy: deployment.strategy,
    versions: deployment.versions?.map(version => ({ id: version.version_id, percentage: version.percentage })),
  })) })
})

dashboardApi.get('/audit', async c => {
  const errorsOnly = c.req.query('errors') === 'true'
  const before = c.req.query('before')
  if (before && !/^\d{1,16}$/.test(before)) return c.json({ error: 'Filter aktivitas tidak valid.' }, 400)
  const clause = errorsOnly ? ' AND is_error = 1' : ''
  const cursor = before ? ' AND id < ?' : ''
  const query = c.env.AUDIT_DB.prepare(`SELECT id, tool, summary, is_error, created_at FROM audit_log WHERE actor = ?${clause}${cursor} ORDER BY id DESC LIMIT 51`)
  const result = await (before ? query.bind(c.get('session').login, Number(before)) : query.bind(c.get('session').login))
    .all<{ id: number; tool: string; summary: string; is_error: number; created_at: string }>()
  return c.json({ entries: result.results.slice(0, 50), hasMore: result.results.length > 50 })
})

import { connectionHealth } from './connection-health'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Octokit } from 'octokit'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { withErrorHandling } from './error-handling'
import { withAudit } from './audit-log'
import { requireConfirmation } from './operations'
import { readFileBytes } from './file-content'

const repoSchema = { owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/), repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).refine(value => !['.', '..'].includes(value)) }
const pagination = { page: z.number().int().min(1).max(1000).default(1), per_page: z.number().int().min(1).max(50).default(20) }
const sha = z.string().regex(/^[a-f0-9]{40}$/i)
const result = (value: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
const pageInfo = (page: number, per_page: number, count: number) => ({ page, per_page, next_page: count === per_page ? page + 1 : null })

export function registerGitHubTools(server: McpServer, client: Octokit, env: Env, login: string, token: string) {
  const write = <T>(name: string, handler: (args: T) => Promise<CallToolResult>) => withAudit(env.AUDIT_DB, login, name, () => 'GitHub operation', withErrorHandling(handler))
  server.registerTool('get_connection_status', {
    description: 'Run explicit read probes for GitHub, D1, private R2 and Cloudflare token validity. Does not prove every tool permission. Avoid repeated polling.',
    inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async () => result(await connectionHealth(env, login, token))))
  server.registerTool('search_repositories', {
    description: 'Search GitHub repositories with explicit pagination; only repositories accessible to your OAuth account are returned.',
    inputSchema: { query: z.string().min(1).max(1000), ...pagination }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ query, page, per_page }) => {
    const { data } = await client.rest.search.repos({ q: query, page, per_page })
    return result({ total_count: data.total_count, incomplete_results: data.incomplete_results, repositories: data.items.map(repo => ({ full_name: repo.full_name, private: repo.private, description: repo.description, url: repo.html_url, default_branch: repo.default_branch })), ...pageInfo(page, per_page, data.items.length) })
  }))
  server.registerTool('get_commit_status', {
    description: 'Get combined GitHub commit statuses plus check runs. Missing check permission is reported as unavailable, never as success.',
    inputSchema: { ...repoSchema, ref: z.string().min(1).max(255), ...pagination }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo, ref, page, per_page }) => {
    const status = await client.rest.repos.getCombinedStatusForRef({ owner, repo, ref, page, per_page })
    const checks = await client.rest.checks.listForRef({ owner, repo, ref, page, per_page }).then(({ data }) => ({ available: true, total_count: data.total_count, checks: data.check_runs.map(check => ({ id: check.id, name: check.name, status: check.status, conclusion: check.conclusion, url: check.html_url })) })).catch(() => ({ available: false, checks: [] }))
    return result({ sha: status.data.sha, state: status.data.state, total_count: status.data.total_count, statuses: status.data.statuses.map(item => ({ context: item.context, state: item.state, description: item.description, url: item.target_url })), checks, ...pageInfo(page, per_page, status.data.statuses.length) })
  }))
  server.registerTool('get_workflow_jobs', {
    description: 'Inspect jobs and failed steps for one workflow run. Follow next_page for additional jobs.',
    inputSchema: { ...repoSchema, run_id: z.number().int().positive(), ...pagination }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo, run_id, page, per_page }) => {
    const { data } = await client.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id, page, per_page, filter: 'latest' })
    return result({ total_count: data.total_count, jobs: data.jobs.map(job => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, url: job.html_url, steps: job.steps?.map(step => ({ name: step.name, number: step.number, status: step.status, conclusion: step.conclusion })) })), ...pageInfo(page, per_page, data.jobs.length) })
  }))
  server.registerTool('get_workflow_job_logs', {
    description: 'Read the first 1 MiB of a workflow job log, returning at most 20000 characters. Output is marked truncated when bounded. GitHub masks known Actions secrets; logs remain sensitive.',
    inputSchema: { ...repoSchema, job_id: z.number().int().positive() }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo, job_id }) => {
    const signal = AbortSignal.timeout(15000)
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job_id}/logs`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'BYGA-MCP', Accept: 'application/vnd.github+json' }, redirect: 'manual', signal })
    let logs = response
    if (response.status === 302) {
      const location = response.headers.get('location')
      if (!location) throw new Error('GitHub log download did not provide a URL.')
      const url = new URL(location)
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:[a-z0-9-]+\.)+(?:blob\.core\.windows\.net|actions\.githubusercontent\.com)$/.test(url.hostname)) throw new Error('GitHub returned an unsupported log storage hostname.')
      void response.body?.cancel().catch(() => {})
      // Credential containment: never forward GitHub Authorization to signed storage URLs.
      logs = await fetch(url.href, { redirect: 'manual', signal, headers: { Range: 'bytes=0-1048575' } })
    }
    if (!logs.ok) { void logs.body?.cancel().catch(() => {}); throw new Error(`GitHub logs unavailable (${logs.status}); check Actions read permission and retention.`) }
    // Range is requested at the trusted storage endpoint; readFileBytes also enforces
    // the bound if an upstream server ignores it (then return an actionable error).
    const bytes = await readFileBytes(logs.body, undefined, signal, 1024 * 1024)
    const text = new TextDecoder().decode(bytes)
    return result({ job_id, text: text.slice(0, 20000), truncated: text.length > 20000, maximum_bytes: 1024 * 1024 })
  }))
  server.registerTool('create_pull_request_review', {
    description: 'Submit a PR review for an explicitly reviewed head commit. Requires expected_head_sha and exact confirm=owner/repo#number. Does not bypass GitHub branch protection or merge the PR.',
    inputSchema: { ...repoSchema, pull_number: z.number().int().positive(), expected_head_sha: sha, event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']), body: z.string().min(1).max(20000), confirm: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, write('create_pull_request_review', async ({ owner, repo, pull_number, expected_head_sha, event, body, confirm }) => {
    requireConfirmation(confirm, `${owner}/${repo}#${pull_number}`)
    const { data: pr } = await client.rest.pulls.get({ owner, repo, pull_number })
    if (pr.head.sha !== expected_head_sha) throw new Error('PR head changed. Read the current diff before reviewing.')
    const { data } = await client.rest.pulls.createReview({ owner, repo, pull_number, commit_id: expected_head_sha, event, body })
    return result({ id: data.id, state: data.state, commit_id: data.commit_id, url: data.html_url })
  }))
  server.registerTool('get_repository_security', {
    description: 'Read repository permissions/security metadata. Security settings may be unavailable without administrator permission; absence is never proof of safety.',
    inputSchema: repoSchema, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo }) => {
    const { data } = await client.rest.repos.get({ owner, repo })
    return result({ repository: data.full_name, archived: data.archived, visibility: data.visibility, default_branch: data.default_branch, permissions: data.permissions ?? null, security_and_analysis: data.security_and_analysis ?? null, security_settings_available: Boolean(data.security_and_analysis) })
  }))
  server.registerTool('list_releases', {
    description: 'List releases and asset download metadata visible to your GitHub account, with pagination.',
    inputSchema: { ...repoSchema, ...pagination }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo, page, per_page }) => {
    const { data } = await client.rest.repos.listReleases({ owner, repo, page, per_page })
    return result({ releases: data.map(release => ({ id: release.id, tag: release.tag_name, name: release.name, draft: release.draft, prerelease: release.prerelease, url: release.html_url, published_at: release.published_at, assets: release.assets.map(asset => ({ name: asset.name, size: asset.size, url: asset.browser_download_url })) })), ...pageInfo(page, per_page, data.length) })
  }))
  server.registerTool('create_release', {
    description: 'Create a release on an explicit existing commit SHA. Draft by default. Creation requires confirm=owner/repo:tag. Never retries creation automatically.',
    inputSchema: { ...repoSchema, tag: z.string().min(1).max(255), target_commit_sha: sha, name: z.string().min(1).max(255), body: z.string().max(20000).default(''), draft: z.boolean().default(true), prerelease: z.boolean().default(false), confirm: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, write('create_release', async ({ owner, repo, tag, target_commit_sha, name, body, draft, prerelease, confirm }) => {
    requireConfirmation(confirm, `${owner}/${repo}:${tag}`)
    const { data } = await client.rest.repos.createRelease({ owner, repo, tag_name: tag, target_commitish: target_commit_sha, name, body, draft, prerelease })
    return result({ id: data.id, tag: data.tag_name, draft: data.draft, prerelease: data.prerelease, url: data.html_url })
  }))
  server.registerTool('list_deployments', {
    description: 'Track GitHub deployments with paginated metadata. Use get_deployment_statuses for state; this tool does not deploy anything.',
    inputSchema: { ...repoSchema, environment: z.string().max(255).optional(), ...pagination }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo, environment, page, per_page }) => {
    const { data } = await client.rest.repos.listDeployments({ owner, repo, environment, page, per_page })
    return result({ deployments: data.map(item => ({ id: item.id, sha: item.sha, ref: item.ref, environment: item.environment, created_at: item.created_at, description: item.description })), ...pageInfo(page, per_page, data.length) })
  }))
  server.registerTool('get_deployment_statuses', {
    description: 'Read GitHub deployment status history for one deployment, including environment and log URLs.',
    inputSchema: { ...repoSchema, deployment_id: z.number().int().positive(), ...pagination }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ owner, repo, deployment_id, page, per_page }) => {
    const { data } = await client.rest.repos.listDeploymentStatuses({ owner, repo, deployment_id, page, per_page })
    return result({ statuses: data.map(item => ({ id: item.id, state: item.state, description: item.description, environment_url: item.environment_url, log_url: item.log_url, created_at: item.created_at })), ...pageInfo(page, per_page, data.length) })
  }))
}

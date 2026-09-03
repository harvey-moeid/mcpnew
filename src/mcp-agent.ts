import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Octokit } from 'octokit'
import { z } from 'zod'
import { withErrorHandling } from './error-handling'
import { withAudit } from './audit-log'
import { assertBranchWritable } from './guardrails'
import {
  getWorkerDeployments,
  listR2Objects,
  getR2Object,
  putR2Object,
  deleteR2Object,
  // KV Namespaces
  createKVNamespace, listKVNamespaces, deleteKVNamespace,
  kvPut, kvGet, kvDelete, kvListKeys,
  // D1 Databases
  createD1Database, listD1Databases, deleteD1Database,
  d1Query, d1Export,
  // Workers management
  listWorkers, deleteWorker,
  workerSecretPut, workerSecretList, workerSecretDelete,
  getWorkerSubdomain,
  // R2 Bucket management
  createR2Bucket, listR2Buckets, deleteR2Bucket,
  // Pages
  listPagesProjects, getPagesProject,
  listPagesDeployments, triggerPagesDeployment,
  // DNS / Zones
  listZones, listDnsRecords, createDnsRecord, updateDnsRecord, deleteDnsRecord,
  // Analytics
  getWorkerAnalytics, getPagesAnalytics,
} from './cloudflare'
import { fetchUrl, webSearch } from './web'
import { releaseChecklistPrompt, prReviewPrompt, repoCleanupPrompt } from './prompts'

export type GitHubProps = {
  login: string
  name: string
  accessToken: string
}

// KV key helpers
const kvKey = {
  note: (actor: string, name: string) => `note:${actor}:${name}`,
  notePrefix: (actor: string) => `note:${actor}:`,
  defaultRepo: (actor: string) => `default-repo:${actor}`,
}

type StoredNote = {
  content: string
  updated_at: string
  actor: string
  tags?: string[]
}

export class MyMCP extends McpAgent<Env, unknown, GitHubProps> {
  server = new McpServer({
    name: 'GitHub Ops MCP Server',
    version: '2.1.0',
  })

  private octokit(): Octokit {
    if (!this.props?.accessToken) {
      throw new Error('Not authenticated: missing GitHub access token in session props')
    }
    return new Octokit({ auth: this.props.accessToken })
  }

  private async resolveRepo(
    owner: string | undefined,
    repo: string | undefined
  ): Promise<{ owner: string; repo: string }> {
    if (owner && repo) return { owner, repo }
    if (!this.props?.login) {
      throw new Error('Not authenticated: missing GitHub login in session props')
    }
    const stored = await this.env.OAUTH_KV.get(kvKey.defaultRepo(this.props.login))
    if (!stored) {
      throw new Error(
        'No owner/repo provided and no default repo set. ' +
        'Call set_default_repo first, or pass owner+repo explicitly.'
      )
    }
    const [storedOwner, storedRepo] = stored.split('/')
    return { owner: owner ?? storedOwner, repo: repo ?? storedRepo }
  }

  async init() {
    const octokit = this.octokit()
    const props = this.props as GitHubProps
    const audit = this.env.AUDIT_DB

    const writeTool = <Args>(
      toolName: string,
      summarize: (args: Args, result: import('@modelcontextprotocol/sdk/types.js').CallToolResult) => string,
      handler: (args: Args) => Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>
    ) => withAudit(audit, props.login, toolName, summarize, withErrorHandling(handler))

    this.server.registerTool('set_note', {
      description: 'Save a persistent note in KV storage. Notes survive across sessions and can be read back with get_note, list_notes, or found via search_notes. Optional tags help group and filter related notes.',
      inputSchema: {
        name: z.string().describe('Short key for the note'),
        content: z.string().describe('The note content. Can be multi-line.'),
        tags: z.array(z.string()).optional().describe('Optional tags for grouping/filtering, e.g. ["mcpnew", "todo"]'),
      },
      annotations: { title: 'Set note', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, withErrorHandling(async ({ name, content, tags }) => {
      const key = kvKey.note(props.login, name)
      const note: StoredNote = { content, updated_at: new Date().toISOString(), actor: props.login, tags: tags ?? [] }
      await this.env.OAUTH_KV.put(key, JSON.stringify(note))
      const tagsLabel = tags && tags.length > 0 ? ` (tags: ${tags.join(', ')})` : ''
      return { content: [{ type: 'text', text: `Note "${name}" saved.${tagsLabel}` }] }
    }))

    this.server.registerTool('get_note', {
      description: 'Read a previously saved note by name.',
      inputSchema: { name: z.string() },
      annotations: { title: 'Get note', readOnlyHint: true, openWorldHint: false },
    }, withErrorHandling(async ({ name }) => {
      const raw = await this.env.OAUTH_KV.get(kvKey.note(props.login, name))
      if (!raw) return { content: [{ type: 'text', text: `Note "${name}" not found.` }] }
      const { content, updated_at, tags } = JSON.parse(raw) as StoredNote
      const tagsLine = tags && tags.length > 0 ? `Tags: ${tags.join(', ')}\n` : ''
      return { content: [{ type: 'text', text: `Note: ${name}\nUpdated: ${updated_at}\n${tagsLine}\n${content}` }] }
    }))

    this.server.registerTool('list_notes', {
      description: 'List all saved notes.',
      inputSchema: {},
      annotations: { title: 'List notes', readOnlyHint: true, openWorldHint: false },
    }, withErrorHandling(async () => {
      const prefix = kvKey.notePrefix(props.login)
      const listed = await this.env.OAUTH_KV.list({ prefix })
      if (listed.keys.length === 0) return { content: [{ type: 'text', text: 'No notes saved yet.' }] }
      const entries = await Promise.all(listed.keys.map(async (k) => {
        const raw = await this.env.OAUTH_KV.get(k.name)
        if (!raw) return null
        const { content, updated_at, tags } = JSON.parse(raw) as StoredNote
        const name = k.name.replace(prefix, '')
        const preview = content.split('\n')[0].slice(0, 80)
        const tagsLabel = tags && tags.length > 0 ? ` [${tags.join(', ')}]` : ''
        return `${name}${tagsLabel}\n   Updated: ${updated_at}\n   Preview: ${preview}${content.length > 80 ? '...' : ''}`
      }))
      return { content: [{ type: 'text', text: `Notes (${listed.keys.length}):\n\n${entries.filter(Boolean).join('\n\n')}` }] }
    }))

    this.server.registerTool('search_notes', {
      description: 'Search saved notes by text (matches note name or content, case-insensitive) and/or by tag. Provide a query, tags, or both.',
      inputSchema: {
        query: z.string().optional().describe('Substring to search for in the note name or content'),
        tags: z.array(z.string()).optional().describe('Only include notes that have at least one of these tags'),
      },
      annotations: { title: 'Search notes', readOnlyHint: true, openWorldHint: false },
    }, withErrorHandling(async ({ query, tags }) => {
      if (!query && (!tags || tags.length === 0)) {
        return { content: [{ type: 'text', text: 'Provide a query and/or tags to search for.' }], isError: true }
      }
      const prefix = kvKey.notePrefix(props.login)
      const listed = await this.env.OAUTH_KV.list({ prefix })
      const q = query?.toLowerCase()
      const results: string[] = []
      for (const k of listed.keys) {
        const raw = await this.env.OAUTH_KV.get(k.name)
        if (!raw) continue
        const { content, updated_at, tags: noteTags } = JSON.parse(raw) as StoredNote
        const name = k.name.replace(prefix, '')
        const matchesQuery = !q || name.toLowerCase().includes(q) || content.toLowerCase().includes(q)
        const matchesTags = !tags || tags.length === 0 || (noteTags ?? []).some((t) => tags.includes(t))
        if (matchesQuery && matchesTags) {
          const preview = content.split('\n')[0].slice(0, 80)
          const tagsLabel = noteTags && noteTags.length > 0 ? ` [${noteTags.join(', ')}]` : ''
          results.push(`${name}${tagsLabel}\n   Updated: ${updated_at}\n   Preview: ${preview}${content.length > 80 ? '...' : ''}`)
        }
      }
      if (results.length === 0) return { content: [{ type: 'text', text: 'No matching notes found.' }] }
      return { content: [{ type: 'text', text: `Found ${results.length} note(s):\n\n${results.join('\n\n')}` }] }
    }))

    this.server.registerTool('delete_note', {
      description: 'Delete a saved note permanently.',
      inputSchema: { name: z.string() },
      annotations: { title: 'Delete note', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, writeTool('delete_note', ({ name }) => `Deleted note "${name}"`, async ({ name }) => {
      await this.env.OAUTH_KV.delete(kvKey.note(props.login, name))
      return { content: [{ type: 'text', text: `Note "${name}" deleted.` }] }
    }))

    this.server.registerTool('set_default_repo', {
      description: 'Set a default owner/repo so you don\'t have to type it on every tool call.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
      },
      annotations: { title: 'Set default repo', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, withErrorHandling(async ({ owner, repo }) => {
      await this.env.OAUTH_KV.put(kvKey.defaultRepo(props.login), `${owner}/${repo}`)
      return { content: [{ type: 'text', text: `Default repo set to ${owner}/${repo}.` }] }
    }))

    this.server.registerTool('get_default_repo', {
      description: 'Show the currently configured default repo.',
      inputSchema: {},
      annotations: { title: 'Get default repo', readOnlyHint: true, openWorldHint: false },
    }, withErrorHandling(async () => {
      const stored = await this.env.OAUTH_KV.get(kvKey.defaultRepo(props.login))
      if (!stored) return { content: [{ type: 'text', text: 'No default repo set.' }] }
      return { content: [{ type: 'text', text: `Default repo: ${stored}` }] }
    }))

    this.server.registerTool('whoami', {
      description: 'Return the GitHub account currently authenticated with this MCP server.',
      annotations: { title: 'Who am I', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => ({
      content: [{ type: 'text', text: `Authenticated as ${props.login} (${props.name})` }],
    })))

    this.server.registerTool('list_repositories', {
      description: 'List repositories owned by the authenticated user.',
      inputSchema: {
        type: z.enum(['all', 'owner', 'member']).default('owner'),
        per_page: z.number().min(1).max(50).default(20),
      },
      annotations: { title: 'List repositories', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ type, per_page }) => {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({ type, per_page, sort: 'updated' })
      const text = data.map((r) => `${r.private ? '[private]' : '[public]'} ${r.full_name} - ${r.html_url}`).join('\n')
      return { content: [{ type: 'text', text: text || 'No repositories found.' }] }
    }))

    this.server.registerTool('get_file_contents', {
      description: 'Read the contents of a file or list a directory from a GitHub repository.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        path: z.string(),
        ref: z.string().optional(),
      },
      annotations: { title: 'Read file or directory', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, path, ref }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.repos.getContent({ ...r, path, ref })
      if (Array.isArray(data)) {
        const listing = data.map((entry) => `${entry.type}\t${entry.path}`).join('\n')
        return { content: [{ type: 'text', text: `Directory listing:\n${listing}` }] }
      }
      if (!('content' in data) || data.type !== 'file') {
        return { content: [{ type: 'text', text: 'Path does not point to a readable file.' }] }
      }
      const decoded = atob(data.content.replace(/\n/g, ''))
      return { content: [{ type: 'text', text: decoded }] }
    }))

    this.server.registerTool('list_commits', {
      description: 'List recent commits on a branch.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().optional(),
        per_page: z.number().min(1).max(50).default(10),
      },
      annotations: { title: 'List commits', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, branch, per_page }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.repos.listCommits({ ...r, sha: branch, per_page })
      const text = data.map((c) => `${c.sha.slice(0, 7)}  ${c.commit.message.split('\n')[0]}`).join('\n')
      return { content: [{ type: 'text', text: text || 'No commits found.' }] }
    }))

    this.server.registerTool('list_issues', {
      description: 'List issues in a repository.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        state: z.enum(['open', 'closed', 'all']).default('open'),
        per_page: z.number().min(1).max(50).default(20),
      },
      annotations: { title: 'List issues', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, state, per_page }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.issues.listForRepo({ ...r, state, per_page })
      const issuesOnly = data.filter((i) => !i.pull_request)
      const text = issuesOnly.map((i) => `#${i.number} [${i.state}] ${i.title} - ${i.html_url}`).join('\n')
      return { content: [{ type: 'text', text: text || 'No issues found.' }] }
    }))

    this.server.registerTool('list_pull_requests', {
      description: 'List pull requests in a repository, optionally filtered by state.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        state: z.enum(['open', 'closed', 'all']).default('open'),
        per_page: z.number().min(1).max(50).default(20),
      },
      annotations: { title: 'List pull requests', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, state, per_page }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.pulls.list({ ...r, state, per_page })
      if (data.length === 0) return { content: [{ type: 'text', text: 'No pull requests found.' }] }
      const text = data.map((pr) => `#${pr.number} [${pr.state}] ${pr.title}\n  ${pr.head.ref} -> ${pr.base.ref} | by ${pr.user?.login ?? 'unknown'}\n  ${pr.html_url}`).join('\n\n')
      return { content: [{ type: 'text', text: text }] }
    }))

    this.server.registerTool('get_pull_request', {
      description: 'Get full details of a single pull request.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number().describe('PR number'),
      },
      annotations: { title: 'Get pull request', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, pull_number }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data: pr } = await octokit.rest.pulls.get({ ...r, pull_number })
      const labels = pr.labels.map((l) => l.name).join(', ') || 'none'
      const reviewers = pr.requested_reviewers?.map((rv) => rv.login).join(', ') || 'none'
      const text =
        `PR #${pr.number}: ${pr.title}\n` +
        `State    : ${pr.state}${pr.merged ? ' (merged)' : ''}\n` +
        `Branch   : ${pr.head.ref} -> ${pr.base.ref}\n` +
        `Author   : ${pr.user?.login ?? 'unknown'}\n` +
        `Labels   : ${labels}\n` +
        `Reviewers: ${reviewers}\n` +
        `Mergeable: ${pr.mergeable ?? 'unknown'}\n` +
        `URL      : ${pr.html_url}\n` +
        `\n--- Description ---\n${pr.body ?? '(no description)'}\n`
      return { content: [{ type: 'text', text: text }] }
    }))

    this.server.registerTool('search_code', {
      description: 'Search for a code pattern or filename across one or all repositories.',
      inputSchema: {
        query: z.string(),
        per_page: z.number().min(1).max(30).default(10),
      },
      annotations: { title: 'Search code', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ query, per_page }) => {
      const { data } = await octokit.rest.search.code({ q: query, per_page, mediaType: { previews: ['text-match'] } } as any)
      if (data.total_count === 0) return { content: [{ type: 'text', text: `No results found for: ${query}` }] }
      const lines = data.items.map((item: any) => {
        const snippet = item.text_matches?.[0]?.fragment?.slice(0, 120).replace(/\n/g, ' ') ?? ''
        return `${item.repository.full_name} - ${item.path}\n   ${item.html_url}${snippet ? `\n   ...${snippet}...` : ''}`
      })
      return { content: [{ type: 'text', text: `Found ${data.total_count} result(s) (showing ${data.items.length}):\n\n` + lines.join('\n\n') }] }
    }))

    this.server.registerTool('repo_summary', {
      description: 'Quick snapshot of a repo: branch, open PRs, issues, recent commits, workflow status.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        workflow_id: z.string().optional(),
      },
      annotations: { title: 'Repo summary', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, workflow_id }) => {
      const r = await this.resolveRepo(owner, repo)
      const [repoData, prs, issues, commits, workflowRuns] = await Promise.allSettled([
        octokit.rest.repos.get(r),
        octokit.rest.pulls.list({ ...r, state: 'open', per_page: 5 }),
        octokit.rest.issues.listForRepo({ ...r, state: 'open', per_page: 5 }),
        octokit.rest.repos.listCommits({ ...r, per_page: 5 }),
        workflow_id ? octokit.rest.actions.listWorkflowRuns({ ...r, workflow_id, per_page: 1 }) : Promise.resolve(null),
      ])
      const lines: string[] = []
      if (repoData.status === 'fulfilled') {
        const d = repoData.value.data
        lines.push(`Repo: ${d.full_name}`, `Branch: ${d.default_branch}`, `Updated: ${d.updated_at}`, '')
      }
      if (prs.status === 'fulfilled') {
        const list = prs.value.data
        lines.push(`Open PRs (${list.length})`)
        list.length === 0 ? lines.push('  (none)') : list.forEach((pr) => lines.push(`  #${pr.number} ${pr.title}`))
        lines.push('')
      }
      if (issues.status === 'fulfilled') {
        const list = issues.value.data.filter((i) => !i.pull_request)
        lines.push(`Open Issues (${list.length})`)
        list.length === 0 ? lines.push('  (none)') : list.forEach((i) => lines.push(`  #${i.number} ${i.title}`))
        lines.push('')
      }
      if (commits.status === 'fulfilled') {
        lines.push('Recent Commits')
        commits.value.data.forEach((c) => lines.push(`  ${c.sha.slice(0, 7)}  ${c.commit.message.split('\n')[0]}`))
        lines.push('')
      }
      if (workflow_id && workflowRuns.status === 'fulfilled' && workflowRuns.value) {
        const run = (workflowRuns.value as any).data?.workflow_runs?.[0]
        if (run) {
          const icon = run.conclusion === 'success' ? 'OK' : run.status === 'in_progress' ? 'RUNNING' : 'FAIL'
          lines.push(`Workflow: ${workflow_id}`, `  [${icon}] ${run.status}${run.conclusion ? `/${run.conclusion}` : ''} - Run #${run.run_number}`, `  ${run.html_url}`)
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }))

    this.server.registerTool('get_audit_log', {
      description: 'Query the D1 audit log of all write/destructive tool calls made through this MCP server.',
      inputSchema: {
        limit: z.number().min(1).max(100).default(20),
        actor: z.string().optional(),
        tool: z.string().optional(),
        errors_only: z.boolean().default(false),
      },
      annotations: { title: 'Get audit log', readOnlyHint: true, openWorldHint: false },
    }, withErrorHandling(async ({ limit, actor, tool, errors_only }) => {
      const conditions: string[] = []
      const bindings: (string | number)[] = []
      if (actor) { conditions.push('actor = ?'); bindings.push(actor) }
      if (tool) { conditions.push('tool = ?'); bindings.push(tool) }
      if (errors_only) { conditions.push('is_error = 1') }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `SELECT id, actor, tool, summary, is_error, created_at FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`
      bindings.push(limit)
      const result = await this.env.AUDIT_DB.prepare(sql).bind(...bindings).all()
      if (!result.results || result.results.length === 0) return { content: [{ type: 'text', text: 'No audit log entries found.' }] }
      const rows = result.results as Array<{ id: number; actor: string; tool: string; summary: string; is_error: number; created_at: string }>
      const text = rows.map((row) => `${row.is_error ? '[ERR]' : '[OK]'} [${row.created_at}] ${row.actor} -> ${row.tool}\n  ${row.summary}`).join('\n\n')
      return { content: [{ type: 'text', text: `Audit log (${rows.length} entries):\n\n${text}` }] }
    }))

    this.server.registerTool('list_branches', {
      description: 'List branches in a repository.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        per_page: z.number().min(1).max(100).default(30),
        protected_only: z.boolean().default(false),
      },
      annotations: { title: 'List branches', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, per_page, protected_only }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.repos.listBranches({ ...r, per_page, protected: protected_only || undefined })
      if (data.length === 0) return { content: [{ type: 'text', text: 'No branches found.' }] }
      const text = data.map((b) => `${b.protected ? '[protected]' : '[branch]'} ${b.name.padEnd(40)} ${b.commit.sha.slice(0, 7)}`).join('\n')
      return { content: [{ type: 'text', text: `Branches in ${r.owner}/${r.repo} (${data.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('delete_branch', {
      description: 'Delete a branch from a repository. Protected branches are blocked.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string(),
      },
      annotations: { title: 'Delete branch', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('delete_branch', ({ branch }) => `Deleted branch "${branch}"`, async ({ owner, repo, branch }) => {
      const r = await this.resolveRepo(owner, repo)
      const protectedBranches = (this.env.PROTECTED_BRANCHES ?? 'main,master').split(',').map((b) => b.trim().toLowerCase())
      if (protectedBranches.includes(branch.toLowerCase())) {
        return { content: [{ type: 'text', text: `Branch "${branch}" is protected and cannot be deleted.` }], isError: true }
      }
      await octokit.rest.git.deleteRef({ owner: r.owner, repo: r.repo, ref: `heads/${branch}` })
      return { content: [{ type: 'text', text: `Deleted branch "${branch}" from ${r.owner}/${r.repo}.` }] }
    }))

    this.server.registerTool('create_repository', {
      description: 'Create a new GitHub repository owned by the authenticated user.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        private: z.boolean().default(true),
      },
      annotations: { title: 'Create repository', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('create_repository', ({ name }) => `Created repository "${name}"`, async ({ name, description, private: isPrivate }) => {
      const { data } = await octokit.rest.repos.createForAuthenticatedUser({ name, description, private: isPrivate })
      return { content: [{ type: 'text', text: `Created repository: ${data.html_url}` }] }
    }))

    this.server.registerTool('create_branch', {
      description: 'Create a new branch from an existing branch.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string(),
        from_branch: z.string().default('main'),
      },
      annotations: { title: 'Create branch', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('create_branch', ({ branch, from_branch }) => `Created branch "${branch}" from "${from_branch}"`, async ({ owner, repo, branch, from_branch }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data: ref } = await octokit.rest.git.getRef({ ...r, ref: `heads/${from_branch}` })
      await octokit.rest.git.createRef({ ...r, ref: `refs/heads/${branch}`, sha: ref.object.sha })
      return { content: [{ type: 'text', text: `Created branch "${branch}" from "${from_branch}" in ${r.owner}/${r.repo}` }] }
    }))

    this.server.registerTool('push_files', {
      description: 'Create or update one or more files in a single commit.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().default('main'),
        message: z.string(),
        files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
      },
      annotations: { title: 'Push files (commit)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('push_files', ({ files }) => `Pushed ${files.length} file(s)`, async ({ owner, repo, branch, message, files }) => {
      const r = await this.resolveRepo(owner, repo)
      assertBranchWritable(this.env, branch)
      const { data: refData } = await octokit.rest.git.getRef({ ...r, ref: `heads/${branch}` })
      const baseSha = refData.object.sha
      const { data: baseCommit } = await octokit.rest.git.getCommit({ ...r, commit_sha: baseSha })
      const blobs = await Promise.all(files.map(async (file) => {
        const { data: blob } = await octokit.rest.git.createBlob({ ...r, content: file.content, encoding: 'utf-8' })
        return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
      }))
      const { data: tree } = await octokit.rest.git.createTree({ ...r, base_tree: baseCommit.tree.sha, tree: blobs })
      const { data: commit } = await octokit.rest.git.createCommit({ ...r, message, tree: tree.sha, parents: [baseSha] })
      await octokit.rest.git.updateRef({ ...r, ref: `heads/${branch}`, sha: commit.sha })
      return { content: [{ type: 'text', text: `Pushed ${files.length} file(s) to ${r.owner}/${r.repo}@${branch}\nCommit: ${commit.html_url}` }] }
    }))

    this.server.registerTool('create_pull_request', {
      description: 'Open a pull request from one branch into another.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string(),
        head: z.string(),
        base: z.string().default('main'),
        body: z.string().optional(),
      },
      annotations: { title: 'Open pull request', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('create_pull_request', ({ head, base }) => `Opened PR "${head}" -> "${base}"`, async ({ owner, repo, title, head, base, body }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.pulls.create({ ...r, title, head, base, body })
      return { content: [{ type: 'text', text: `Opened pull request: ${data.html_url}` }] }
    }))

    this.server.registerTool('create_issue', {
      description: 'Create a new issue in a repository.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string(),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
      },
      annotations: { title: 'Create issue', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('create_issue', ({ title }) => `Created issue "${title}"`, async ({ owner, repo, title, body, labels }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.issues.create({ ...r, title, body, labels })
      return { content: [{ type: 'text', text: `Created issue #${data.number}: ${data.html_url}` }] }
    }))

    this.server.registerTool('delete_file', {
      description: 'Delete a file from a repository.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        path: z.string(),
        branch: z.string().default('main'),
        message: z.string(),
      },
      annotations: { title: 'Delete file', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('delete_file', ({ path, branch }) => `Deleted "${path}" from @${branch}`, async ({ owner, repo, path, branch, message }) => {
      const r = await this.resolveRepo(owner, repo)
      assertBranchWritable(this.env, branch)
      const { data: existing } = await octokit.rest.repos.getContent({ ...r, path, ref: branch })
      if (Array.isArray(existing) || !('sha' in existing)) {
        return { content: [{ type: 'text', text: `"${path}" is not a single file.` }], isError: true }
      }
      await octokit.rest.repos.deleteFile({ ...r, path, message, sha: existing.sha, branch })
      return { content: [{ type: 'text', text: `Deleted "${path}" from ${r.owner}/${r.repo}@${branch}` }] }
    }))

    this.server.registerTool('merge_pull_request', {
      description: 'Merge an open pull request.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number(),
        merge_method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
        commit_title: z.string().optional(),
      },
      annotations: { title: 'Merge pull request', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('merge_pull_request', ({ pull_number }) => `Merged PR #${pull_number}`, async ({ owner, repo, pull_number, merge_method, commit_title }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.pulls.merge({ ...r, pull_number, merge_method, commit_title })
      return { content: [{ type: 'text', text: data.merged ? `Merged PR #${pull_number}: ${data.sha}` : `Not merged: ${data.message}` }] }
    }))

    this.server.registerTool('rename_file', {
      description: 'Rename or move a file in a single atomic commit.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        old_path: z.string(),
        new_path: z.string(),
        branch: z.string().default('main'),
        message: z.string().optional(),
      },
      annotations: { title: 'Rename / move file', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('rename_file', ({ old_path, new_path }) => `Renamed "${old_path}" -> "${new_path}"`, async ({ owner, repo, old_path, new_path, branch, message }) => {
      const r = await this.resolveRepo(owner, repo)
      assertBranchWritable(this.env, branch)
      const { data: existing } = await octokit.rest.repos.getContent({ ...r, path: old_path, ref: branch })
      if (Array.isArray(existing) || !('content' in existing) || existing.type !== 'file') {
        return { content: [{ type: 'text', text: `"${old_path}" is not a file or does not exist.` }], isError: true }
      }
      const fileContent = atob(existing.content.replace(/\n/g, ''))
      const { data: refData } = await octokit.rest.git.getRef({ ...r, ref: `heads/${branch}` })
      const baseSha = refData.object.sha
      const { data: baseCommit } = await octokit.rest.git.getCommit({ ...r, commit_sha: baseSha })
      const { data: blob } = await octokit.rest.git.createBlob({ ...r, content: fileContent, encoding: 'utf-8' })
      const { data: tree } = await octokit.rest.git.createTree({
        ...r, base_tree: baseCommit.tree.sha,
        tree: [
          { path: new_path, mode: '100644', type: 'blob', sha: blob.sha },
          { path: old_path, mode: '100644', type: 'blob', sha: null as any },
        ],
      })
      const { data: commit } = await octokit.rest.git.createCommit({
        ...r, message: message ?? `rename: ${old_path} -> ${new_path}`, tree: tree.sha, parents: [baseSha],
      })
      await octokit.rest.git.updateRef({ ...r, ref: `heads/${branch}`, sha: commit.sha })
      return { content: [{ type: 'text', text: `Renamed "${old_path}" -> "${new_path}" in ${r.owner}/${r.repo}@${branch}\nCommit: ${commit.html_url}` }] }
    }))

    this.server.registerTool('scaffold_repository', {
      description: 'Create a new repository and seed it with files in one call.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        private: z.boolean().default(true),
        files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
      },
      annotations: { title: 'Scaffold repository', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('scaffold_repository', ({ name }) => `Scaffolded repository "${name}"`, async ({ name, description, private: isPrivate, files }) => {
      const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({ name, description, private: isPrivate, auto_init: true })
      if (!files || files.length === 0) return { content: [{ type: 'text', text: `Created repository: ${repo.html_url}` }] }
      const o = repo.owner.login
      const n = repo.name
      const { data: refData } = await octokit.rest.git.getRef({ owner: o, repo: n, ref: `heads/${repo.default_branch}` })
      const { data: baseCommit } = await octokit.rest.git.getCommit({ owner: o, repo: n, commit_sha: refData.object.sha })
      const blobs = await Promise.all(files.map(async (file) => {
        const { data: blob } = await octokit.rest.git.createBlob({ owner: o, repo: n, content: file.content, encoding: 'utf-8' })
        return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
      }))
      const { data: tree } = await octokit.rest.git.createTree({ owner: o, repo: n, base_tree: baseCommit.tree.sha, tree: blobs })
      const { data: commit } = await octokit.rest.git.createCommit({ owner: o, repo: n, message: 'Initial scaffold', tree: tree.sha, parents: [refData.object.sha] })
      await octokit.rest.git.updateRef({ owner: o, repo: n, ref: `heads/${repo.default_branch}`, sha: commit.sha })
      return { content: [{ type: 'text', text: `Created and scaffolded: ${repo.html_url} (${files.length} file(s) added)` }] }
    }))

    this.server.registerTool('trigger_workflow', {
      description: 'Trigger a GitHub Actions workflow via workflow_dispatch.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        workflow_id: z.string(),
        ref: z.string().default('main'),
        inputs: z.record(z.string(), z.string()).optional(),
      },
      annotations: { title: 'Trigger workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('trigger_workflow', ({ workflow_id, ref }) => `Triggered "${workflow_id}" on "${ref}"`, async ({ owner, repo, workflow_id, ref, inputs }) => {
      const r = await this.resolveRepo(owner, repo)
      await octokit.rest.actions.createWorkflowDispatch({ ...r, workflow_id, ref, inputs })
      return { content: [{ type: 'text', text: `Triggered "${workflow_id}" on ${r.owner}/${r.repo}@${ref}.` }] }
    }))

    this.server.registerTool('get_workflow_runs', {
      description: 'List recent runs of a GitHub Actions workflow.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        workflow_id: z.string(),
        per_page: z.number().min(1).max(20).default(5),
      },
      annotations: { title: 'Get workflow runs', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, workflow_id, per_page }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data } = await octokit.rest.actions.listWorkflowRuns({ ...r, workflow_id, per_page })
      const text = data.workflow_runs.map((run) => `#${run.run_number}  ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}  ${run.head_branch}  ${run.html_url}`).join('\n')
      return { content: [{ type: 'text', text: text || 'No workflow runs found.' }] }
    }))

    this.server.registerTool('wait_for_workflow', {
      description: 'Poll a GitHub Actions workflow until it completes or times out.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        workflow_id: z.string(),
        ref: z.string().default('main'),
        timeout_seconds: z.number().min(10).max(600).default(180),
        poll_interval_seconds: z.number().min(5).max(30).default(10),
      },
      annotations: { title: 'Wait for workflow', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, workflow_id, ref, timeout_seconds, poll_interval_seconds }) => {
      const r = await this.resolveRepo(owner, repo)
      const started = Date.now()
      await sleep(5000)
      while (Date.now() - started < timeout_seconds * 1000) {
        const { data } = await octokit.rest.actions.listWorkflowRuns({ ...r, workflow_id, branch: ref, per_page: 1 })
        const run = data.workflow_runs[0]
        if (!run) return { content: [{ type: 'text', text: `No runs found for "${workflow_id}" on "${ref}".` }], isError: true }
        const elapsed = Math.round((Date.now() - started) / 1000)
        if (run.status === 'completed') {
          const icon = run.conclusion === 'success' ? 'OK' : 'FAIL'
          return {
            content: [{ type: 'text', text: `[${icon}] "${workflow_id}" completed in ~${elapsed}s\n${run.status}/${run.conclusion ?? 'unknown'} - Run #${run.run_number}\n${run.html_url}` }],
            isError: run.conclusion !== 'success',
          }
        }
        await sleep(poll_interval_seconds * 1000)
      }
      return { content: [{ type: 'text', text: `Timed out after ${timeout_seconds}s.` }], isError: true }
    }))

    this.server.registerTool('deploy_and_push', {
      description: 'Push files AND trigger a deploy workflow in one call.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().default('main'),
        message: z.string(),
        files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
        workflow_id: z.string(),
      },
      annotations: { title: 'Push and deploy', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('deploy_and_push', ({ workflow_id }) => `Pushed and triggered "${workflow_id}"`, async ({ owner, repo, branch, message, files, workflow_id }) => {
      const r = await this.resolveRepo(owner, repo)
      assertBranchWritable(this.env, branch)
      const { data: refData } = await octokit.rest.git.getRef({ ...r, ref: `heads/${branch}` })
      const { data: baseCommit } = await octokit.rest.git.getCommit({ ...r, commit_sha: refData.object.sha })
      const blobs = await Promise.all(files.map(async (file) => {
        const { data: blob } = await octokit.rest.git.createBlob({ ...r, content: file.content, encoding: 'utf-8' })
        return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
      }))
      const { data: tree } = await octokit.rest.git.createTree({ ...r, base_tree: baseCommit.tree.sha, tree: blobs })
      const { data: commit } = await octokit.rest.git.createCommit({ ...r, message, tree: tree.sha, parents: [refData.object.sha] })
      await octokit.rest.git.updateRef({ ...r, ref: `heads/${branch}`, sha: commit.sha })
      await octokit.rest.actions.createWorkflowDispatch({ ...r, workflow_id, ref: branch })
      return { content: [{ type: 'text', text: `Pushed ${files.length} file(s) to ${r.owner}/${r.repo}@${branch} (${commit.html_url}) and triggered "${workflow_id}".` }] }
    }))

    this.server.registerTool('get_worker_deployment_status', {
      description: 'Check the current deployment status of a Cloudflare Worker.',
      inputSchema: { script_name: z.string().default('github-mcp-server') },
      annotations: { title: 'Get Worker deployment status', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ script_name }) => {
      const { deployments } = await getWorkerDeployments(this.env, script_name)
      if (deployments.length === 0) return { content: [{ type: 'text', text: `No deployments found for "${script_name}".` }] }
      const latest = deployments[0]
      const versionLines = (latest.versions ?? []).map((v) => `  - ${v.version_id}${v.percentage != null ? ` (${v.percentage}%)` : ''}${v.tag ? ` [${v.tag}]` : ''}`).join('\n')
      const text =
        `Worker      : ${script_name}\n` +
        `Deployed at : ${latest.created_on ?? 'unknown'}\n` +
        `Strategy    : ${latest.strategy ?? 'unknown'}\n` +
        `By          : ${latest.author_email ?? 'unknown'}\n` +
        (versionLines ? `Versions:\n${versionLines}\n` : '') +
        `\n(${deployments.length} deployment(s) on record)`
      return { content: [{ type: 'text', text }] }
    }))

    this.server.registerTool('list_r2_objects', {
      description: 'List objects in a Cloudflare R2 bucket. Requires CLOUDFLARE_API_TOKEN (R2:Read) and CLOUDFLARE_ACCOUNT_ID.',
      inputSchema: {
        bucket: z.string(),
        prefix: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      },
      annotations: { title: 'List R2 objects', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ bucket, prefix, limit, cursor }) => {
      const result = await listR2Objects(this.env, bucket, { prefix, limit, cursor })
      if (result.objects.length === 0) return { content: [{ type: 'text', text: `No objects in "${bucket}"${prefix ? ` (prefix: ${prefix})` : ''}.` }] }
      const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`
      const rows = result.objects.map((o) => `${o.key.padEnd(60)} ${fmt(o.size).padStart(10)}  ${o.last_modified}`)
      const header = `R2 Bucket: ${bucket}\nObjects: ${result.objects.length}${result.truncated ? ` (more, cursor: ${result.cursor})` : ''}\n\n${'Key'.padEnd(60)} ${'Size'.padStart(10)}  Last Modified\n${'-'.repeat(85)}\n`
      return { content: [{ type: 'text', text: header + rows.join('\n') }] }
    }))

    this.server.registerTool('get_r2_object', {
      description:
        'Read the content of a single object from a Cloudflare R2 bucket. ' +
        'Best suited for text files (JS, TS, JSON, HTML, Markdown, etc.). ' +
        'Requires CLOUDFLARE_API_TOKEN (R2:Read) and CLOUDFLARE_ACCOUNT_ID.',
      inputSchema: {
        bucket: z.string().describe('R2 bucket name'),
        key: z.string().describe('Object key / path, e.g. "assets/config.json"'),
      },
      annotations: { title: 'Get R2 object', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ bucket, key }) => {
      const { content, contentType, size } = await getR2Object(this.env, bucket, key)
      const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`
      const header = `R2 Object: ${bucket}/${key}\nContent-Type: ${contentType}\nSize: ${fmt(size)}\n\n`
      return { content: [{ type: 'text', text: header + content }] }
    }))

    this.server.registerTool('put_r2_object', {
      description:
        'Write text content to a Cloudflare R2 object. Creates or overwrites the key. ' +
        'Use for deploying config files, JSON data, HTML, scripts, or any text artifact directly to R2. ' +
        'Requires CLOUDFLARE_API_TOKEN (R2:Write) and CLOUDFLARE_ACCOUNT_ID.',
      inputSchema: {
        bucket: z.string().describe('R2 bucket name'),
        key: z.string().describe('Object key / path, e.g. "assets/config.json"'),
        content: z.string().describe('Text content to upload'),
        content_type: z.string().default('text/plain; charset=utf-8').describe('MIME type'),
      },
      annotations: { title: 'Put R2 object', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, writeTool('put_r2_object', ({ bucket, key }) => `Uploaded "${key}" to bucket "${bucket}"`, async ({ bucket, key, content, content_type }) => {
      await putR2Object(this.env, bucket, key, content, content_type)
      const size = new TextEncoder().encode(content).length
      const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`
      return { content: [{ type: 'text', text: `Uploaded "${key}" to R2 bucket "${bucket}" (${fmt(size)}, ${content_type}).` }] }
    }))

    this.server.registerTool('delete_r2_object', {
      description:
        'Delete a single object from a Cloudflare R2 bucket. ' +
        'Requires CLOUDFLARE_API_TOKEN (R2:Write) and CLOUDFLARE_ACCOUNT_ID.',
      inputSchema: {
        bucket: z.string().describe('R2 bucket name'),
        key: z.string().describe('Object key / path to delete'),
      },
      annotations: { title: 'Delete R2 object', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('delete_r2_object', ({ bucket, key }) => `Deleted "${key}" from bucket "${bucket}"`, async ({ bucket, key }) => {
      await deleteR2Object(this.env, bucket, key)
      return { content: [{ type: 'text', text: `Deleted "${key}" from R2 bucket "${bucket}".` }] }
    }))

    this.server.registerTool('smoke_test', {
      description:
        'POST-deploy smoke test: sends an HTTP GET to a given URL and checks the response status. ' +
        'Returns OK if the status matches expected_status, FAIL otherwise. ' +
        'Useful for verifying a Worker or Pages site is live after a deploy.',
      inputSchema: {
        url: z.string().url().describe('URL to probe, e.g. "https://mcpnew.muidsoft.com/"'),
        expected_status: z.number().min(100).max(599).default(200).describe('Expected HTTP status code (default 200)'),
        timeout_ms: z.number().min(1000).max(30000).default(10000).describe('Request timeout in milliseconds'),
      },
      annotations: { title: 'Smoke test URL', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ url, expected_status, timeout_ms }) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout_ms)
      let status: number
      let statusText: string
      let elapsed: number
      try {
        const t0 = Date.now()
        const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
        elapsed = Date.now() - t0
        status = res.status
        statusText = res.statusText
      } catch (err: any) {
        clearTimeout(timer)
        const msg = err?.name === 'AbortError' ? `Timed out after ${timeout_ms}ms` : String(err)
        return { content: [{ type: 'text', text: `[FAIL] ${url}\nError: ${msg}` }], isError: true }
      }
      clearTimeout(timer)
      const ok = status === expected_status
      const icon = ok ? 'OK' : 'FAIL'
      const text =
        `[${icon}] ${url}\n` +
        `Status  : ${status} ${statusText}\n` +
        `Expected: ${expected_status}\n` +
        `Elapsed : ${elapsed}ms`
      return { content: [{ type: 'text', text }], isError: !ok }
    }))

    this.server.registerTool('get_pr_preview_url', {
      description:
        'Get the Cloudflare Pages (or any GitHub deployment) preview URL for a pull request. ' +
        'Reads the most recent GitHub deployment on the PR head branch.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number().describe('PR number'),
      },
      annotations: { title: 'Get PR preview URL', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ owner, repo, pull_number }) => {
      const r = await this.resolveRepo(owner, repo)
      const { data: pr } = await octokit.rest.pulls.get({ ...r, pull_number })
      const headSha = pr.head.sha
      const headBranch = pr.head.ref
      const { data: deployments } = await octokit.rest.repos.listDeployments({
        ...r,
        ref: headBranch,
        per_page: 10,
      })
      if (deployments.length === 0) {
        return { content: [{ type: 'text', text: `No deployments found for PR #${pull_number} (branch: ${headBranch}).` }] }
      }
      const target = deployments.find((d) => d.sha === headSha) ?? deployments[0]
      const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({
        ...r,
        deployment_id: target.id,
        per_page: 5,
      })
      const latest = statuses[0]
      const previewUrl = latest?.environment_url ?? latest?.log_url ?? null
      const lines = [
        `PR #${pull_number}: ${pr.title}`,
        `Branch      : ${headBranch}`,
        `Head SHA    : ${headSha.slice(0, 7)}`,
        `Environment : ${target.environment}`,
        `Deploy state: ${latest?.state ?? 'unknown'}`,
        `Preview URL : ${previewUrl ?? '(not available yet)'}`,
      ]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }))

    this.server.registerTool('rerun_workflow', {
      description:
        'Re-run a specific GitHub Actions workflow run by its run_id. ' +
        'Useful after a transient failure - re-triggers the same run without a new commit. ' +
        'Use get_workflow_runs to find the run_id.',
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        run_id: z.number().describe('Workflow run ID (from get_workflow_runs)'),
        failed_jobs_only: z.boolean().default(false).describe('If true, only re-run failed jobs (not the whole run)'),
      },
      annotations: { title: 'Re-run workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, writeTool('rerun_workflow', ({ run_id }) => `Re-ran workflow run #${run_id}`, async ({ owner, repo, run_id, failed_jobs_only }) => {
      const r = await this.resolveRepo(owner, repo)
      if (failed_jobs_only) {
        await octokit.rest.actions.reRunWorkflowFailedJobs({ ...r, run_id })
      } else {
        await octokit.rest.actions.reRunWorkflow({ ...r, run_id })
      }
      const mode = failed_jobs_only ? 'failed jobs only' : 'all jobs'
      return { content: [{ type: 'text', text: `Re-running workflow run #${run_id} in ${r.owner}/${r.repo} (${mode}).` }] }
    }))

    this.server.registerTool('fetch_url', {
      description:
        'Fetch a web page by URL and return its readable text content (HTML tags, scripts, and styles ' +
        'stripped, entities decoded). Use this to read the content of a specific page, article, ' +
        'documentation URL, or API endpoint. Non-HTML responses (JSON, plain text) are returned as-is.',
      inputSchema: {
        url: z.string().url().describe('The URL to fetch, e.g. "https://example.com/article"'),
        max_length: z.number().min(500).max(30000).default(8000).describe('Max characters of extracted text to return'),
        timeout_ms: z.number().min(1000).max(30000).default(15000).describe('Request timeout in milliseconds'),
      },
      annotations: { title: 'Fetch URL', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ url, max_length, timeout_ms }) => {
      const result = await fetchUrl(url, { maxLength: max_length, timeoutMs: timeout_ms })
      const header =
        `URL         : ${result.url}\n` +
        (result.finalUrl !== result.url ? `Final URL   : ${result.finalUrl}\n` : '') +
        `Status      : ${result.status}\n` +
        `Content-Type: ${result.contentType}\n` +
        `Truncated   : ${result.truncated ? `yes (showing first ${max_length} chars)` : 'no'}\n\n`
      return { content: [{ type: 'text', text: header + result.text }] }
    }))

    this.server.registerTool('web_search', {
      description:
        'Search the web for a query and return a list of results (title, URL, description). ' +
        'Powered by the Brave Search API. Requires the BRAVE_API_KEY secret to be configured ' +
        'on this Worker (`wrangler secret put BRAVE_API_KEY`); returns a clear error if missing.',
      inputSchema: {
        query: z.string().describe('Search query'),
        count: z.number().min(1).max(20).default(5).describe('Number of results to return'),
        timeout_ms: z.number().min(1000).max(30000).default(15000).describe('Request timeout in milliseconds'),
      },
      annotations: { title: 'Web search', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ query, count, timeout_ms }) => {
      const results = await webSearch(this.env, query, count, timeout_ms)
      if (results.length === 0) return { content: [{ type: 'text', text: `No results found for: ${query}` }] }
      const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join('\n\n')
      return { content: [{ type: 'text', text: `Search results for "${query}":\n\n${text}` }] }
    }))

    // -----------------------------------------------------------------------
    // KV Namespace tools
    // -----------------------------------------------------------------------

    this.server.registerTool('kv_namespace_create', {
      description: 'Create a new KV namespace. Returns the namespace ID needed for kv_put/kv_get/kv_delete/kv_list_keys.',
      inputSchema: { title: z.string().describe('Namespace title (must be unique in account)') },
      annotations: { title: 'Create KV namespace', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('kv_namespace_create', ({ title }) => `Created KV namespace "${title}"`, async ({ title }) => {
      const ns = await createKVNamespace(this.env, title)
      return { content: [{ type: 'text', text: `Created KV namespace "${ns.title}"\nID: ${ns.id}` }] }
    }))

    this.server.registerTool('kv_namespace_list', {
      description: 'List all KV namespaces in the account with their IDs.',
      inputSchema: {},
      annotations: { title: 'List KV namespaces', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const namespaces = await listKVNamespaces(this.env)
      if (namespaces.length === 0) return { content: [{ type: 'text', text: 'No KV namespaces found.' }] }
      const text = namespaces.map((ns) => `${ns.title.padEnd(40)} ${ns.id}`).join('\n')
      return { content: [{ type: 'text', text: `KV Namespaces (${namespaces.length}):\n${'Title'.padEnd(40)} ID\n${'-'.repeat(80)}\n${text}` }] }
    }))

    this.server.registerTool('kv_namespace_delete', {
      description: 'Delete a KV namespace and all its keys. Irreversible.',
      inputSchema: { namespace_id: z.string().describe('KV namespace ID') },
      annotations: { title: 'Delete KV namespace', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('kv_namespace_delete', ({ namespace_id }) => `Deleted KV namespace ${namespace_id}`, async ({ namespace_id }) => {
      await deleteKVNamespace(this.env, namespace_id)
      return { content: [{ type: 'text', text: `Deleted KV namespace ${namespace_id}.` }] }
    }))

    this.server.registerTool('kv_put', {
      description: 'Write a value to a KV namespace key. Overwrites if the key already exists.',
      inputSchema: {
        namespace_id: z.string().describe('KV namespace ID'),
        key: z.string().describe('Key to write'),
        value: z.string().describe('Value to store (text)'),
        expiration_ttl: z.number().optional().describe('TTL in seconds from now (optional)'),
        expiration: z.number().optional().describe('Unix timestamp when the key expires (optional)'),
      },
      annotations: { title: 'KV put', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, writeTool('kv_put', ({ namespace_id, key }) => `KV put key "${key}" in ${namespace_id}`, async ({ namespace_id, key, value, expiration_ttl, expiration }) => {
      await kvPut(this.env, namespace_id, key, value, { expiration_ttl, expiration })
      const ttlNote = expiration_ttl ? ` (TTL: ${expiration_ttl}s)` : expiration ? ` (expires: ${new Date(expiration * 1000).toISOString()})` : ''
      return { content: [{ type: 'text', text: `Written key "${key}" to namespace ${namespace_id}${ttlNote}.` }] }
    }))

    this.server.registerTool('kv_get', {
      description: 'Read a value from a KV namespace by key.',
      inputSchema: {
        namespace_id: z.string().describe('KV namespace ID'),
        key: z.string().describe('Key to read'),
      },
      annotations: { title: 'KV get', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ namespace_id, key }) => {
      const value = await kvGet(this.env, namespace_id, key)
      if (value === null) return { content: [{ type: 'text', text: `Key "${key}" not found in namespace ${namespace_id}.` }] }
      return { content: [{ type: 'text', text: `Key: ${key}\nNamespace: ${namespace_id}\n\n${value}` }] }
    }))

    this.server.registerTool('kv_delete', {
      description: 'Delete a key from a KV namespace.',
      inputSchema: {
        namespace_id: z.string().describe('KV namespace ID'),
        key: z.string().describe('Key to delete'),
      },
      annotations: { title: 'KV delete', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('kv_delete', ({ namespace_id, key }) => `KV delete key "${key}" from ${namespace_id}`, async ({ namespace_id, key }) => {
      await kvDelete(this.env, namespace_id, key)
      return { content: [{ type: 'text', text: `Deleted key "${key}" from namespace ${namespace_id}.` }] }
    }))

    this.server.registerTool('kv_list_keys', {
      description: 'List keys in a KV namespace. Supports prefix filtering and cursor-based pagination.',
      inputSchema: {
        namespace_id: z.string().describe('KV namespace ID'),
        prefix: z.string().optional().describe('Filter keys by prefix'),
        limit: z.number().min(1).max(1000).default(100).describe('Max keys to return'),
        cursor: z.string().optional().describe('Cursor from a previous call for pagination'),
      },
      annotations: { title: 'KV list keys', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ namespace_id, prefix, limit, cursor }) => {
      const result = await kvListKeys(this.env, namespace_id, { prefix, limit, cursor })
      if (result.keys.length === 0) return { content: [{ type: 'text', text: 'No keys found.' }] }
      const lines = result.keys.map((k) => {
        const expiry = k.expiration ? `  [expires: ${new Date(k.expiration * 1000).toISOString()}]` : ''
        return `${k.name}${expiry}`
      })
      const footer = result.list_complete ? '' : `\n\nMore results available. Next cursor: ${result.cursor}`
      return { content: [{ type: 'text', text: `Keys in namespace ${namespace_id} (${result.keys.length}${result.list_complete ? '' : '+'}):\n\n${lines.join('\n')}${footer}` }] }
    }))

    // -----------------------------------------------------------------------
    // D1 Database tools
    // -----------------------------------------------------------------------

    this.server.registerTool('d1_database_create', {
      description: 'Create a new D1 database. Returns the UUID needed for subsequent queries.',
      inputSchema: {
        name: z.string().describe('Database name'),
        location: z.string().optional().describe('Primary location hint: "weur", "enam", "apac"'),
      },
      annotations: { title: 'Create D1 database', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('d1_database_create', ({ name }) => `Created D1 database "${name}"`, async ({ name, location }) => {
      const db = await createD1Database(this.env, name, location)
      const lines = [`Created D1 database: ${db.name}`, `UUID: ${db.uuid}`, db.created_at ? `Created: ${db.created_at}` : ''].filter(Boolean)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }))

    this.server.registerTool('d1_database_list', {
      description: 'List all D1 databases in the account with their UUIDs.',
      inputSchema: {},
      annotations: { title: 'List D1 databases', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const dbs = await listD1Databases(this.env)
      if (dbs.length === 0) return { content: [{ type: 'text', text: 'No D1 databases found.' }] }
      const text = dbs.map((db) => {
        const size = db.file_size ? ` (${(db.file_size / 1024).toFixed(1)} KB)` : ''
        const tables = db.num_tables != null ? `  ${db.num_tables} tables` : ''
        return `${db.name.padEnd(40)} ${db.uuid}${tables}${size}`
      }).join('\n')
      return { content: [{ type: 'text', text: `D1 Databases (${dbs.length}):\n${'Name'.padEnd(40)} UUID\n${'-'.repeat(80)}\n${text}` }] }
    }))

    this.server.registerTool('d1_database_delete', {
      description: 'Delete a D1 database permanently. All data is lost.',
      inputSchema: { database_id: z.string().describe('D1 database UUID') },
      annotations: { title: 'Delete D1 database', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('d1_database_delete', ({ database_id }) => `Deleted D1 database ${database_id}`, async ({ database_id }) => {
      await deleteD1Database(this.env, database_id)
      return { content: [{ type: 'text', text: `Deleted D1 database ${database_id}.` }] }
    }))

    this.server.registerTool('d1_query', {
      description: 'Execute a SQL query on a D1 database. Supports SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, etc.',
      inputSchema: {
        database_id: z.string().describe('D1 database UUID'),
        sql: z.string().describe('SQL statement to execute'),
        params: z.array(z.any()).optional().describe('Positional parameters for ? placeholders'),
      },
      annotations: { title: 'D1 query', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('d1_query', ({ database_id, sql }) => `D1 query on ${database_id}: ${sql.slice(0, 80)}`, async ({ database_id, sql, params }) => {
      const results = await d1Query(this.env, database_id, sql, params ?? [])
      const parts: string[] = []
      for (const result of results) {
        const rows = result.results ?? []
        const meta = result.meta ?? {}
        if (rows.length > 0) {
          const headers = Object.keys(rows[0])
          const colW = Math.max(12, Math.floor(100 / Math.max(headers.length, 1)))
          const headerRow = headers.map((h) => h.slice(0, colW).padEnd(colW)).join(' | ')
          const divider = '-'.repeat(headerRow.length)
          const dataRows = rows.slice(0, 100).map((row) =>
            headers.map((h) => String(row[h] ?? '').slice(0, colW).padEnd(colW)).join(' | ')
          )
          const trunc = rows.length > 100 ? `\n... (${rows.length - 100} more rows not shown)` : ''
          parts.push(`${headerRow}\n${divider}\n${dataRows.join('\n')}${trunc}`)
        } else {
          parts.push('(no rows returned)')
        }
        const metaParts: string[] = []
        if (meta.changes != null) metaParts.push(`changes: ${meta.changes}`)
        if (meta.rows_read != null) metaParts.push(`rows_read: ${meta.rows_read}`)
        if (meta.rows_written != null) metaParts.push(`rows_written: ${meta.rows_written}`)
        if (meta.duration != null) metaParts.push(`duration: ${meta.duration.toFixed(2)}ms`)
        if (metaParts.length > 0) parts.push(`[${metaParts.join(', ')}]`)
      }
      return { content: [{ type: 'text', text: parts.join('\n\n') || '(query completed)' }] }
    }))

    this.server.registerTool('d1_export', {
      description: 'Export the schema (and optionally data) of a D1 database as SQL INSERT statements.',
      inputSchema: {
        database_id: z.string().describe('D1 database UUID'),
        include_data: z.boolean().default(false).describe('Also dump table data (max 500 rows per table)'),
      },
      annotations: { title: 'D1 export', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ database_id, include_data }) => {
      const { schema, tables, data } = await d1Export(this.env, database_id, { includeData: include_data })
      const parts: string[] = [`-- Schema (${tables.length} table(s))\n${schema}`]
      if (include_data && data) {
        for (const [tableName, rows] of Object.entries(data)) {
          if (rows.length === 0) { parts.push(`-- Table: ${tableName} (empty)`); continue }
          const inserts = rows.map((row) => {
            const cols = Object.keys(row).map((k) => `"${k}"`).join(', ')
            const vals = Object.values(row).map((v) =>
              v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
            ).join(', ')
            return `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`
          })
          parts.push(`-- Table: ${tableName} (${rows.length} rows${rows.length === 500 ? ', may be truncated' : ''})\n${inserts.join('\n')}`)
        }
      }
      return { content: [{ type: 'text', text: parts.join('\n\n') }] }
    }))

    // -----------------------------------------------------------------------
    // Workers management tools
    // -----------------------------------------------------------------------

    this.server.registerTool('worker_list', {
      description: 'List all Cloudflare Workers deployed in the account.',
      inputSchema: {},
      annotations: { title: 'List Workers', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const workers = await listWorkers(this.env)
      if (workers.length === 0) return { content: [{ type: 'text', text: 'No Workers found.' }] }
      const text = workers.map((w) => {
        const modified = w.modified_on ? `  modified: ${w.modified_on.slice(0, 10)}` : ''
        const handlers = w.handlers?.length ? `  [${w.handlers.join(', ')}]` : ''
        return `${w.id}${handlers}${modified}`
      }).join('\n')
      return { content: [{ type: 'text', text: `Workers (${workers.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('worker_delete', {
      description: 'Delete a Cloudflare Worker script. Permanently removes the Worker and all its deployments.',
      inputSchema: { script_name: z.string().describe('Worker script name / ID') },
      annotations: { title: 'Delete Worker', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('worker_delete', ({ script_name }) => `Deleted Worker "${script_name}"`, async ({ script_name }) => {
      await deleteWorker(this.env, script_name)
      return { content: [{ type: 'text', text: `Deleted Worker "${script_name}".` }] }
    }))

    this.server.registerTool('worker_secret_put', {
      description: 'Set a secret on a Worker. Creates or overwrites the named secret.',
      inputSchema: {
        script_name: z.string().describe('Worker script name'),
        secret_name: z.string().describe('Secret name (env var key)'),
        secret_value: z.string().describe('Secret value'),
      },
      annotations: { title: 'Worker secret put', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, writeTool('worker_secret_put', ({ script_name, secret_name }) => `Set secret "${secret_name}" on Worker "${script_name}"`, async ({ script_name, secret_name, secret_value }) => {
      const result = await workerSecretPut(this.env, script_name, secret_name, secret_value)
      return { content: [{ type: 'text', text: `Set secret "${result.name}" on Worker "${script_name}".` }] }
    }))

    this.server.registerTool('worker_secret_list', {
      description: 'List the secrets attached to a Worker (names only — values are never returned by the API).',
      inputSchema: { script_name: z.string().describe('Worker script name') },
      annotations: { title: 'Worker secret list', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ script_name }) => {
      const secrets = await workerSecretList(this.env, script_name)
      if (secrets.length === 0) return { content: [{ type: 'text', text: `No secrets on Worker "${script_name}".` }] }
      const text = secrets.map((s) => `${s.name}  [${s.type}]`).join('\n')
      return { content: [{ type: 'text', text: `Secrets on Worker "${script_name}" (${secrets.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('worker_secret_delete', {
      description: 'Delete a secret from a Worker.',
      inputSchema: {
        script_name: z.string().describe('Worker script name'),
        secret_name: z.string().describe('Secret name to delete'),
      },
      annotations: { title: 'Worker secret delete', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('worker_secret_delete', ({ script_name, secret_name }) => `Deleted secret "${secret_name}" from Worker "${script_name}"`, async ({ script_name, secret_name }) => {
      await workerSecretDelete(this.env, script_name, secret_name)
      return { content: [{ type: 'text', text: `Deleted secret "${secret_name}" from Worker "${script_name}".` }] }
    }))

    this.server.registerTool('worker_subdomain_get', {
      description: 'Get the workers.dev subdomain for this account (constructs *.workers.dev URLs).',
      inputSchema: {},
      annotations: { title: 'Get Worker subdomain', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const subdomain = await getWorkerSubdomain(this.env)
      if (!subdomain) return { content: [{ type: 'text', text: 'No workers.dev subdomain configured.' }] }
      return { content: [{ type: 'text', text: `workers.dev subdomain: ${subdomain}\n\nWorkers: <script-name>.${subdomain}.workers.dev` }] }
    }))

    // -----------------------------------------------------------------------
    // R2 Bucket management tools
    // -----------------------------------------------------------------------

    this.server.registerTool('r2_bucket_create', {
      description: 'Create a new R2 bucket.',
      inputSchema: {
        name: z.string().describe('Bucket name (unique within account)'),
        location_hint: z.string().optional().describe('Location hint: "weur", "enam", "apac"'),
      },
      annotations: { title: 'Create R2 bucket', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('r2_bucket_create', ({ name }) => `Created R2 bucket "${name}"`, async ({ name, location_hint }) => {
      const bucket = await createR2Bucket(this.env, name, { locationHint: location_hint })
      const lines = [`Created R2 bucket: ${bucket.name}`]
      if (bucket.location) lines.push(`Location: ${bucket.location}`)
      if (bucket.creation_date) lines.push(`Created: ${bucket.creation_date}`)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }))

    this.server.registerTool('r2_bucket_list', {
      description: 'List all R2 buckets in the account.',
      inputSchema: {},
      annotations: { title: 'List R2 buckets', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const buckets = await listR2Buckets(this.env)
      if (buckets.length === 0) return { content: [{ type: 'text', text: 'No R2 buckets found.' }] }
      const text = buckets.map((b) => {
        const loc = b.location ? `  [${b.location}]` : ''
        const created = b.creation_date ? `  created: ${b.creation_date.slice(0, 10)}` : ''
        return `${b.name}${loc}${created}`
      }).join('\n')
      return { content: [{ type: 'text', text: `R2 Buckets (${buckets.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('r2_bucket_delete', {
      description: 'Delete an R2 bucket. The bucket must be empty first.',
      inputSchema: { name: z.string().describe('Bucket name') },
      annotations: { title: 'Delete R2 bucket', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('r2_bucket_delete', ({ name }) => `Deleted R2 bucket "${name}"`, async ({ name }) => {
      await deleteR2Bucket(this.env, name)
      return { content: [{ type: 'text', text: `Deleted R2 bucket "${name}".` }] }
    }))

    // -----------------------------------------------------------------------
    // Pages tools
    // -----------------------------------------------------------------------

    this.server.registerTool('pages_project_list', {
      description: 'List all Cloudflare Pages projects in the account.',
      inputSchema: {},
      annotations: { title: 'List Pages projects', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const projects = await listPagesProjects(this.env)
      if (projects.length === 0) return { content: [{ type: 'text', text: 'No Pages projects found.' }] }
      const text = projects.map((p) => {
        const url = p.subdomain ? `  → https://${p.subdomain}` : ''
        const status = p.latest_deployment?.latest_stage?.status ?? ''
        return `${p.name}${url}${status ? `  [${status}]` : ''}`
      }).join('\n')
      return { content: [{ type: 'text', text: `Pages Projects (${projects.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('pages_project_get', {
      description: 'Get details of a Pages project: URL, deployment status, connected branch.',
      inputSchema: { project_name: z.string().describe('Pages project name') },
      annotations: { title: 'Get Pages project', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ project_name }) => {
      const p = await getPagesProject(this.env, project_name)
      const ld = p.latest_deployment
      const lines: string[] = [
        `Project   : ${p.name}`,
        p.subdomain ? `URL       : https://${p.subdomain}` : '',
        ...(p.domains?.length ? p.domains.map((d) => `Domain    : ${d}`) : []),
      ].filter(Boolean)
      if (ld) {
        lines.push('', 'Latest deployment:')
        if (ld.url) lines.push(`  URL     : ${ld.url}`)
        if (ld.environment) lines.push(`  Env     : ${ld.environment}`)
        if (ld.latest_stage?.status) lines.push(`  Status  : ${ld.latest_stage.status}`)
        if (ld.deployment_trigger?.metadata?.branch) lines.push(`  Branch  : ${ld.deployment_trigger.metadata.branch}`)
        if (ld.deployment_trigger?.metadata?.commit_hash) lines.push(`  Commit  : ${ld.deployment_trigger.metadata.commit_hash.slice(0, 7)}`)
        if (ld.deployment_trigger?.metadata?.commit_message) lines.push(`  Message : ${ld.deployment_trigger.metadata.commit_message}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }))

    this.server.registerTool('pages_deployment_list', {
      description: 'List recent deployments for a Pages project.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
        limit: z.number().min(1).max(25).default(10),
      },
      annotations: { title: 'List Pages deployments', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ project_name, limit }) => {
      const deployments = await listPagesDeployments(this.env, project_name, limit)
      if (deployments.length === 0) return { content: [{ type: 'text', text: `No deployments found for "${project_name}".` }] }
      const text = deployments.map((d) => {
        const status = d.latest_stage?.status ?? 'unknown'
        const branch = d.deployment_trigger?.metadata?.branch ?? ''
        const commit = d.deployment_trigger?.metadata?.commit_hash?.slice(0, 7) ?? ''
        const msg = d.deployment_trigger?.metadata?.commit_message?.split('\n')[0].slice(0, 60) ?? ''
        const url = d.url ? `  ${d.url}` : ''
        return `[${status}] ${d.created_on.slice(0, 10)} ${branch}@${commit} ${msg}${url}`
      }).join('\n')
      return { content: [{ type: 'text', text: `Deployments for "${project_name}" (${deployments.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('pages_deployment_trigger', {
      description: 'Trigger a new deployment for a Pages project. Works for git-connected projects.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
        branch: z.string().optional().describe('Branch to deploy (default: production branch)'),
      },
      annotations: { title: 'Trigger Pages deployment', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('pages_deployment_trigger', ({ project_name }) => `Triggered deployment for Pages project "${project_name}"`, async ({ project_name, branch }) => {
      const deployment = await triggerPagesDeployment(this.env, project_name, branch)
      const lines = [
        `Triggered deployment for "${project_name}"`,
        `Deployment ID: ${deployment.id}`,
        deployment.url ? `URL: ${deployment.url}` : '',
        deployment.environment ? `Environment: ${deployment.environment}` : '',
        deployment.latest_stage?.status ? `Status: ${deployment.latest_stage.status}` : '',
      ].filter(Boolean)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }))

    // -----------------------------------------------------------------------
    // DNS / Zone tools
    // -----------------------------------------------------------------------

    this.server.registerTool('zone_list', {
      description: 'List all domains/zones in the Cloudflare account.',
      inputSchema: {},
      annotations: { title: 'List zones', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async () => {
      const zones = await listZones(this.env)
      if (zones.length === 0) return { content: [{ type: 'text', text: 'No zones found.' }] }
      const text = zones.map((z) =>
        `${z.name.padEnd(40)} ${z.id}  [${z.status}]${z.plan?.name ? `  ${z.plan.name}` : ''}`
      ).join('\n')
      return { content: [{ type: 'text', text: `Zones (${zones.length}):\n${'Domain'.padEnd(40)} Zone ID\n${'-'.repeat(80)}\n${text}` }] }
    }))

    this.server.registerTool('dns_record_list', {
      description: 'List DNS records for a zone. Use zone_list to get the zone_id.',
      inputSchema: {
        zone_id: z.string().describe('Zone ID (from zone_list)'),
        type: z.string().optional().describe('Filter by record type: A, AAAA, CNAME, TXT, MX, etc.'),
        name: z.string().optional().describe('Filter by record name'),
      },
      annotations: { title: 'List DNS records', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ zone_id, type, name }) => {
      const records = await listDnsRecords(this.env, zone_id, { type, name })
      if (records.length === 0) return { content: [{ type: 'text', text: 'No DNS records found.' }] }
      const text = records.map((r) => {
        const proxied = r.proxied ? ' [proxied]' : ''
        const ttl = r.ttl && r.ttl !== 1 ? ` TTL:${r.ttl}` : ''
        return `${r.type.padEnd(6)} ${r.name.padEnd(40)} ${r.content}${proxied}${ttl}  id:${r.id}`
      }).join('\n')
      return { content: [{ type: 'text', text: `DNS Records (${records.length}):\n\n${text}` }] }
    }))

    this.server.registerTool('dns_record_create', {
      description: 'Add a DNS record to a zone.',
      inputSchema: {
        zone_id: z.string().describe('Zone ID'),
        type: z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR']).describe('Record type'),
        name: z.string().describe('Record name (e.g. "www" or "@" for root)'),
        content: z.string().describe('Record value (IP, hostname, text, etc.)'),
        ttl: z.number().optional().describe('TTL in seconds (1 = auto/proxied)'),
        proxied: z.boolean().optional().describe('Proxy through Cloudflare (orange cloud)'),
        comment: z.string().optional().describe('Optional note about this record'),
      },
      annotations: { title: 'Create DNS record', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, writeTool('dns_record_create', ({ type, name, content }) => `Created ${type} record "${name}" → "${content}"`, async ({ zone_id, type, name, content, ttl, proxied, comment }) => {
      const record = await createDnsRecord(this.env, zone_id, { type, name, content, ttl, proxied, comment })
      return { content: [{ type: 'text', text: `Created ${record.type} record: ${record.name} → ${record.content}\nID: ${record.id}` }] }
    }))

    this.server.registerTool('dns_record_update', {
      description: 'Update an existing DNS record. Pass only the fields you want to change.',
      inputSchema: {
        zone_id: z.string().describe('Zone ID'),
        record_id: z.string().describe('DNS record ID (from dns_record_list)'),
        type: z.string().optional(),
        name: z.string().optional(),
        content: z.string().optional(),
        ttl: z.number().optional(),
        proxied: z.boolean().optional(),
        comment: z.string().optional(),
      },
      annotations: { title: 'Update DNS record', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, writeTool('dns_record_update', ({ record_id }) => `Updated DNS record ${record_id}`, async ({ zone_id, record_id, type, name, content, ttl, proxied, comment }) => {
      const record = await updateDnsRecord(this.env, zone_id, record_id, { type, name, content, ttl, proxied, comment })
      return { content: [{ type: 'text', text: `Updated ${record.type} record: ${record.name} → ${record.content}\nID: ${record.id}` }] }
    }))

    this.server.registerTool('dns_record_delete', {
      description: 'Delete a DNS record from a zone.',
      inputSchema: {
        zone_id: z.string().describe('Zone ID'),
        record_id: z.string().describe('DNS record ID (from dns_record_list)'),
      },
      annotations: { title: 'Delete DNS record', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, writeTool('dns_record_delete', ({ record_id }) => `Deleted DNS record ${record_id}`, async ({ zone_id, record_id }) => {
      await deleteDnsRecord(this.env, zone_id, record_id)
      return { content: [{ type: 'text', text: `Deleted DNS record ${record_id} from zone ${zone_id}.` }] }
    }))

    // -----------------------------------------------------------------------
    // Analytics tools
    // -----------------------------------------------------------------------

    this.server.registerTool('worker_analytics', {
      description: 'Get request count, error rate, and subrequest stats per hour for a Worker. Uses Cloudflare GraphQL Analytics API.',
      inputSchema: {
        script_name: z.string().describe('Worker script name'),
        days: z.number().min(1).max(30).default(7).describe('Number of days to look back'),
      },
      annotations: { title: 'Worker analytics', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ script_name, days }) => {
      const rows = await getWorkerAnalytics(this.env, script_name, days)
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `No analytics data for Worker "${script_name}" in the last ${days} day(s).` }] }
      }
      const totalReqs = rows.reduce((s, r) => s + r.requests, 0)
      const totalErrors = rows.reduce((s, r) => s + r.errors, 0)
      const errorRate = totalReqs > 0 ? ((totalErrors / totalReqs) * 100).toFixed(2) : '0.00'
      const header = `Worker analytics: ${script_name} (last ${days} day(s))\nTotal requests: ${totalReqs.toLocaleString()}  Errors: ${totalErrors.toLocaleString()} (${errorRate}%)\n\n`
      const lines = rows.map((r) => {
        const errPct = r.requests > 0 ? `${((r.errors / r.requests) * 100).toFixed(1)}%` : '0.0%'
        return `${r.datetime.slice(0, 13)}  req:${String(r.requests).padStart(8)}  err:${String(r.errors).padStart(6)} (${errPct.padStart(5)})  subreq:${r.subrequests}`
      })
      return { content: [{ type: 'text', text: header + lines.join('\n') }] }
    }))

    this.server.registerTool('pages_analytics', {
      description: 'Get pageview analytics per day for a Pages project. Uses Cloudflare GraphQL Analytics API.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
        days: z.number().min(1).max(30).default(7).describe('Number of days to look back'),
      },
      annotations: { title: 'Pages analytics', readOnlyHint: true, openWorldHint: true },
    }, withErrorHandling(async ({ project_name, days }) => {
      const rows = await getPagesAnalytics(this.env, project_name, days)
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `No analytics data for Pages project "${project_name}" in the last ${days} day(s).` }] }
      }
      const totalPageviews = rows.reduce((s, r) => s + r.pageviews, 0)
      const header = `Pages analytics: ${project_name} (last ${days} day(s))\nTotal pageviews: ${totalPageviews.toLocaleString()}\n\n`
      const lines = rows.map((r) => `${r.date}  pageviews: ${String(r.pageviews).padStart(8)}`)
      return { content: [{ type: 'text', text: header + lines.join('\n') }] }
    }))

    // -----------------------------------------------------------------------
    // Prompts
    // -----------------------------------------------------------------------

    this.server.registerPrompt('release-checklist', {
      title: 'Release checklist',
      description: 'Walk through verifying a release is healthy: CI status, smoke test, and Worker deployment status.',
      argsSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().default('main'),
        workflow_id: z.string().optional(),
        smoke_test_url: z.string().optional(),
      },
    }, async ({ owner, repo, branch, workflow_id, smoke_test_url }) => {
      const r = await this.resolveRepo(owner, repo)
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: releaseChecklistPrompt({ ...r, branch, workflow_id, smoke_test_url }) },
        }],
      }
    })

    this.server.registerPrompt('pr-review', {
      title: 'PR review',
      description: 'Review a pull request: description, CI status, preview deployment, and a structured recommendation.',
      argsSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number().describe('PR number to review'),
      },
    }, async ({ owner, repo, pull_number }) => {
      const r = await this.resolveRepo(owner, repo)
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: prReviewPrompt({ ...r, pull_number }) },
        }],
      }
    })

    this.server.registerPrompt('repo-cleanup', {
      title: 'Repo cleanup',
      description: 'Find branches that are already merged and safe to delete, and clean them up carefully.',
      argsSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
      },
    }, async ({ owner, repo }) => {
      const r = await this.resolveRepo(owner, repo)
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: repoCleanupPrompt(r) },
        }],
      }
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

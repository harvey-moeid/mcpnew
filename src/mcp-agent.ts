import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Octokit } from 'octokit'
import { z } from 'zod'
import { withErrorHandling } from './error-handling'
import { withAudit } from './audit-log'
import { assertBranchWritable } from './guardrails'
import { getWorkerDeployments, listR2Objects } from './cloudflare'

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

export class MyMCP extends McpAgent<Env, unknown, GitHubProps> {
  server = new McpServer({
    name: 'GitHub Ops MCP Server',
    version: '1.5.0',
  })

  private octokit(): Octokit {
    if (!this.props?.accessToken) {
      throw new Error('Not authenticated: missing GitHub access token in session props')
    }
    return new Octokit({ auth: this.props.accessToken })
  }

  /**
   * Resolve owner+repo: use provided values, or fall back to the default repo
   * stored in KV. Throws a clear error if neither is available.
   */
  private async resolveRepo(
    owner: string | undefined,
    repo: string | undefined
  ): Promise<{ owner: string; repo: string }> {
    if (owner && repo) return { owner, repo }

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

    // -------------------------------------------------------------------------
    // Memory: notes (stored in OAUTH_KV)
    // -------------------------------------------------------------------------

    this.server.registerTool(
      'set_note',
      {
        description:
          'Save a persistent note in KV storage. Notes survive across sessions and can be ' +
          'read back with get_note or list_notes. Useful for tracking TODOs, reminders, ' +
          'or context per repo (e.g. "jalurtarotpro: payment system WIP, waiting for QR approval").',
        inputSchema: {
          name: z.string().describe('Short key for the note, e.g. "jalurtarotpro-todo" or "kasirpro-status"'),
          content: z.string().describe('The note content. Can be multi-line.'),
        },
        annotations: { title: 'Set note', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      withErrorHandling(async ({ name, content }) => {
        const key = kvKey.note(props.login, name)
        const value = JSON.stringify({
          content,
          updated_at: new Date().toISOString(),
          actor: props.login,
        })
        await this.env.OAUTH_KV.put(key, value)
        return { content: [{ type: 'text', text: `Note "${name}" saved.` }] }
      })
    )

    this.server.registerTool(
      'get_note',
      {
        description: 'Read a previously saved note by name.',
        inputSchema: {
          name: z.string().describe('Note name, e.g. "jalurtarotpro-todo"'),
        },
        annotations: { title: 'Get note', readOnlyHint: true, openWorldHint: false },
      },
      withErrorHandling(async ({ name }) => {
        const key = kvKey.note(props.login, name)
        const raw = await this.env.OAUTH_KV.get(key)
        if (!raw) {
          return { content: [{ type: 'text', text: `Note "${name}" not found.` }] }
        }
        const { content, updated_at } = JSON.parse(raw)
        return {
          content: [{
            type: 'text',
            text: `Note: ${name}\nUpdated: ${updated_at}\n\n${content}`,
          }],
        }
      })
    )

    this.server.registerTool(
      'list_notes',
      {
        description: 'List all saved notes. Returns names, last updated time, and a preview of each note.',
        inputSchema: {},
        annotations: { title: 'List notes', readOnlyHint: true, openWorldHint: false },
      },
      withErrorHandling(async () => {
        const prefix = kvKey.notePrefix(props.login)
        const listed = await this.env.OAUTH_KV.list({ prefix })

        if (listed.keys.length === 0) {
          return { content: [{ type: 'text', text: 'No notes saved yet. Use set_note to create one.' }] }
        }

        const entries = await Promise.all(
          listed.keys.map(async (k) => {
            const raw = await this.env.OAUTH_KV.get(k.name)
            if (!raw) return null
            const { content, updated_at } = JSON.parse(raw)
            const name = k.name.replace(prefix, '')
            const preview = content.split('\n')[0].slice(0, 80)
            return `📝 ${name}\n   Updated : ${updated_at}\n   Preview : ${preview}${content.length > 80 ? '…' : ''}`
          })
        )

        const text = entries.filter(Boolean).join('\n\n')
        return { content: [{ type: 'text', text: `Notes (${listed.keys.length}):\n\n${text}` }] }
      })
    )

    this.server.registerTool(
      'delete_note',
      {
        description: 'Delete a saved note permanently.',
        inputSchema: {
          name: z.string().describe('Note name to delete'),
        },
        annotations: { title: 'Delete note', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      },
      withErrorHandling(async ({ name }) => {
        const key = kvKey.note(props.login, name)
        await this.env.OAUTH_KV.delete(key)
        return { content: [{ type: 'text', text: `Note "${name}" deleted.` }] }
      })
    )

    // -------------------------------------------------------------------------
    // Memory: default repo (stored in OAUTH_KV)
    // -------------------------------------------------------------------------

    this.server.registerTool(
      'set_default_repo',
      {
        description:
          'Set a default owner/repo so you don\'t have to type it on every tool call. ' +
          'Once set, all tools that accept owner+repo will use this as fallback if not provided.',
        inputSchema: {
          owner: z.string().describe('GitHub username or org, e.g. "harvey-moeid"'),
          repo: z.string().describe('Repository name, e.g. "jalurtarotpro"'),
        },
        annotations: { title: 'Set default repo', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      withErrorHandling(async ({ owner, repo }) => {
        await this.env.OAUTH_KV.put(
          kvKey.defaultRepo(props.login),
          `${owner}/${repo}`,
        )
        return { content: [{ type: 'text', text: `Default repo set to ${owner}/${repo}. Tools that accept owner+repo will now use this as fallback.` }] }
      })
    )

    this.server.registerTool(
      'get_default_repo',
      {
        description: 'Show the currently configured default repo.',
        inputSchema: {},
        annotations: { title: 'Get default repo', readOnlyHint: true, openWorldHint: false },
      },
      withErrorHandling(async () => {
        const stored = await this.env.OAUTH_KV.get(kvKey.defaultRepo(props.login))
        if (!stored) {
          return { content: [{ type: 'text', text: 'No default repo set. Use set_default_repo to configure one.' }] }
        }
        return { content: [{ type: 'text', text: `Default repo: ${stored}` }] }
      })
    )

    // -------------------------------------------------------------------------
    // Read-only: GitHub
    // -------------------------------------------------------------------------

    this.server.registerTool(
      'whoami',
      {
        description: 'Return the GitHub account currently authenticated with this MCP server.',
        annotations: { title: 'Who am I', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async () => ({
        content: [{ type: 'text', text: `Authenticated as ${props.login} (${props.name})` }],
      }))
    )

    this.server.registerTool(
      'list_repositories',
      {
        description: 'List repositories owned by the authenticated user.',
        inputSchema: {
          type: z.enum(['all', 'owner', 'member']).default('owner').describe('Which repos to include'),
          per_page: z.number().min(1).max(50).default(20),
        },
        annotations: { title: 'List repositories', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ type, per_page }) => {
        const { data } = await octokit.rest.repos.listForAuthenticatedUser({ type, per_page, sort: 'updated' })
        const text = data.map((r) => `${r.private ? '🔒' : '🌐'} ${r.full_name} — ${r.html_url}`).join('\n')
        return { content: [{ type: 'text', text: text || 'No repositories found.' }] }
      })
    )

    this.server.registerTool(
      'get_file_contents',
      {
        description: 'Read the contents of a file or list a directory from a GitHub repository.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          path: z.string().describe('Path to the file or directory, e.g. "src/index.ts"'),
          ref: z.string().optional().describe('Branch, tag, or commit SHA. Defaults to the default branch.'),
        },
        annotations: { title: 'Read file or directory', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, path, ref }) => {
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
      })
    )

    this.server.registerTool(
      'list_commits',
      {
        description: 'List recent commits on a branch.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          branch: z.string().optional(),
          per_page: z.number().min(1).max(50).default(10),
        },
        annotations: { title: 'List commits', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, branch, per_page }) => {
        const r = await this.resolveRepo(owner, repo)
        const { data } = await octokit.rest.repos.listCommits({ ...r, sha: branch, per_page })
        const text = data.map((c) => `${c.sha.slice(0, 7)}  ${c.commit.message.split('\n')[0]}`).join('\n')
        return { content: [{ type: 'text', text: text || 'No commits found.' }] }
      })
    )

    this.server.registerTool(
      'list_issues',
      {
        description: 'List issues in a repository.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          state: z.enum(['open', 'closed', 'all']).default('open'),
          per_page: z.number().min(1).max(50).default(20),
        },
        annotations: { title: 'List issues', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, state, per_page }) => {
        const r = await this.resolveRepo(owner, repo)
        const { data } = await octokit.rest.issues.listForRepo({ ...r, state, per_page })
        const issuesOnly = data.filter((i) => !i.pull_request)
        const text = issuesOnly.map((i) => `#${i.number} [${i.state}] ${i.title} — ${i.html_url}`).join('\n')
        return { content: [{ type: 'text', text: text || 'No issues found.' }] }
      })
    )

    this.server.registerTool(
      'list_pull_requests',
      {
        description: 'List pull requests in a repository, optionally filtered by state.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          state: z.enum(['open', 'closed', 'all']).default('open'),
          per_page: z.number().min(1).max(50).default(20),
        },
        annotations: { title: 'List pull requests', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, state, per_page }) => {
        const r = await this.resolveRepo(owner, repo)
        const { data } = await octokit.rest.pulls.list({ ...r, state, per_page })
        if (data.length === 0) return { content: [{ type: 'text', text: 'No pull requests found.' }] }
        const text = data
          .map((pr) => `#${pr.number} [${pr.state}] ${pr.title}\n  ${pr.head.ref} → ${pr.base.ref} | by ${pr.user?.login ?? 'unknown'}\n  ${pr.html_url}`)
          .join('\n\n')
        return { content: [{ type: 'text', text: text }] }
      })
    )

    this.server.registerTool(
      'get_pull_request',
      {
        description: 'Get full details of a single pull request.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          pull_number: z.number().describe('PR number'),
        },
        annotations: { title: 'Get pull request', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, pull_number }) => {
        const r = await this.resolveRepo(owner, repo)
        const { data: pr } = await octokit.rest.pulls.get({ ...r, pull_number })
        const labels = pr.labels.map((l) => l.name).join(', ') || 'none'
        const reviewers = pr.requested_reviewers?.map((rv) => rv.login).join(', ') || 'none'
        const text =
          `PR #${pr.number}: ${pr.title}\n` +
          `State    : ${pr.state}${pr.merged ? ' (merged)' : ''}\n` +
          `Branch   : ${pr.head.ref} → ${pr.base.ref}\n` +
          `Author   : ${pr.user?.login ?? 'unknown'}\n` +
          `Labels   : ${labels}\n` +
          `Reviewers: ${reviewers}\n` +
          `Mergeable: ${pr.mergeable ?? 'unknown'}\n` +
          `URL      : ${pr.html_url}\n` +
          `\n--- Description ---\n${pr.body ?? '(no description)'}\n`
        return { content: [{ type: 'text', text: text }] }
      })
    )

    this.server.registerTool(
      'search_code',
      {
        description: 'Search for a code pattern or filename across one or all repositories.',
        inputSchema: {
          query: z.string().describe('GitHub code search query, e.g. "useState repo:harvey-moeid/jalurtarotpro" or "filename:wrangler.toml"'),
          per_page: z.number().min(1).max(30).default(10),
        },
        annotations: { title: 'Search code', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ query, per_page }) => {
        const { data } = await octokit.rest.search.code({ q: query, per_page, mediaType: { previews: ['text-match'] } } as any)
        if (data.total_count === 0) return { content: [{ type: 'text', text: `No results found for: ${query}` }] }
        const lines = data.items.map((item: any) => {
          const snippet = item.text_matches?.[0]?.fragment?.slice(0, 120).replace(/\n/g, ' ') ?? ''
          return `📄 ${item.repository.full_name} — ${item.path}\n   ${item.html_url}${snippet ? `\n   …${snippet}…` : ''}`
        })
        return { content: [{ type: 'text', text: `Found ${data.total_count} result(s) (showing ${data.items.length}):\n\n` + lines.join('\n\n') }] }
      })
    )

    this.server.registerTool(
      'repo_summary',
      {
        description: 'Quick snapshot of a repo: branch, open PRs, issues, recent commits, workflow status.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          workflow_id: z.string().optional().describe('Workflow filename to check, e.g. "deploy.yml". Omit to skip.'),
        },
        annotations: { title: 'Repo summary', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, workflow_id }) => {
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
          lines.push(`📦 ${d.full_name}`, `   Branch: ${d.default_branch}`, `   Updated: ${d.updated_at}`, '')
        }
        if (prs.status === 'fulfilled') {
          const list = prs.value.data
          lines.push(`🔀 Open PRs (${list.length})`)
          list.length === 0 ? lines.push('   (none)') : list.forEach((pr) => lines.push(`   #${pr.number} ${pr.title}`))
          lines.push('')
        }
        if (issues.status === 'fulfilled') {
          const list = issues.value.data.filter((i) => !i.pull_request)
          lines.push(`🐛 Open Issues (${list.length})`)
          list.length === 0 ? lines.push('   (none)') : list.forEach((i) => lines.push(`   #${i.number} ${i.title}`))
          lines.push('')
        }
        if (commits.status === 'fulfilled') {
          lines.push('📝 Recent Commits')
          commits.value.data.forEach((c) => lines.push(`   ${c.sha.slice(0, 7)}  ${c.commit.message.split('\n')[0]}`))
          lines.push('')
        }
        if (workflow_id && workflowRuns.status === 'fulfilled' && workflowRuns.value) {
          const run = (workflowRuns.value as any).data?.workflow_runs?.[0]
          if (run) {
            const icon = run.conclusion === 'success' ? '✅' : run.status === 'in_progress' ? '⏳' : '❌'
            lines.push(`${icon} Workflow: ${workflow_id}`, `   ${run.status}${run.conclusion ? `/${run.conclusion}` : ''} — Run #${run.run_number}`, `   ${run.html_url}`)
          }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      })
    )

    this.server.registerTool(
      'get_audit_log',
      {
        description: 'Query the D1 audit log of all write/destructive tool calls made through this MCP server.',
        inputSchema: {
          limit: z.number().min(1).max(100).default(20),
          actor: z.string().optional(),
          tool: z.string().optional(),
          errors_only: z.boolean().default(false),
        },
        annotations: { title: 'Get audit log', readOnlyHint: true, openWorldHint: false },
      },
      withErrorHandling(async ({ limit, actor, tool, errors_only }) => {
        const conditions: string[] = []
        const bindings: (string | number)[] = []
        if (actor) { conditions.push('actor = ?'); bindings.push(actor) }
        if (tool) { conditions.push('tool = ?'); bindings.push(tool) }
        if (errors_only) { conditions.push('is_error = 1') }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const sql = `SELECT id, actor, tool, summary, is_error, created_at FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`
        bindings.push(limit)
        const result = await this.env.AUDIT_DB.prepare(sql).bind(...bindings).all()
        if (!result.results || result.results.length === 0) {
          return { content: [{ type: 'text', text: 'No audit log entries found.' }] }
        }
        const rows = result.results as Array<{ id: number; actor: string; tool: string; summary: string; is_error: number; created_at: string }>
        const text = rows.map((row) => `${row.is_error ? '❌' : '✅'} [${row.created_at}] ${row.actor} — ${row.tool}\n   ${row.summary}`).join('\n\n')
        return { content: [{ type: 'text', text: `Audit log (${rows.length} entries):\n\n${text}` }] }
      })
    )

    // ── NEW: list_branches ─────────────────────────────────────────────────
    this.server.registerTool(
      'list_branches',
      {
        description: 'List branches in a repository. Shows branch name and latest commit SHA.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          per_page: z.number().min(1).max(100).default(30),
          protected_only: z.boolean().default(false).describe('If true, only show protected branches'),
        },
        annotations: { title: 'List branches', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, per_page, protected_only }) => {
        const r = await this.resolveRepo(owner, repo)
        const { data } = await octokit.rest.repos.listBranches({ ...r, per_page, protected: protected_only || undefined })
        if (data.length === 0) return { content: [{ type: 'text', text: 'No branches found.' }] }
        const text = data
          .map((b) => `${b.protected ? '🔒' : '🌿'} ${b.name.padEnd(40)} ${b.commit.sha.slice(0, 7)}`)
          .join('\n')
        return { content: [{ type: 'text', text: `Branches in ${r.owner}/${r.repo} (${data.length}):\n\n${text}` }] }
      })
    )

    // ── NEW: delete_branch ─────────────────────────────────────────────────
    this.server.registerTool(
      'delete_branch',
      {
        description:
          'Delete a branch from a repository. Protected branches (main, master) are blocked by the guardrail. ' +
          'Typically called after a PR has been merged to clean up stale feature branches.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          branch: z.string().describe('Branch name to delete, e.g. "feat/old-feature"'),
        },
        annotations: { title: 'Delete branch', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      writeTool(
        'delete_branch',
        ({ branch }) => `Deleted branch "${branch}"`,
        async ({ owner, repo, branch }) => {
          const r = await this.resolveRepo(owner, repo)

          // Reuse the same protected-branch guardrail as push/delete file
          const protectedBranches = (this.env.PROTECTED_BRANCHES ?? 'main,master')
            .split(',')
            .map((b) => b.trim().toLowerCase())
          if (protectedBranches.includes(branch.toLowerCase())) {
            return {
              content: [{ type: 'text', text: `Branch "${branch}" is protected and cannot be deleted.` }],
              isError: true,
            }
          }

          await octokit.rest.git.deleteRef({ owner: r.owner, repo: r.repo, ref: `heads/${branch}` })
          return { content: [{ type: 'text', text: `Deleted branch "${branch}" from ${r.owner}/${r.repo}.` }] }
        }
      )
    )

    // -------------------------------------------------------------------------
    // Write tools
    // -------------------------------------------------------------------------

    this.server.registerTool(
      'create_repository',
      {
        description: 'Create a new GitHub repository owned by the authenticated user.',
        inputSchema: {
          name: z.string(),
          description: z.string().optional(),
          private: z.boolean().default(true),
        },
        annotations: { title: 'Create repository', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      writeTool(
        'create_repository',
        ({ name }) => `Created repository "${name}"`,
        async ({ name, description, private: isPrivate }) => {
          const { data } = await octokit.rest.repos.createForAuthenticatedUser({ name, description, private: isPrivate })
          return { content: [{ type: 'text', text: `Created repository: ${data.html_url}` }] }
        }
      )
    )

    this.server.registerTool(
      'create_branch',
      {
        description: 'Create a new branch from an existing branch.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          branch: z.string().describe('Name of the new branch'),
          from_branch: z.string().default('main'),
        },
        annotations: { title: 'Create branch', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      writeTool(
        'create_branch',
        ({ branch, from_branch }) => `Created branch "${branch}" from "${from_branch}"`,
        async ({ owner, repo, branch, from_branch }) => {
          const r = await this.resolveRepo(owner, repo)
          const { data: ref } = await octokit.rest.git.getRef({ ...r, ref: `heads/${from_branch}` })
          await octokit.rest.git.createRef({ ...r, ref: `refs/heads/${branch}`, sha: ref.object.sha })
          return { content: [{ type: 'text', text: `Created branch "${branch}" from "${from_branch}" in ${r.owner}/${r.repo}` }] }
        }
      )
    )

    this.server.registerTool(
      'push_files',
      {
        description: 'Create or update one or more files in a single commit.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          branch: z.string().default('main'),
          message: z.string(),
          files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
        },
        annotations: { title: 'Push files (commit)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      writeTool(
        'push_files',
        ({ files }) => `Pushed ${files.length} file(s)`,
        async ({ owner, repo, branch, message, files }) => {
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
        }
      )
    )

    this.server.registerTool(
      'create_pull_request',
      {
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
      },
      writeTool(
        'create_pull_request',
        ({ head, base }) => `Opened PR "${head}" → "${base}"`,
        async ({ owner, repo, title, head, base, body }) => {
          const r = await this.resolveRepo(owner, repo)
          const { data } = await octokit.rest.pulls.create({ ...r, title, head, base, body })
          return { content: [{ type: 'text', text: `Opened pull request: ${data.html_url}` }] }
        }
      )
    )

    this.server.registerTool(
      'create_issue',
      {
        description: 'Create a new issue in a repository.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          title: z.string(),
          body: z.string().optional(),
          labels: z.array(z.string()).optional(),
        },
        annotations: { title: 'Create issue', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      writeTool(
        'create_issue',
        ({ title }) => `Created issue "${title}"`,
        async ({ owner, repo, title, body, labels }) => {
          const r = await this.resolveRepo(owner, repo)
          const { data } = await octokit.rest.issues.create({ ...r, title, body, labels })
          return { content: [{ type: 'text', text: `Created issue #${data.number}: ${data.html_url}` }] }
        }
      )
    )

    // -------------------------------------------------------------------------
    // Destructive tools
    // -------------------------------------------------------------------------

    this.server.registerTool(
      'delete_file',
      {
        description: 'Delete a file from a repository.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          path: z.string(),
          branch: z.string().default('main'),
          message: z.string(),
        },
        annotations: { title: 'Delete file', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      writeTool(
        'delete_file',
        ({ path, branch }) => `Deleted "${path}" from @${branch}`,
        async ({ owner, repo, path, branch, message }) => {
          const r = await this.resolveRepo(owner, repo)
          assertBranchWritable(this.env, branch)
          const { data: existing } = await octokit.rest.repos.getContent({ ...r, path, ref: branch })
          if (Array.isArray(existing) || !('sha' in existing)) {
            return { content: [{ type: 'text', text: `"${path}" is not a single file.` }], isError: true }
          }
          await octokit.rest.repos.deleteFile({ ...r, path, message, sha: existing.sha, branch })
          return { content: [{ type: 'text', text: `Deleted "${path}" from ${r.owner}/${r.repo}@${branch}` }] }
        }
      )
    )

    this.server.registerTool(
      'merge_pull_request',
      {
        description: 'Merge an open pull request.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          pull_number: z.number(),
          merge_method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
          commit_title: z.string().optional(),
        },
        annotations: { title: 'Merge pull request', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      writeTool(
        'merge_pull_request',
        ({ pull_number }) => `Merged PR #${pull_number}`,
        async ({ owner, repo, pull_number, merge_method, commit_title }) => {
          const r = await this.resolveRepo(owner, repo)
          const { data } = await octokit.rest.pulls.merge({ ...r, pull_number, merge_method, commit_title })
          return { content: [{ type: 'text', text: data.merged ? `Merged PR #${pull_number}: ${data.sha}` : `Not merged: ${data.message}` }] }
        }
      )
    )

    // -------------------------------------------------------------------------
    // Combo tools
    // -------------------------------------------------------------------------

    this.server.registerTool(
      'rename_file',
      {
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
      },
      writeTool(
        'rename_file',
        ({ old_path, new_path }) => `Renamed "${old_path}" → "${new_path}"`,
        async ({ owner, repo, old_path, new_path, branch, message }) => {
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
            ...r,
            base_tree: baseCommit.tree.sha,
            tree: [
              { path: new_path, mode: '100644', type: 'blob', sha: blob.sha },
              { path: old_path, mode: '100644', type: 'blob', sha: null as any },
            ],
          })
          const { data: commit } = await octokit.rest.git.createCommit({
            ...r, message: message ?? `rename: ${old_path} → ${new_path}`, tree: tree.sha, parents: [baseSha],
          })
          await octokit.rest.git.updateRef({ ...r, ref: `heads/${branch}`, sha: commit.sha })
          return { content: [{ type: 'text', text: `Renamed "${old_path}" → "${new_path}" in ${r.owner}/${r.repo}@${branch}\nCommit: ${commit.html_url}` }] }
        }
      )
    )

    this.server.registerTool(
      'scaffold_repository',
      {
        description: 'Create a new repository and seed it with files in one call.',
        inputSchema: {
          name: z.string(),
          description: z.string().optional(),
          private: z.boolean().default(true),
          files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
        },
        annotations: { title: 'Scaffold repository', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      writeTool(
        'scaffold_repository',
        ({ name }) => `Scaffolded repository "${name}"`,
        async ({ name, description, private: isPrivate, files }) => {
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
        }
      )
    )

    this.server.registerTool(
      'trigger_workflow',
      {
        description: 'Trigger a GitHub Actions workflow via workflow_dispatch.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          workflow_id: z.string(),
          ref: z.string().default('main'),
          inputs: z.record(z.string(), z.string()).optional(),
        },
        annotations: { title: 'Trigger workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      writeTool(
        'trigger_workflow',
        ({ workflow_id, ref }) => `Triggered "${workflow_id}" on "${ref}"`,
        async ({ owner, repo, workflow_id, ref, inputs }) => {
          const r = await this.resolveRepo(owner, repo)
          await octokit.rest.actions.createWorkflowDispatch({ ...r, workflow_id, ref, inputs })
          return { content: [{ type: 'text', text: `Triggered "${workflow_id}" on ${r.owner}/${r.repo}@${ref}.` }] }
        }
      )
    )

    this.server.registerTool(
      'get_workflow_runs',
      {
        description: 'List recent runs of a GitHub Actions workflow.',
        inputSchema: {
          owner: z.string().optional(),
          repo: z.string().optional(),
          workflow_id: z.string(),
          per_page: z.number().min(1).max(20).default(5),
        },
        annotations: { title: 'Get workflow runs', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ owner, repo, workflow_id, per_page }) => {
        const r = await this.resolveRepo(owner, repo)
        const { data } = await octokit.rest.actions.listWorkflowRuns({ ...r, workflow_id, per_page })
        const text = data.workflow_runs
          .map((run) => `#${run.run_number}  ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}  ${run.head_branch}  ${run.html_url}`)
          .join('\n')
        return { content: [{ type: 'text', text: text || 'No workflow runs found.' }] }
      })
    )

    this.server.registerTool(
      'wait_for_workflow',
      {
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
      },
      withErrorHandling(async ({ owner, repo, workflow_id, ref, timeout_seconds, poll_interval_seconds }) => {
        const r = await this.resolveRepo(owner, repo)
        const started = Date.now()
        await sleep(5000)
        while (Date.now() - started < timeout_seconds * 1000) {
          const { data } = await octokit.rest.actions.listWorkflowRuns({ ...r, workflow_id, branch: ref, per_page: 1 })
          const run = data.workflow_runs[0]
          if (!run) return { content: [{ type: 'text', text: `No runs found for "${workflow_id}" on "${ref}".` }], isError: true }
          const elapsed = Math.round((Date.now() - started) / 1000)
          if (run.status === 'completed') {
            const icon = run.conclusion === 'success' ? '✅' : '❌'
            return {
              content: [{ type: 'text', text: `${icon} "${workflow_id}" completed in ~${elapsed}s\n${run.status}/${run.conclusion ?? 'unknown'} — Run #${run.run_number}\n${run.html_url}` }],
              isError: run.conclusion !== 'success',
            }
          }
          await sleep(poll_interval_seconds * 1000)
        }
        return { content: [{ type: 'text', text: `⏱ Timed out after ${timeout_seconds}s.` }], isError: true }
      })
    )

    this.server.registerTool(
      'deploy_and_push',
      {
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
      },
      writeTool(
        'deploy_and_push',
        ({ workflow_id }) => `Pushed and triggered "${workflow_id}"`,
        async ({ owner, repo, branch, message, files, workflow_id }) => {
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
        }
      )
    )

    this.server.registerTool(
      'get_worker_deployment_status',
      {
        description: 'Check the current deployment status of a Cloudflare Worker.',
        inputSchema: { script_name: z.string().default('github-mcp-server') },
        annotations: { title: 'Get Worker deployment status', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ script_name }) => {
        const { deployments } = await getWorkerDeployments(this.env, script_name)
        if (deployments.length === 0) return { content: [{ type: 'text', text: `No deployments found for "${script_name}".` }] }
        const latest = deployments[0]
        const versionLines = (latest.versions ?? [])
          .map((v) => `  - ${v.version_id}${v.percentage != null ? ` (${v.percentage}%)` : ''}${v.tag ? ` [${v.tag}]` : ''}`)
          .join('\n')
        const text =
          `Worker      : ${script_name}\n` +
          `Deployed at : ${latest.created_on ?? 'unknown'}\n` +
          `Strategy    : ${latest.strategy ?? 'unknown'}\n` +
          `By          : ${latest.author_email ?? 'unknown'}\n` +
          (versionLines ? `Versions:\n${versionLines}\n` : '') +
          `\n(${deployments.length} deployment(s) on record)`
        return { content: [{ type: 'text', text }] }
      })
    )

    this.server.registerTool(
      'list_r2_objects',
      {
        description: 'List objects in a Cloudflare R2 bucket. Requires CLOUDFLARE_API_TOKEN (R2:Read) and CLOUDFLARE_ACCOUNT_ID.',
        inputSchema: {
          bucket: z.string(),
          prefix: z.string().optional(),
          limit: z.number().min(1).max(200).default(50),
          cursor: z.string().optional(),
        },
        annotations: { title: 'List R2 objects', readOnlyHint: true, openWorldHint: true },
      },
      withErrorHandling(async ({ bucket, prefix, limit, cursor }) => {
        const result = await listR2Objects(this.env, bucket, { prefix, limit, cursor })
        if (result.objects.length === 0) return { content: [{ type: 'text', text: `No objects in "${bucket}"${prefix ? ` (prefix: ${prefix})` : ''}.` }] }
        const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`
        const rows = result.objects.map((o) => `${o.key.padEnd(60)} ${fmt(o.size).padStart(10)}  ${o.last_modified}`)
        const header = `R2 Bucket: ${bucket}\nObjects: ${result.objects.length}${result.truncated ? ` (more, cursor: ${result.cursor})` : ''}\n\n${'Key'.padEnd(60)} ${'Size'.padStart(10)}  Last Modified\n${'-'.repeat(85)}\n`
        return { content: [{ type: 'text', text: header + rows.join('\n') }] }
      })
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

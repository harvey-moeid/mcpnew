import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Octokit } from 'octokit'
import { z } from 'zod'
import { withErrorHandling } from './error-handling'
import { withAudit } from './audit-log'
import { assertBranchWritable } from './guardrails'
import { getWorkerDeployments } from './cloudflare'

/**
 * Props injected by the OAuth flow in github-handler.ts once the user has
 * authenticated with GitHub. Available as `this.props` on every tool call —
 * never stored in chat, never typed by the user, encrypted into the access
 * token issued to the MCP client.
 */
export type GitHubProps = {
  login: string
  name: string
  accessToken: string
}

export class MyMCP extends McpAgent<Env, unknown, GitHubProps> {
  server = new McpServer({
    name: 'GitHub Ops MCP Server',
    version: '1.3.0',
  })

  private octokit(): Octokit {
    if (!this.props?.accessToken) {
      throw new Error('Not authenticated: missing GitHub access token in session props')
    }
    return new Octokit({ auth: this.props.accessToken })
  }

  async init() {
    const octokit = this.octokit()
    const props = this.props as GitHubProps
    const audit = this.env.AUDIT_DB

    /** Wrap a write/destructive tool: error handling first, then audit log. */
    const writeTool = <Args>(
      toolName: string,
      summarize: (args: Args, result: import('@modelcontextprotocol/sdk/types.js').CallToolResult) => string,
      handler: (args: Args) => Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>
    ) => withAudit(audit, props.login, toolName, summarize, withErrorHandling(handler))

    // ---------------------------------------------------------------------
    // Read-only tools
    // ---------------------------------------------------------------------

    this.server.registerTool(
      'whoami',
      {
        description: 'Return the GitHub account currently authenticated with this MCP server.',
        annotations: {
          title: 'Who am I',
          readOnlyHint: true,
          openWorldHint: true,
        },
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
          type: z
            .enum(['all', 'owner', 'member'])
            .default('owner')
            .describe('Which repos to include'),
          per_page: z.number().min(1).max(50).default(20),
        },
        annotations: {
          title: 'List repositories',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ type, per_page }) => {
        const { data } = await octokit.rest.repos.listForAuthenticatedUser({
          type,
          per_page,
          sort: 'updated',
        })
        const text = data
          .map((r) => `${r.private ? '🔒' : '🌐'} ${r.full_name} — ${r.html_url}`)
          .join('\n')
        return { content: [{ type: 'text', text: text || 'No repositories found.' }] }
      })
    )

    this.server.registerTool(
      'get_file_contents',
      {
        description: 'Read the contents of a file or list a directory from a GitHub repository.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          path: z.string().describe('Path to the file or directory, e.g. "src/index.ts"'),
          ref: z.string().optional().describe('Branch, tag, or commit SHA. Defaults to the default branch.'),
        },
        annotations: {
          title: 'Read file or directory',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, path, ref }) => {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref })

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
          owner: z.string(),
          repo: z.string(),
          branch: z.string().optional(),
          per_page: z.number().min(1).max(50).default(10),
        },
        annotations: {
          title: 'List commits',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, branch, per_page }) => {
        const { data } = await octokit.rest.repos.listCommits({
          owner,
          repo,
          sha: branch,
          per_page,
        })
        const text = data
          .map((c) => `${c.sha.slice(0, 7)}  ${c.commit.message.split('\n')[0]}`)
          .join('\n')
        return { content: [{ type: 'text', text: text || 'No commits found.' }] }
      })
    )

    this.server.registerTool(
      'list_issues',
      {
        description: 'List issues in a repository.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          state: z.enum(['open', 'closed', 'all']).default('open'),
          per_page: z.number().min(1).max(50).default(20),
        },
        annotations: {
          title: 'List issues',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, state, per_page }) => {
        const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state, per_page })
        const issuesOnly = data.filter((i) => !i.pull_request)
        const text = issuesOnly
          .map((i) => `#${i.number} [${i.state}] ${i.title} — ${i.html_url}`)
          .join('\n')
        return { content: [{ type: 'text', text: text || 'No issues found.' }] }
      })
    )

    // —— NEW: list_pull_requests ————————————————————————————————
    this.server.registerTool(
      'list_pull_requests',
      {
        description: 'List pull requests in a repository, optionally filtered by state.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          state: z.enum(['open', 'closed', 'all']).default('open'),
          per_page: z.number().min(1).max(50).default(20),
        },
        annotations: {
          title: 'List pull requests',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, state, per_page }) => {
        const { data } = await octokit.rest.pulls.list({ owner, repo, state, per_page })
        if (data.length === 0) {
          return { content: [{ type: 'text', text: 'No pull requests found.' }] }
        }
        const text = data
          .map(
            (pr) =>
              `#${pr.number} [${pr.state}] ${pr.title}\n` +
              `  ${pr.head.ref} → ${pr.base.ref} | by ${pr.user?.login ?? 'unknown'}\n` +
              `  ${pr.html_url}`
          )
          .join('\n\n')
        return { content: [{ type: 'text', text: text }] }
      })
    )

    // —— NEW: get_pull_request —————————————————————————————————
    this.server.registerTool(
      'get_pull_request',
      {
        description: 'Get full details of a single pull request including body, labels, reviewers, and merge status.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          pull_number: z.number().describe('PR number'),
        },
        annotations: {
          title: 'Get pull request',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, pull_number }) => {
        const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number })
        const labels = pr.labels.map((l) => l.name).join(', ') || 'none'
        const reviewers = pr.requested_reviewers?.map((r) => r.login).join(', ') || 'none'
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

    // —— NEW: search_code ———————————————————————————————————————
    this.server.registerTool(
      'search_code',
      {
        description:
          'Search for a code pattern or filename across one or all repositories. ' +
          'Uses GitHub code search — returns file paths, repos, and a short snippet.',
        inputSchema: {
          query: z.string().describe(
            'GitHub code search query, e.g. "useState repo:harvey-moeid/jalurtarotpro" ' +
            'or "filename:wrangler.toml" or "PROTECTED_BRANCHES"'
          ),
          per_page: z.number().min(1).max(30).default(10),
        },
        annotations: {
          title: 'Search code',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ query, per_page }) => {
        const { data } = await octokit.rest.search.code({ q: query, per_page })
        if (data.total_count === 0) {
          return { content: [{ type: 'text', text: `No results found for: ${query}` }] }
        }
        const lines = data.items.map((item) => {
          const snippet =
            item.text_matches?.[0]?.fragment?.slice(0, 120).replace(/\n/g, ' ') ?? ''
          return `📄 ${item.repository.full_name} — ${item.path}\n   ${item.html_url}${snippet ? `\n   …${snippet}…` : ''}`
        })
        const header = `Found ${data.total_count} result(s) (showing ${data.items.length}):\n\n`
        return { content: [{ type: 'text', text: header + lines.join('\n\n') }] }
      })
    )

    // —— NEW: wait_for_workflow ———————————————————————————————
    this.server.registerTool(
      'wait_for_workflow',
      {
        description:
          'Poll a GitHub Actions workflow until it completes (or times out), then return ' +
          'the final status. Use this right after trigger_workflow or deploy_and_push to ' +
          'confirm a deploy succeeded without manually calling get_workflow_runs.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          workflow_id: z.string().describe('Workflow filename, e.g. "deploy.yml"'),
          ref: z.string().default('main').describe('Branch the workflow ran on'),
          timeout_seconds: z.number().min(10).max(600).default(180).describe(
            'How long to wait before giving up (default 3 minutes)'
          ),
          poll_interval_seconds: z.number().min(5).max(30).default(10).describe(
            'How often to check status (default every 10 seconds)'
          ),
        },
        annotations: {
          title: 'Wait for workflow',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, workflow_id, ref, timeout_seconds, poll_interval_seconds }) => {
        const started = Date.now()
        const timeoutMs = timeout_seconds * 1000
        const pollMs = poll_interval_seconds * 1000

        // Give GitHub a few seconds to register the new run before first poll
        await sleep(5000)

        while (Date.now() - started < timeoutMs) {
          const { data } = await octokit.rest.actions.listWorkflowRuns({
            owner,
            repo,
            workflow_id,
            branch: ref,
            per_page: 1,
          })

          const run = data.workflow_runs[0]
          if (!run) {
            return {
              content: [{ type: 'text', text: `No workflow runs found for "${workflow_id}" on branch "${ref}".` }],
              isError: true,
            }
          }

          const elapsed = Math.round((Date.now() - started) / 1000)

          if (run.status === 'completed') {
            const icon = run.conclusion === 'success' ? '✅' : '❌'
            return {
              content: [{
                type: 'text',
                text:
                  `${icon} Workflow "${workflow_id}" completed in ~${elapsed}s\n` +
                  `Status     : ${run.status}\n` +
                  `Conclusion : ${run.conclusion ?? 'unknown'}\n` +
                  `Run #${run.run_number} — ${run.html_url}`,
              }],
              isError: run.conclusion !== 'success',
            }
          }

          // Still running — wait and poll again
          await sleep(pollMs)
        }

        return {
          content: [{
            type: 'text',
            text:
              `⏱ Timed out after ${timeout_seconds}s waiting for "${workflow_id}" to complete. ` +
              `Use get_workflow_runs to check status manually.`,
          }],
          isError: true,
        }
      })
    )

    // —— NEW: get_worker_deployment_status (Cloudflare) ——————————————
    this.server.registerTool(
      'get_worker_deployment_status',
      {
        description:
          'Check the current deployment status of a Cloudflare Worker: which version is live, ' +
          'the rollout strategy/percentage (for gradual deployments), and when it was last deployed. ' +
          'Reads directly from the Cloudflare API — separate from GitHub Actions workflow status. ' +
          'Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets to be set on this Worker.',
        inputSchema: {
          script_name: z
            .string()
            .default('github-mcp-server')
            .describe('Name of the Cloudflare Worker script to check, e.g. "github-mcp-server"'),
        },
        annotations: {
          title: 'Get Worker deployment status',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ script_name }) => {
        const { deployments } = await getWorkerDeployments(this.env, script_name)

        if (deployments.length === 0) {
          return {
            content: [{ type: 'text', text: `No deployments found for Worker "${script_name}".` }],
          }
        }

        const latest = deployments[0]
        const versionLines = (latest.versions ?? [])
          .map((v) => {
            const pct = v.percentage != null ? ` (${v.percentage}%)` : ''
            const tag = v.tag ? ` [${v.tag}]` : ''
            const msg = v.message ? `: ${v.message}` : ''
            return `  - ${v.version_id}${pct}${tag}${msg}`
          })
          .join('\n')

        const text =
          `Worker         : ${script_name}\n` +
          `Latest deploy  : ${latest.id}\n` +
          `Strategy       : ${latest.strategy ?? 'unknown'}\n` +
          `Deployed at    : ${latest.created_on ?? 'unknown'}\n` +
          `Triggered by   : ${latest.author_email ?? 'unknown'}\n` +
          `Source         : ${latest.source ?? 'unknown'}\n` +
          (versionLines ? `Versions live  :\n${versionLines}\n` : '') +
          `\n(${deployments.length} deployment(s) on record)`

        return { content: [{ type: 'text', text }] }
      })
    )

    // ---------------------------------------------------------------------
    // Write tools (non-destructive)
    // ---------------------------------------------------------------------

    this.server.registerTool(
      'create_repository',
      {
        description: 'Create a new GitHub repository owned by the authenticated user.',
        inputSchema: {
          name: z.string().describe('Repository name, e.g. "my-app"'),
          description: z.string().optional(),
          private: z.boolean().default(true).describe('Whether the repo should be private'),
        },
        annotations: {
          title: 'Create repository',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'create_repository',
        ({ name }) => `Created repository "${name}"`,
        async ({ name, description, private: isPrivate }) => {
          const { data } = await octokit.rest.repos.createForAuthenticatedUser({
            name,
            description,
            private: isPrivate,
          })
          return { content: [{ type: 'text', text: `Created repository: ${data.html_url}` }] }
        }
      )
    )

    this.server.registerTool(
      'create_branch',
      {
        description: 'Create a new branch from an existing branch.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          branch: z.string().describe('Name of the new branch'),
          from_branch: z.string().default('main').describe('Branch to branch off from'),
        },
        annotations: {
          title: 'Create branch',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'create_branch',
        ({ branch, from_branch }) => `Created branch "${branch}" from "${from_branch}"`,
        async ({ owner, repo, branch, from_branch }) => {
          const { data: ref } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${from_branch}`,
          })
          await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha: ref.object.sha,
          })
          return {
            content: [{ type: 'text', text: `Created branch "${branch}" from "${from_branch}"` }],
          }
        }
      )
    )

    this.server.registerTool(
      'push_files',
      {
        description:
          'Create or update one or more files in a single commit (proper multi-file commit via the Git Data API — not one commit per file).',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          branch: z.string().default('main'),
          message: z.string().describe('Commit message'),
          files: z
            .array(
              z.object({
                path: z.string().describe('File path relative to repo root'),
                content: z.string().describe('Full new file content (UTF-8 text)'),
              })
            )
            .min(1),
        },
        annotations: {
          title: 'Push files (commit)',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'push_files',
        ({ owner, repo, branch, files }) => `Pushed ${files.length} file(s) to ${owner}/${repo}@${branch}`,
        async ({ owner, repo, branch, message, files }) => {
          assertBranchWritable(this.env, branch)

          const { data: refData } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${branch}`,
          })
          const baseSha = refData.object.sha

          const { data: baseCommit } = await octokit.rest.git.getCommit({
            owner,
            repo,
            commit_sha: baseSha,
          })

          const blobs = await Promise.all(
            files.map(async (file) => {
              const { data: blob } = await octokit.rest.git.createBlob({
                owner,
                repo,
                content: file.content,
                encoding: 'utf-8',
              })
              return {
                path: file.path,
                mode: '100644' as const,
                type: 'blob' as const,
                sha: blob.sha,
              }
            })
          )

          const { data: tree } = await octokit.rest.git.createTree({
            owner,
            repo,
            base_tree: baseCommit.tree.sha,
            tree: blobs,
          })

          const { data: commit } = await octokit.rest.git.createCommit({
            owner,
            repo,
            message,
            tree: tree.sha,
            parents: [baseSha],
          })

          await octokit.rest.git.updateRef({
            owner,
            repo,
            ref: `heads/${branch}`,
            sha: commit.sha,
          })

          return {
            content: [
              {
                type: 'text',
                text: `Pushed ${files.length} file(s) to ${owner}/${repo}@${branch}\nCommit: ${commit.html_url}`,
              },
            ],
          }
        }
      )
    )

    this.server.registerTool(
      'create_pull_request',
      {
        description: 'Open a pull request from one branch into another.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          title: z.string(),
          head: z.string().describe('Branch containing the changes'),
          base: z.string().default('main').describe('Branch to merge into'),
          body: z.string().optional(),
        },
        annotations: {
          title: 'Open pull request',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'create_pull_request',
        ({ head, base }) => `Opened PR from "${head}" into "${base}"`,
        async ({ owner, repo, title, head, base, body }) => {
          const { data } = await octokit.rest.pulls.create({ owner, repo, title, head, base, body })
          return { content: [{ type: 'text', text: `Opened pull request: ${data.html_url}` }] }
        }
      )
    )

    this.server.registerTool(
      'create_issue',
      {
        description: 'Create a new issue in a repository.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          title: z.string(),
          body: z.string().optional(),
          labels: z.array(z.string()).optional(),
        },
        annotations: {
          title: 'Create issue',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'create_issue',
        ({ title }) => `Created issue "${title}"`,
        async ({ owner, repo, title, body, labels }) => {
          const { data } = await octokit.rest.issues.create({ owner, repo, title, body, labels })
          return { content: [{ type: 'text', text: `Created issue #${data.number}: ${data.html_url}` }] }
        }
      )
    )

    // ---------------------------------------------------------------------
    // Destructive / high-impact tools
    // ---------------------------------------------------------------------

    this.server.registerTool(
      'delete_file',
      {
        description: 'Delete a file from a repository. This is destructive and cannot be undone from here.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          path: z.string(),
          branch: z.string().default('main'),
          message: z.string().describe('Commit message for the deletion'),
        },
        annotations: {
          title: 'Delete file',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      writeTool(
        'delete_file',
        ({ owner, repo, path, branch }) => `Deleted "${path}" from ${owner}/${repo}@${branch}`,
        async ({ owner, repo, path, branch, message }) => {
          assertBranchWritable(this.env, branch)

          const { data: existing } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch })
          if (Array.isArray(existing) || !('sha' in existing)) {
            return {
              content: [{ type: 'text', text: `"${path}" is not a single file; nothing was deleted.` }],
              isError: true,
            }
          }

          await octokit.rest.repos.deleteFile({
            owner,
            repo,
            path,
            message,
            sha: existing.sha,
            branch,
          })

          return { content: [{ type: 'text', text: `Deleted "${path}" from ${owner}/${repo}@${branch}` }] }
        }
      )
    )

    this.server.registerTool(
      'merge_pull_request',
      {
        description: 'Merge an open pull request. This is destructive (rewrites branch history) and cannot be undone from here.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          pull_number: z.number(),
          merge_method: z.enum(['merge', 'squash', 'rebase']).default('squash'),
          commit_title: z.string().optional(),
        },
        annotations: {
          title: 'Merge pull request',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      writeTool(
        'merge_pull_request',
        ({ owner, repo, pull_number }) => `Merged PR #${pull_number} in ${owner}/${repo}`,
        async ({ owner, repo, pull_number, merge_method, commit_title }) => {
          const { data } = await octokit.rest.pulls.merge({
            owner,
            repo,
            pull_number,
            merge_method,
            commit_title,
          })
          return {
            content: [
              {
                type: 'text',
                text: data.merged
                  ? `Merged PR #${pull_number}: ${data.sha}`
                  : `PR #${pull_number} was not merged: ${data.message}`,
              },
            ],
          }
        }
      )
    )

    // ---------------------------------------------------------------------
    // Combo / differentiator tools
    // ---------------------------------------------------------------------

    this.server.registerTool(
      'scaffold_repository',
      {
        description:
          'Create a new repository and, in the same call, seed it with an initial set of files in one commit. Saves a create_repository + push_files round trip.',
        inputSchema: {
          name: z.string(),
          description: z.string().optional(),
          private: z.boolean().default(true),
          files: z
            .array(z.object({ path: z.string(), content: z.string() }))
            .optional()
            .describe('Optional extra files to seed beyond the auto-generated README'),
        },
        annotations: {
          title: 'Scaffold repository',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'scaffold_repository',
        ({ name }) => `Scaffolded repository "${name}"`,
        async ({ name, description, private: isPrivate, files }) => {
          const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
            name,
            description,
            private: isPrivate,
            auto_init: true,
          })

          if (!files || files.length === 0) {
            return { content: [{ type: 'text', text: `Created repository: ${repo.html_url}` }] }
          }

          const { data: refData } = await octokit.rest.git.getRef({
            owner: repo.owner.login,
            repo: repo.name,
            ref: `heads/${repo.default_branch}`,
          })
          const { data: baseCommit } = await octokit.rest.git.getCommit({
            owner: repo.owner.login,
            repo: repo.name,
            commit_sha: refData.object.sha,
          })
          const blobs = await Promise.all(
            files.map(async (file) => {
              const { data: blob } = await octokit.rest.git.createBlob({
                owner: repo.owner.login,
                repo: repo.name,
                content: file.content,
                encoding: 'utf-8',
              })
              return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
            })
          )
          const { data: tree } = await octokit.rest.git.createTree({
            owner: repo.owner.login,
            repo: repo.name,
            base_tree: baseCommit.tree.sha,
            tree: blobs,
          })
          const { data: commit } = await octokit.rest.git.createCommit({
            owner: repo.owner.login,
            repo: repo.name,
            message: 'Initial scaffold',
            tree: tree.sha,
            parents: [refData.object.sha],
          })
          await octokit.rest.git.updateRef({
            owner: repo.owner.login,
            repo: repo.name,
            ref: `heads/${repo.default_branch}`,
            sha: commit.sha,
          })

          return {
            content: [
              {
                type: 'text',
                text: `Created and scaffolded repository: ${repo.html_url} (${files.length} extra file(s) added)`,
              },
            ],
          }
        }
      )
    )

    this.server.registerTool(
      'trigger_workflow',
      {
        description:
          'Trigger a GitHub Actions workflow via workflow_dispatch (e.g. to kick off a deploy). The workflow file must have a `workflow_dispatch:` trigger defined.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          workflow_id: z.string().describe('Workflow filename, e.g. "deploy-production.yml"'),
          ref: z.string().default('main').describe('Branch or tag to run the workflow on'),
          inputs: z.record(z.string(), z.string()).optional().describe('Workflow input parameters, if any'),
        },
        annotations: {
          title: 'Trigger workflow',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'trigger_workflow',
        ({ workflow_id, ref }) => `Triggered workflow "${workflow_id}" on "${ref}"`,
        async ({ owner, repo, workflow_id, ref, inputs }) => {
          await octokit.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id, ref, inputs })
          return {
            content: [
              { type: 'text', text: `Triggered "${workflow_id}" on ${owner}/${repo}@${ref}. Use wait_for_workflow to check status.` },
            ],
          }
        }
      )
    )

    this.server.registerTool(
      'get_workflow_runs',
      {
        description: 'List recent runs of a GitHub Actions workflow and their status (queued/in_progress/completed, success/failure).',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          workflow_id: z.string().describe('Workflow filename, e.g. "deploy-production.yml"'),
          per_page: z.number().min(1).max(20).default(5),
        },
        annotations: {
          title: 'Get workflow runs',
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      withErrorHandling(async ({ owner, repo, workflow_id, per_page }) => {
        const { data } = await octokit.rest.actions.listWorkflowRuns({ owner, repo, workflow_id, per_page })
        const text = data.workflow_runs
          .map(
            (run) =>
              `#${run.run_number}  ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}  ${run.head_branch}  ${run.html_url}`
          )
          .join('\n')
        return { content: [{ type: 'text', text: text || 'No workflow runs found.' }] }
      })
    )

    this.server.registerTool(
      'deploy_and_push',
      {
        description:
          'Convenience tool: push files in a single commit AND trigger a deploy workflow immediately after, in one call. Equivalent to calling push_files then trigger_workflow.',
        inputSchema: {
          owner: z.string(),
          repo: z.string(),
          branch: z.string().default('main'),
          message: z.string(),
          files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
          workflow_id: z.string().describe('Deploy workflow filename, e.g. "deploy-production.yml"'),
        },
        annotations: {
          title: 'Push and deploy',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      writeTool(
        'deploy_and_push',
        ({ owner, repo, branch, workflow_id }) => `Pushed to ${owner}/${repo}@${branch} and triggered "${workflow_id}"`,
        async ({ owner, repo, branch, message, files, workflow_id }) => {
          assertBranchWritable(this.env, branch)

          const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })
          const { data: baseCommit } = await octokit.rest.git.getCommit({
            owner,
            repo,
            commit_sha: refData.object.sha,
          })
          const blobs = await Promise.all(
            files.map(async (file) => {
              const { data: blob } = await octokit.rest.git.createBlob({
                owner,
                repo,
                content: file.content,
                encoding: 'utf-8',
              })
              return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
            })
          )
          const { data: tree } = await octokit.rest.git.createTree({
            owner,
            repo,
            base_tree: baseCommit.tree.sha,
            tree: blobs,
          })
          const { data: commit } = await octokit.rest.git.createCommit({
            owner,
            repo,
            message,
            tree: tree.sha,
            parents: [refData.object.sha],
          })
          await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha })

          await octokit.rest.actions.createWorkflowDispatch({
            owner,
            repo,
            workflow_id,
            ref: branch,
          })

          return {
            content: [
              {
                type: 'text',
                text: `Pushed ${files.length} file(s) to ${owner}/${repo}@${branch} (${commit.html_url}) and triggered "${workflow_id}". Use wait_for_workflow to check status.`,
              },
            ],
          }
        }
      )
    )
  }
}

/** Promisified sleep — used by wait_for_workflow polling loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

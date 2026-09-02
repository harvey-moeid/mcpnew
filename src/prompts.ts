/**
 * MCP Prompts: canned interaction templates the user (or a client's "prompts"
 * UI) invokes explicitly — as opposed to tools, which Claude decides to call
 * on its own. Each function below returns the plain-text instructions that
 * get injected as a user message when the prompt is invoked. The prompt
 * itself performs no actions; it just tells Claude which existing tools to
 * call and in what order, so everything it triggers still goes through the
 * normal guardrails, error handling, and audit log.
 */

export function releaseChecklistPrompt(params: {
  owner: string
  repo: string
  branch: string
  workflow_id?: string
  smoke_test_url?: string
}): string {
  const { owner, repo, branch, workflow_id, smoke_test_url } = params
  const lines = [
    `Run a release checklist for ${owner}/${repo} on branch "${branch}".`,
    '',
    '1. Call repo_summary to get the current state (open PRs, issues, recent commits).',
    workflow_id
      ? `2. Call get_workflow_runs for workflow "${workflow_id}" and confirm the latest run on "${branch}" succeeded.`
      : '2. Call get_workflow_runs for the relevant deploy workflow and confirm the latest run succeeded.',
    smoke_test_url
      ? `3. Call smoke_test on "${smoke_test_url}" and confirm it returns the expected status.`
      : '3. Call smoke_test against the production URL and confirm it returns the expected status.',
    '4. Call get_worker_deployment_status (if this is a Cloudflare Worker) and confirm the latest deployment matches the branch you just checked.',
    '5. Summarize: is this release healthy and ready, or are there any red flags? List anything that failed or looks off, and call out anything you could not verify.',
  ]
  return lines.join('\n')
}

export function prReviewPrompt(params: {
  owner: string
  repo: string
  pull_number: number
}): string {
  const { owner, repo, pull_number } = params
  return [
    `Review pull request #${pull_number} in ${owner}/${repo}.`,
    '',
    '1. Call get_pull_request to read the title, description, branch, and mergeability.',
    '2. Call get_file_contents on any files you need more context on (use the PR head branch as ref).',
    '3. Call get_workflow_runs (or wait_for_workflow if CI is still running) to check CI status on the head branch.',
    '4. If this repo uses preview deployments, call get_pr_preview_url and consider spot-checking it with smoke_test.',
    '5. Give a structured review: summary of the change, any risks or missing tests, CI/preview status, and a clear recommendation (approve / request changes / needs discussion). Do not call merge_pull_request unless explicitly asked to.',
  ].join('\n')
}

export function repoCleanupPrompt(params: { owner: string; repo: string }): string {
  const { owner, repo } = params
  return [
    `Clean up stale branches in ${owner}/${repo}.`,
    '',
    '1. Call list_branches to get every branch.',
    '2. Call list_commits on the default branch (usually "main") and on each other branch.',
    "3. A branch is safe to delete only if its tip commit already appears in the default branch's history (fully merged), or if list_pull_requests shows its PR was merged.",
    '4. Do NOT delete protected branches (delete_branch already blocks this) and do NOT delete a branch just because it looks old — only delete branches you have concretely confirmed are merged.',
    "5. If a branch's work looks superseded (reimplemented differently on the default branch) rather than literally merged, flag it and ask before deleting — do not assume.",
    '6. List what you deleted and why, and list anything you left alone and why.',
  ].join('\n')
}

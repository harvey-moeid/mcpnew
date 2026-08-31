/**
 * Blocks direct writes (push_files / delete_file) to protected branches like
 * "main", unless explicitly allowed via env config. Encourages the proper
 * flow: create_branch -> push_files -> create_pull_request -> merge_pull_request.
 */
export function assertBranchWritable(env: Env, branch: string): void {
  const allowDirect = env.ALLOW_DIRECT_PUSH_TO_PROTECTED === 'true'
  if (allowDirect) return

  const protectedBranches = (env.PROTECTED_BRANCHES ?? 'main,master')
    .split(',')
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean)

  if (protectedBranches.includes(branch.toLowerCase())) {
    throw new Error(
      `Direct writes to protected branch "${branch}" are blocked by this server's guardrail. ` +
        `Use create_branch to make a feature branch, push_files there, then create_pull_request ` +
        `and merge_pull_request instead. (To disable this guardrail, set ALLOW_DIRECT_PUSH_TO_PROTECTED=true ` +
        `in wrangler.toml — not recommended for shared repos.)`
    )
  }
}

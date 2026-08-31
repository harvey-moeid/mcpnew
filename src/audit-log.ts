import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Wraps a (already error-handled) tool handler so every call is recorded in
 * the `audit_log` D1 table — who did what, when, and whether it errored.
 * Logging failures never break the tool call itself (best-effort).
 */
export function withAudit<Args>(
  db: D1Database,
  actor: string,
  toolName: string,
  summarize: (args: Args, result: CallToolResult) => string,
  handler: (args: Args) => Promise<CallToolResult>
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    const result = await handler(args)

    try {
      await db
        .prepare(
          'INSERT INTO audit_log (actor, tool, summary, is_error) VALUES (?, ?, ?, ?)'
        )
        .bind(actor, toolName, summarize(args, result), result.isError ? 1 : 0)
        .run()
    } catch {
      // Never let audit logging failures surface to the model/user —
      // the underlying action already succeeded or failed on its own merits.
    }

    return result
  }
}

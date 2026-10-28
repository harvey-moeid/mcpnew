export async function recordFileEvent(env: Env, actor: string, action: string, summary: string, failed = false) {
  try {
    await env.AUDIT_DB.prepare('INSERT INTO audit_log (actor, tool, summary, is_error) VALUES (?, ?, ?, ?)')
      .bind(actor, action, summary, failed ? 1 : 0).run()
  } catch { /* Best effort; never change the outcome of an already completed storage operation. */ }
}

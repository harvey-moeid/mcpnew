export function requireConfirmation(actual: unknown, expected: string): void {
  if (actual !== expected) throw new Error(`Confirmation required: pass confirm exactly as "${expected}".`)
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export type WorkflowRun = {
  id: number; head_sha: string; event: string; status: string | null
  conclusion: string | null; html_url: string; created_at: string
}

export async function waitForRun(
  list: () => Promise<WorkflowRun[]>,
  options: { runId?: number; sha?: string; after?: number; timeoutMs: number; intervalMs: number },
): Promise<WorkflowRun> {
  if (!options.runId && !options.sha) throw new Error('Provide run_id or commit_sha to avoid observing an unrelated workflow run.')
  const deadline = Date.now() + options.timeoutMs
  let selectedId = options.runId
  while (Date.now() < deadline) {
    const runs = await list()
    const run = runs.find(run => selectedId ? run.id === selectedId :
      run.head_sha === options.sha && run.event === 'workflow_dispatch' &&
      (options.after === undefined || Date.parse(run.created_at) >= options.after - 1000))
    if (run) {
      selectedId = run.id
      if (run.status === 'completed') return run
    }
    await sleep(Math.min(options.intervalMs, Math.max(0, deadline - Date.now())))
  }
  throw new Error(`Timed out waiting for workflow ${selectedId ? `run ${selectedId}` : `at commit ${options.sha}`}. The workflow may still be running; no rollback was performed.`)
}

export async function probeUrl(options: {
  url: string; expectedStatus: number; expectedText?: string; timeoutMs: number; attempts: number; delayMs: number
}) {
  const history: Array<{ attempt: number; elapsed_ms: number; status?: number; ok: boolean; error?: string }> = []
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const started = Date.now()
    let response: Response | undefined
    try {
      response = await fetch(options.url, { signal: AbortSignal.timeout(options.timeoutMs), redirect: 'follow' })
      let matches = options.expectedText === undefined
      if (!matches && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let text = '', bytes = 0
        try {
          while (bytes < 1024 * 1024) {
            const chunk = await reader.read()
            if (chunk.done) { text += decoder.decode(); break }
            const bounded = chunk.value.subarray(0, 1024 * 1024 - bytes)
            bytes += bounded.byteLength
            text += decoder.decode(bounded, { stream: true })
            if (text.includes(options.expectedText!)) break
          }
          matches = text.includes(options.expectedText!)
        } finally { await reader.cancel() }
      } else { await response.body?.cancel() }
      const ok = response.status === options.expectedStatus && matches
      history.push({ attempt, elapsed_ms: Date.now() - started, status: response.status, ok,
        ...(!matches ? { error: 'Expected text was not found within the first 1 MiB.' } : {}) })
      if (ok) return { ok: true, url: options.url, attempts: history }
    } catch {
      history.push({ attempt, elapsed_ms: Date.now() - started, ok: false, error: 'Request failed or timed out.' })
    }
    if (attempt < options.attempts) await sleep(options.delayMs)
  }
  return { ok: false, url: options.url, attempts: history }
}

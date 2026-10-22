/**
 * Minimal "get online" helpers used by fetch_url and web_search tools.
 *
 * fetch_url: plain GET + lightweight HTML-to-text extraction, no external API needed.
 * web_search: Brave Search API, read via env.BRAVE_API_KEY.
 *   Set with `wrangler secret put BRAVE_API_KEY` (free tier: https://brave.com/search/api/).
 */

export class WebFetchError extends Error {}
export class WebSearchError extends Error {}

const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_MAX_LENGTH = 8000
const MAX_MAX_LENGTH = 30000
const MAX_RESPONSE_BYTES = 1024 * 1024

/** Read at most 1 MiB of decoded response bytes, including for chunked bodies.
 * The abort listener also cancels a body that stalls after receiving headers.
 */
async function readBodyPrefix(response: Response, signal: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  signal.throwIfAborted()
  if (!response.body) return { text: '', truncated: false }
  const reader = response.body.getReader()
  const buffer = new Uint8Array(MAX_RESPONSE_BYTES)
  let bytes = 0
  let truncated = false
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await Promise.race([reader.read(), aborted])
      signal.throwIfAborted()
      if (chunk.done) break
      const remaining = MAX_RESPONSE_BYTES - bytes
      const bounded = chunk.value.subarray(0, remaining)
      buffer.set(bounded, bytes)
      bytes += bounded.byteLength
      if (chunk.value.byteLength > remaining) { truncated = true; break }
    }
    return { text: new TextDecoder().decode(buffer.subarray(0, bytes)), truncated }
  } finally {
    signal.removeEventListener('abort', onAbort)
    // An upstream cancel hook can stall too: request cancellation without waiting
    // on it, and handle its rejection so cleanup cannot delay a timeout result.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// ---------------------------------------------------------------------------
// fetch_url
// ---------------------------------------------------------------------------

export type FetchUrlResult = {
  url: string
  finalUrl: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}

/**
 * GET a URL and return readable text. For HTML responses, tags/scripts/styles
 * are stripped and entities decoded; other content types are returned as-is.
 * Reads at most 1 MiB, with timeout covering headers and body. Output is also
 * capped at maxLength characters; truncated is true when either limit is hit.
 */
export async function fetchUrl(
  url: string,
  opts: { maxLength?: number; timeoutMs?: number } = {}
): Promise<FetchUrlResult> {
  const maxLength = Math.min(opts.maxLength ?? DEFAULT_MAX_LENGTH, MAX_MAX_LENGTH)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'github-ops-fetch/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      },
    })
    const contentType = res.headers.get('content-type') ?? 'unknown'
    const body = await readBodyPrefix(res, controller.signal)
    const isHtml = contentType.includes('text/html') || contentType.includes('xhtml')
    const extracted = isHtml ? htmlToText(body.text) : body.text
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      contentType,
      text: extracted.slice(0, maxLength).trim(),
      truncated: body.truncated || extracted.length > maxLength,
    }
  } catch (err: unknown) {
    const msg = controller.signal.aborted ? `Timed out after ${timeoutMs}ms`
      : err instanceof Error ? err.message : String(err)
    throw new WebFetchError(`Failed to fetch "${url}": ${msg}`)
  } finally {
    clearTimeout(timer)
  }
}

const BLOCK_TAG_RE = /<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>|<br\s*\/?>/gi
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
}

function htmlToText(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, ' ')
    .replace(BLOCK_TAG_RE, '\n')
    .replace(/<[^>]+>/g, ' ')

  out = out.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&mdash;|&ndash;/g, (m) => ENTITIES[m] ?? m)
  out = out.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))

  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------------------------------------------------------------------
// web_search
// ---------------------------------------------------------------------------

export type WebSearchResultItem = {
  title: string
  url: string
  description: string
}

/**
 * Query the Brave Search API and return normalized web results.
 * Requires env.BRAVE_API_KEY to be set (`wrangler secret put BRAVE_API_KEY`).
 * Supports an optional timeoutMs to abort slow/hung requests (default 15s).
 */
export async function webSearch(
  env: Env,
  query: string,
  count: number,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<WebSearchResultItem[]> {
  if (!env.BRAVE_API_KEY) {
    throw new WebSearchError(
      'Web search not configured on this Worker: set BRAVE_API_KEY secret with ' +
        '`wrangler secret put BRAVE_API_KEY` (free tier: https://brave.com/search/api/).'
    )
  }

  const params = new URLSearchParams({ q: query, count: String(count) })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': env.BRAVE_API_KEY,
      },
      signal: controller.signal,
    })
    const body = await readBodyPrefix(res, controller.signal)
    if (!res.ok) {
      throw new WebSearchError(`Brave Search API error (${res.status}): ${body.text.slice(0, 200) || res.statusText}`)
    }
    if (body.truncated) throw new WebSearchError('Brave Search response exceeds the 1 MiB limit.')
    const json = JSON.parse(body.text)
    const results = json?.web?.results ?? []
    return results.map((r: { title?: string; url?: string; description?: string }) => ({
      title: r.title ?? '(untitled)',
      url: r.url ?? '',
      description: String(r.description ?? '').replace(/<[^>]+>/g, ''),
    }))
  } catch (err: unknown) {
    if (err instanceof WebSearchError) throw err
    const msg = controller.signal.aborted ? `Timed out after ${timeoutMs}ms`
      : err instanceof Error ? err.message : String(err)
    throw new WebSearchError(`Brave Search request failed: ${msg}`)
  } finally {
    clearTimeout(timer)
  }
}

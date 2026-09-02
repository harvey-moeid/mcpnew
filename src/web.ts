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
 * Result is capped at maxLength characters (truncated flag set if cut off).
 */
export async function fetchUrl(
  url: string,
  opts: { maxLength?: number; timeoutMs?: number } = {}
): Promise<FetchUrlResult> {
  const maxLength = Math.min(opts.maxLength ?? DEFAULT_MAX_LENGTH, MAX_MAX_LENGTH)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'mcpnew-fetch/1.0 (+https://mcpnew.muidsoft.com)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      },
    })
  } catch (err: any) {
    clearTimeout(timer)
    const msg = err?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : String(err?.message ?? err)
    throw new WebFetchError(`Failed to fetch "${url}": ${msg}`)
  }
  clearTimeout(timer)

  const contentType = res.headers.get('content-type') ?? 'unknown'
  const raw = await res.text()

  const isHtml = contentType.includes('text/html') || contentType.includes('xhtml')
  const extracted = isHtml ? htmlToText(raw) : raw

  const truncated = extracted.length > maxLength
  const text = (truncated ? extracted.slice(0, maxLength) : extracted).trim()

  return {
    url,
    finalUrl: res.url || url,
    status: res.status,
    contentType,
    text,
    truncated,
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
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
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

  let res: Response
  try {
    res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': env.BRAVE_API_KEY,
      },
      signal: controller.signal,
    })
  } catch (err: any) {
    clearTimeout(timer)
    const msg = err?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : String(err?.message ?? err)
    throw new WebSearchError(`Brave Search request failed: ${msg}`)
  }
  clearTimeout(timer)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new WebSearchError(`Brave Search API error (${res.status}): ${body.slice(0, 200) || res.statusText}`)
  }

  const json = (await res.json()) as any
  const results = json?.web?.results ?? []
  return results.map((r: any) => ({
    title: r.title ?? '(untitled)',
    url: r.url ?? '',
    description: String(r.description ?? '').replace(/<[^>]+>/g, ''),
  }))
}

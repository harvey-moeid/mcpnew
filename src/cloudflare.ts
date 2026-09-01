/**
 * Minimal Cloudflare API client used by Cloudflare-related tools.
 *
 * Auth: a scoped Cloudflare API Token (never the legacy Global API Key),
 * read via env.CLOUDFLARE_API_TOKEN. Secrets must be set with
 * `wrangler secret put CLOUDFLARE_API_TOKEN` and
 * `wrangler secret put CLOUDFLARE_ACCOUNT_ID`.
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

export class CloudflareApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CloudflareApiError'
    this.status = status
  }
}

type CloudflareResponse<T> = {
  success: boolean
  result: T
  errors: Array<{ code: number; message: string }>
}

async function cfFetch<T>(env: Env, path: string, options?: RequestInit): Promise<T> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Cloudflare API not configured on this Worker: set CLOUDFLARE_API_TOKEN and ' +
        'CLOUDFLARE_ACCOUNT_ID secrets with `wrangler secret put`.'
    )
  }

  const res = await fetch(`${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })

  let json: CloudflareResponse<T>
  try {
    json = await res.json()
  } catch {
    throw new CloudflareApiError(`Cloudflare returned a non-JSON response (${res.status})`, res.status)
  }

  if (!res.ok || !json.success) {
    const message =
      json.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ') ||
      res.statusText ||
      'Unknown Cloudflare error'
    throw new CloudflareApiError(message, res.status)
  }

  return json.result
}

// ---------------------------------------------------------------------------
// Workers: deployments
// ---------------------------------------------------------------------------

export type WorkerDeploymentVersion = {
  version_id: string
  percentage?: number
  tag?: string
  message?: string
}

export type WorkerDeployment = {
  id: string
  strategy?: string
  source?: string
  created_on?: string
  author_email?: string
  versions?: WorkerDeploymentVersion[]
}

/**
 * GET /accounts/:account_id/workers/scripts/:script_name/deployments
 *
 * Response shape has varied across API revisions, so normalized defensively.
 */
export async function getWorkerDeployments(
  env: Env,
  scriptName: string
): Promise<{ deployments: WorkerDeployment[] }> {
  const result = await cfFetch<any>(env, `/workers/scripts/${scriptName}/deployments`)
  const deployments: WorkerDeployment[] = Array.isArray(result)
    ? result
    : result?.deployments ?? result?.items ?? []
  return { deployments }
}

// ---------------------------------------------------------------------------
// R2: list objects
// ---------------------------------------------------------------------------

export type R2Object = {
  key: string
  size: number
  last_modified: string
  etag?: string
  storage_class?: string
}

export type R2ListResult = {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
}

/**
 * GET /accounts/:account_id/r2/buckets/:bucket_name/objects
 *
 * Lists objects in an R2 bucket via the Cloudflare API.
 * Requires "R2:Read" permission on the API token.
 */
export async function listR2Objects(
  env: Env,
  bucketName: string,
  opts: { prefix?: string; limit?: number; cursor?: string } = {}
): Promise<R2ListResult> {
  const params = new URLSearchParams()
  if (opts.prefix) params.set('prefix', opts.prefix)
  if (opts.limit) params.set('per_page', String(opts.limit))
  if (opts.cursor) params.set('cursor', opts.cursor)

  const qs = params.toString() ? `?${params.toString()}` : ''
  const result = await cfFetch<any>(env, `/r2/buckets/${bucketName}/objects${qs}`)

  // Normalize response shape defensively
  const objects: R2Object[] = (result?.objects ?? result?.items ?? result ?? []).map((o: any) => ({
    key: o.key ?? o.name ?? '',
    size: o.size ?? 0,
    last_modified: o.uploaded ?? o.last_modified ?? '',
    etag: o.etag,
    storage_class: o.storage_class,
  }))

  return {
    objects,
    truncated: result?.truncated ?? false,
    cursor: result?.cursor,
  }
}

// ---------------------------------------------------------------------------
// R2: get object content
// ---------------------------------------------------------------------------

export type R2GetResult = {
  content: string
  contentType: string
  size: number
}

/**
 * GET /accounts/:account_id/r2/buckets/:bucket_name/objects/:key
 *
 * Downloads an object's content from R2. Returns raw text.
 * For binary files the content may appear garbled — use for text/JSON files.
 * Requires "R2:Read" permission on the API token.
 */
export async function getR2Object(
  env: Env,
  bucketName: string,
  key: string,
): Promise<R2GetResult> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Cloudflare API not configured: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets.'
    )
  }
  const url =
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}` +
    `/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  })

  if (!res.ok) {
    throw new CloudflareApiError(
      `Failed to get "${key}" from bucket "${bucketName}": ${res.statusText}`,
      res.status,
    )
  }

  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  const content = await res.text()
  return { content, contentType, size: content.length }
}

// ---------------------------------------------------------------------------
// R2: put object
// ---------------------------------------------------------------------------

/**
 * PUT /accounts/:account_id/r2/buckets/:bucket_name/objects/:key
 *
 * Uploads text content to R2. Overwrites if the key already exists.
 * Requires "R2:Write" permission on the API token.
 */
export async function putR2Object(
  env: Env,
  bucketName: string,
  key: string,
  content: string,
  contentType = 'text/plain; charset=utf-8',
): Promise<void> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Cloudflare API not configured: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets.'
    )
  }
  const url =
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}` +
    `/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': contentType,
    },
    body: content,
  })

  if (!res.ok) {
    let message = res.statusText
    try {
      const json = (await res.json()) as CloudflareResponse<null>
      if (json.errors?.length) {
        message = json.errors.map((e) => `[${e.code}] ${e.message}`).join('; ')
      }
    } catch { /* ignore parse errors */ }
    throw new CloudflareApiError(
      `Failed to put "${key}" into bucket "${bucketName}": ${message}`,
      res.status,
    )
  }
}

// ---------------------------------------------------------------------------
// R2: delete object
// ---------------------------------------------------------------------------

/**
 * DELETE /accounts/:account_id/r2/buckets/:bucket_name/objects/:key
 *
 * Deletes a single object from R2.
 * Requires "R2:Write" permission on the API token.
 */
export async function deleteR2Object(
  env: Env,
  bucketName: string,
  key: string,
): Promise<void> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Cloudflare API not configured: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets.'
    )
  }
  const url =
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}` +
    `/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  })

  if (!res.ok) {
    throw new CloudflareApiError(
      `Failed to delete "${key}" from bucket "${bucketName}": ${res.statusText}`,
      res.status,
    )
  }
}

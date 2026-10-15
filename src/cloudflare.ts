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
    signal: options?.signal ?? AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
// Shared: zone-level fetch (no account prefix — used by DNS / Zone tools)
// ---------------------------------------------------------------------------

async function cfFetchZone<T>(env: Env, path: string, options?: RequestInit): Promise<T> {
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      'Cloudflare API not configured: set CLOUDFLARE_API_TOKEN secret with `wrangler secret put`.'
    )
  }
  const res = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers ?? {}),
    },
  })
  let json: CloudflareResponse<T>
  try {
    json = await res.json()
  } catch {
    throw new CloudflareApiError(`Cloudflare returned non-JSON (${res.status})`, res.status)
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
  return { content, contentType, size: new TextEncoder().encode(content).length }
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

// ---------------------------------------------------------------------------
// KV Namespaces
// ---------------------------------------------------------------------------

export type KVNamespaceInfo = {
  id: string
  title: string
  supports_url_encoding?: boolean
}

export async function createKVNamespace(env: Env, title: string): Promise<KVNamespaceInfo> {
  return cfFetch<KVNamespaceInfo>(env, '/storage/kv/namespaces', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export async function listKVNamespaces(env: Env, page = 1, perPage = 100): Promise<KVNamespaceInfo[]> {
  return cfFetch<KVNamespaceInfo[]>(env, `/storage/kv/namespaces?page=${page}&per_page=${perPage}`)
}

export async function deleteKVNamespace(env: Env, namespaceId: string): Promise<void> {
  await cfFetch<null>(env, `/storage/kv/namespaces/${namespaceId}`, { method: 'DELETE' })
}

export async function kvPut(
  env: Env,
  namespaceId: string,
  key: string,
  value: string,
  opts: { expiration?: number; expiration_ttl?: number } = {},
): Promise<void> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare API not configured.')
  }
  const params = new URLSearchParams()
  if (opts.expiration) params.set('expiration', String(opts.expiration))
  if (opts.expiration_ttl) params.set('expiration_ttl', String(opts.expiration_ttl))
  const qs = params.toString() ? `?${params.toString()}` : ''

  const res = await fetch(
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}${qs}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: value,
    },
  )
  if (!res.ok) {
    throw new CloudflareApiError(`KV put failed for key "${key}": ${res.statusText}`, res.status)
  }
}

export async function kvGet(env: Env, namespaceId: string, key: string): Promise<string | null> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare API not configured.')
  }
  const res = await fetch(
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new CloudflareApiError(`KV get failed for key "${key}": ${res.statusText}`, res.status)
  return res.text()
}

export async function kvDelete(env: Env, namespaceId: string, key: string): Promise<void> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare API not configured.')
  }
  const res = await fetch(
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    },
  )
  if (!res.ok) {
    throw new CloudflareApiError(`KV delete failed for key "${key}": ${res.statusText}`, res.status)
  }
}

export type KVKey = {
  name: string
  expiration?: number
  metadata?: Record<string, unknown>
}

export async function kvListKeys(
  env: Env,
  namespaceId: string,
  opts: { prefix?: string; limit?: number; cursor?: string } = {},
): Promise<{ keys: KVKey[]; cursor?: string; list_complete: boolean }> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare API not configured.')
  }
  const params = new URLSearchParams()
  if (opts.prefix) params.set('prefix', opts.prefix)
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.cursor) params.set('cursor', opts.cursor)
  const qs = params.toString() ? `?${params.toString()}` : ''

  const res = await fetch(
    `${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/keys${qs}`,
    {
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    },
  )
  type ListResult = CloudflareResponse<KVKey[]> & { result_info?: { cursor?: string; count?: number } }
  const json = (await res.json()) as ListResult
  if (!res.ok || !json.success) {
    const msg = json.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ') || res.statusText
    throw new CloudflareApiError(msg, res.status)
  }
  return {
    keys: json.result ?? [],
    cursor: json.result_info?.cursor,
    list_complete: !json.result_info?.cursor,
  }
}

// ---------------------------------------------------------------------------
// D1 Databases
// ---------------------------------------------------------------------------

export type D1DatabaseInfo = {
  uuid: string
  name: string
  version?: string
  num_tables?: number
  file_size?: number
  created_at?: string
}

export async function createD1Database(env: Env, name: string, location?: string): Promise<D1DatabaseInfo> {
  const body: Record<string, string> = { name }
  if (location) body.primary_location_hint = location
  return cfFetch<D1DatabaseInfo>(env, '/d1/database', { method: 'POST', body: JSON.stringify(body) })
}

export async function listD1Databases(env: Env, page = 1, perPage = 100): Promise<D1DatabaseInfo[]> {
  const result = await cfFetch<any>(env, `/d1/database?page=${page}&per_page=${perPage}`)
  return Array.isArray(result) ? result : result?.databases ?? []
}

export async function deleteD1Database(env: Env, databaseId: string): Promise<void> {
  await cfFetch<null>(env, `/d1/database/${databaseId}`, { method: 'DELETE' })
}

export type D1QueryResult = {
  results: Record<string, unknown>[]
  success: boolean
  meta: {
    changed_db?: boolean
    changes?: number
    duration?: number
    last_row_id?: number
    rows_read?: number
    rows_written?: number
    size_after?: number
  }
}

export async function d1Query(
  env: Env,
  databaseId: string,
  sql: string,
  params: unknown[] = [],
): Promise<D1QueryResult[]> {
  return cfFetch<D1QueryResult[]>(env, `/d1/database/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql, params }),
  })
}

/**
 * Export schema (and optionally data) from a D1 database via sqlite_master.
 * More reliable than the polling-based REST export API.
 */
export async function d1Export(
  env: Env,
  databaseId: string,
  opts: { includeData?: boolean } = {},
): Promise<{ schema: string; tables: string[]; data?: Record<string, Record<string, unknown>[]> }> {
  const schemaResult = await d1Query(
    env,
    databaseId,
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  const rows = (schemaResult[0]?.results ?? []) as Array<{ name: string; sql: string }>
  const tables = rows.map((r) => r.name)
  const schema =
    rows
      .map((r) => r.sql)
      .filter(Boolean)
      .join(';\n\n') + (rows.length > 0 ? ';' : '-- (no tables)')

  if (!opts.includeData || tables.length === 0) return { schema, tables }

  const data: Record<string, Record<string, unknown>[]> = {}
  for (const tableName of tables) {
    const dataResult = await d1Query(env, databaseId, `SELECT * FROM "${tableName}" LIMIT 500`)
    data[tableName] = (dataResult[0]?.results ?? []) as Record<string, unknown>[]
  }
  return { schema, tables, data }
}

// ---------------------------------------------------------------------------
// Workers management (scripts)
// ---------------------------------------------------------------------------

export type WorkerScriptInfo = {
  id: string
  etag?: string
  handlers?: string[]
  modified_on?: string
  created_on?: string
  usage_model?: string
}

export async function listWorkers(env: Env): Promise<WorkerScriptInfo[]> {
  const result = await cfFetch<any>(env, '/workers/scripts')
  return Array.isArray(result) ? result : result?.workers ?? result?.scripts ?? []
}

export async function workerDetails(env: Env, scriptName: string) {
  const script = encodeURIComponent(scriptName)
  const results = await Promise.allSettled([
    cfFetch<{ bindings?: Array<{ name: string; type: string }> }>(env, `/workers/scripts/${script}/settings`),
    cfFetch<{ schedules?: Array<{ cron: string }> }>(env, `/workers/scripts/${script}/schedules`),
    getWorkerDeployments(env, script),
    cfFetch<Array<{ hostname: string }>>(env, `/workers/domains?service=${script}`),
  ])
  const [settings, schedules, deployments, domains] = results
  return {
    script_name: scriptName,
    // Whitelist metadata: settings can contain plaintext environment variables.
    bindings: settings.status === 'fulfilled' ? settings.value.bindings?.map(b => ({ name: b.name, type: b.type })) ?? [] : undefined,
    crons: schedules.status === 'fulfilled' ? schedules.value.schedules?.map(s => s.cron) ?? [] : undefined,
    latest_deployment: deployments.status === 'fulfilled' ? deployments.value.deployments[0] : undefined,
    domains: domains.status === 'fulfilled' && Array.isArray(domains.value) ? domains.value.map(d => d.hostname) : undefined,
    unavailable: results.flatMap((r, i) => r.status === 'rejected' ? [['bindings', 'crons', 'deployments', 'domains'][i]] : []),
  }
}

export async function deleteWorker(env: Env, scriptName: string): Promise<void> {
  await cfFetch<null>(env, `/workers/scripts/${scriptName}`, { method: 'DELETE' })
}

export type WorkerSecret = { name: string; type: string }

export async function workerSecretPut(
  env: Env,
  scriptName: string,
  secretName: string,
  secretValue: string,
): Promise<WorkerSecret> {
  return cfFetch<WorkerSecret>(env, `/workers/scripts/${scriptName}/secrets`, {
    method: 'PUT',
    body: JSON.stringify({ name: secretName, text: secretValue, type: 'secret_text' }),
  })
}

export async function workerSecretList(env: Env, scriptName: string): Promise<WorkerSecret[]> {
  return cfFetch<WorkerSecret[]>(env, `/workers/scripts/${scriptName}/secrets`)
}

export async function workerSecretDelete(
  env: Env,
  scriptName: string,
  secretName: string,
): Promise<void> {
  await cfFetch<null>(env, `/workers/scripts/${scriptName}/secrets/${secretName}`, { method: 'DELETE' })
}

export async function getWorkerSubdomain(env: Env): Promise<string | null> {
  const result = await cfFetch<any>(env, '/workers/subdomain')
  return typeof result === 'string' ? result : result?.subdomain ?? null
}

// ---------------------------------------------------------------------------
// R2 Bucket management
// ---------------------------------------------------------------------------

export type R2BucketInfo = {
  name: string
  creation_date?: string
  location?: string
  storage_class?: string
}

export async function createR2Bucket(
  env: Env,
  name: string,
  opts: { locationHint?: string; storageClass?: string } = {},
): Promise<R2BucketInfo> {
  const body: Record<string, string> = { name }
  if (opts.locationHint) body.locationHint = opts.locationHint
  if (opts.storageClass) body.storageClass = opts.storageClass
  return cfFetch<R2BucketInfo>(env, '/r2/buckets', { method: 'POST', body: JSON.stringify(body) })
}

export async function listR2Buckets(env: Env, startAfter?: string, perPage = 100): Promise<R2BucketInfo[]> {
  const result = await cfFetch<any>(env, `/r2/buckets?order=name&direction=asc&per_page=${perPage}${startAfter ? '&start_after=' + encodeURIComponent(startAfter) : ''}`)
  return Array.isArray(result) ? result : result?.buckets ?? []
}

export async function deleteR2Bucket(env: Env, name: string): Promise<void> {
  await cfFetch<null>(env, `/r2/buckets/${name}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Pages Projects & Deployments
// ---------------------------------------------------------------------------

export type PagesProjectInfo = {
  id?: string
  name: string
  subdomain?: string
  domains?: string[]
  latest_deployment?: {
    id?: string
    created_on?: string
    url?: string
    environment?: string
    latest_stage?: { name?: string; status?: string; ended_on?: string }
    deployment_trigger?: {
      type?: string
      metadata?: { branch?: string; commit_hash?: string; commit_message?: string }
    }
  }
}

export async function listPagesProjects(env: Env, page = 1, perPage = 10): Promise<PagesProjectInfo[]> {
  return cfFetch<PagesProjectInfo[]>(env, `/pages/projects?page=${page}&per_page=${perPage}`)
}

export async function getPagesProject(env: Env, projectName: string): Promise<PagesProjectInfo> {
  return cfFetch<PagesProjectInfo>(env, `/pages/projects/${projectName}`)
}

export type PagesDeploymentInfo = {
  id: string
  created_on: string
  modified_on?: string
  url?: string
  environment?: string
  aliases?: string[] | null
  latest_stage?: { name?: string; status?: string; ended_on?: string }
  deployment_trigger?: {
    type?: string
    metadata?: { branch?: string; commit_hash?: string; commit_message?: string }
  }
}

export async function listPagesDeployments(
  env: Env,
  projectName: string,
  limit = 10,
  page = 1,
): Promise<PagesDeploymentInfo[]> {
  return cfFetch<PagesDeploymentInfo[]>(
    env,
    `/pages/projects/${projectName}/deployments?page=${page}&per_page=${limit}`,
  )
}

export async function triggerPagesDeployment(
  env: Env,
  projectName: string,
  branch?: string,
): Promise<PagesDeploymentInfo> {
  const form = new FormData()
  if (branch) form.set('branch', branch)
  return cfFetch<PagesDeploymentInfo>(env, `/pages/projects/${projectName}/deployments`, {
    method: 'POST',
    body: form,
  })
}

// ---------------------------------------------------------------------------
// DNS Records & Zones
// ---------------------------------------------------------------------------

export type ZoneInfo = {
  id: string
  name: string
  status: string
  paused?: boolean
  type?: string
  name_servers?: string[]
  plan?: { name?: string }
}

export async function listZones(env: Env, page = 1, perPage = 50): Promise<ZoneInfo[]> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare API not configured.')
  }
  return cfFetchZone<ZoneInfo[]>(env, `/zones?account.id=${env.CLOUDFLARE_ACCOUNT_ID}&page=${page}&per_page=${perPage}`)
}

export type DnsRecord = {
  id: string
  type: string
  name: string
  content: string
  proxiable?: boolean
  proxied?: boolean
  ttl?: number
  locked?: boolean
  created_on?: string
  modified_on?: string
  comment?: string
}

export async function listDnsRecords(
  env: Env,
  zoneId: string,
  opts: { type?: string; name?: string; page?: number; perPage?: number } = {},
): Promise<DnsRecord[]> {
  const params = new URLSearchParams({ page: String(opts.page ?? 1), per_page: String(opts.perPage ?? 100) })
  if (opts.type) params.set('type', opts.type)
  if (opts.name) params.set('name', opts.name)
  return cfFetchZone<DnsRecord[]>(env, `/zones/${zoneId}/dns_records?${params}`)
}

export async function createDnsRecord(
  env: Env,
  zoneId: string,
  record: {
    type: string
    name: string
    content: string
    ttl?: number
    proxied?: boolean
    comment?: string
  },
): Promise<DnsRecord> {
  return cfFetchZone<DnsRecord>(env, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(record),
  })
}

export async function updateDnsRecord(
  env: Env,
  zoneId: string,
  recordId: string,
  record: {
    type?: string
    name?: string
    content?: string
    ttl?: number
    proxied?: boolean
    comment?: string
  },
): Promise<DnsRecord> {
  return cfFetchZone<DnsRecord>(env, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify(record),
  })
}

export async function deleteDnsRecord(env: Env, zoneId: string, recordId: string): Promise<void> {
  await cfFetchZone<{ id: string }>(env, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Analytics (Cloudflare GraphQL Analytics API)
// ---------------------------------------------------------------------------

const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

async function cfGraphQL(env: Env, query: string): Promise<unknown> {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare API not configured.')
  const res = await fetch(CF_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const json = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new CloudflareApiError(json.errors.map((e) => e.message).join('; '), res.status)
  }
  return json.data
}

export type WorkerAnalyticsRow = {
  datetime: string
  requests: number
  errors: number
  subrequests: number
}

export async function getWorkerAnalytics(
  env: Env,
  scriptName: string,
  days = 7,
): Promise<WorkerAnalyticsRow[]> {
  const now = new Date()
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const query = `{
    viewer {
      accounts(filter: { accountTag: "${env.CLOUDFLARE_ACCOUNT_ID}" }) {
        workersInvocationsAdaptive(
          limit: 5000
          filter: {
            scriptName: "${scriptName}"
            datetimeHour_geq: "${since.toISOString()}"
            datetimeHour_leq: "${now.toISOString()}"
          }
          orderBy: [datetimeHour_ASC]
        ) {
          sum { requests errors subrequests }
          dimensions { datetimeHour }
        }
      }
    }
  }`

  const data = (await cfGraphQL(env, query)) as any
  const rows = data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []
  return rows.map((r: any) => ({
    datetime: r.dimensions?.datetimeHour ?? '',
    requests: r.sum?.requests ?? 0,
    errors: r.sum?.errors ?? 0,
    subrequests: r.sum?.subrequests ?? 0,
  }))
}

export type PagesAnalyticsRow = {
  date: string
  pageviews: number
}

export async function getPagesAnalytics(
  env: Env,
  projectName: string,
  days = 7,
): Promise<PagesAnalyticsRow[]> {
  const now = new Date()
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const dateStart = since.toISOString().split('T')[0]
  const dateEnd = now.toISOString().split('T')[0]

  const query = `{
    viewer {
      accounts(filter: { accountTag: "${env.CLOUDFLARE_ACCOUNT_ID}" }) {
        pagesProjectsAdaptiveGroups(
          limit: 100
          filter: {
            projectName: "${projectName}"
            date_geq: "${dateStart}"
            date_leq: "${dateEnd}"
          }
          orderBy: [date_ASC]
        ) {
          sum { pageviews }
          dimensions { date }
        }
      }
    }
  }`

  const data = (await cfGraphQL(env, query)) as any
  const rows = data?.viewer?.accounts?.[0]?.pagesProjectsAdaptiveGroups ?? []
  return rows.map((r: any) => ({
    date: r.dimensions?.date ?? '',
    pageviews: r.sum?.pageviews ?? 0,
  }))
}


/** Explicit version rollback: does not revert KV/D1 data or other external state. */
export async function rollbackWorker(env: Env, scriptName: string, versionId: string) {
  return cfFetch<WorkerDeployment>(env, `/workers/scripts/${encodeURIComponent(scriptName)}/deployments`, {
    method: 'POST',
    body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }],
      annotations: { 'workers/message': 'Explicit rollback requested through MCP' } }),
  })
}

export async function verifyCloudflareToken(env: Env, kind: 'user' | 'account') {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare token is not configured.')
  if (kind === 'account' && !env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Cloudflare account ID is not configured.')
  const path = kind === 'account' ? `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens/verify` : '/user/tokens/verify'
  const response = await fetch(`${CF_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(15000),
  })
  const data = await response.json<CloudflareResponse<{ status: string; expires_on?: string; not_before?: string }>>()
  if (!response.ok || !data.success) throw new CloudflareApiError('Token verification failed. Check token type, expiry and account scope.', response.status)
  return { status: data.result.status, expires_on: data.result.expires_on, not_before: data.result.not_before,
    permissions: 'Verification does not enumerate granted permissions. Access is checked by each resource API.' }
}

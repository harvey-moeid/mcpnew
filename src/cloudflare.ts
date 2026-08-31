/**
 * Minimal Cloudflare API client used by Cloudflare-related tools (e.g.
 * get_worker_deployment_status).
 *
 * Auth: a scoped Cloudflare API Token (never the legacy Global API Key),
 * read via env.CLOUDFLARE_API_TOKEN. Requires the "Workers Scripts:Read"
 * permission on the account in env.CLOUDFLARE_ACCOUNT_ID.
 *
 * Both secrets must be set directly on this Worker with
 * `wrangler secret put CLOUDFLARE_API_TOKEN` / `wrangler secret put
 * CLOUDFLARE_ACCOUNT_ID` — they are separate from the CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_ACCOUNT_ID GitHub Actions secrets used to *deploy* this Worker
 * in .github/workflows/deploy.yml, though the same token can be reused for
 * both if its scopes cover both use cases.
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

async function cfFetch<T>(env: Env, path: string): Promise<T> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Cloudflare API not configured on this Worker: set CLOUDFLARE_API_TOKEN and ' +
        'CLOUDFLARE_ACCOUNT_ID secrets with `wrangler secret put`.'
    )
  }

  const res = await fetch(`${CF_API_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
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
 * Cloudflare's response shape for this endpoint has varied across API
 * revisions (a bare array vs. `{ deployments: [...] }` vs. `{ items: [...] }`),
 * so the result is normalized defensively into a single `deployments` array,
 * most recent first.
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

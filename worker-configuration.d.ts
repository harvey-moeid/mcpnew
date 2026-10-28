// Minimal ambient Env type. Regenerate with `wrangler types` for full accuracy.
interface Env {
  MCP_OBJECT: DurableObjectNamespace
  OAUTH_KV: KVNamespace
  AUDIT_DB: D1Database
  FILES_BUCKET?: R2Bucket
  FILES_BUCKET_NAME?: string
  MCP_ALLOWED_ORIGINS?: string
  FILE_UPLOAD_ALLOWED_HOSTS?: string
  CLOUDFLARE_ALLOWED_USERS?: string
  OAUTH_PROVIDER: import('@cloudflare/workers-oauth-provider').OAuthHelpers
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  COOKIE_ENCRYPTION_KEY: string
  GITHUB_ALLOWED_USERS: string
  PROTECTED_BRANCHES: string
  ALLOW_DIRECT_PUSH_TO_PROTECTED: string
  // Cloudflare API — used by get_worker_deployment_status and the R2 tools.
  // Requires Workers Scripts:Read + R2:Read/R2:Write permissions.
  // Set via `wrangler secret put CLOUDFLARE_API_TOKEN` and
  //          `wrangler secret put CLOUDFLARE_ACCOUNT_ID`
  CLOUDFLARE_API_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
  // Brave Search API — used by web_search. Optional: fetch_url works without it,
  // web_search returns a clear configuration error if this is unset.
  // Set via `wrangler secret put BRAVE_API_KEY` (free tier: https://brave.com/search/api/)
  BRAVE_API_KEY?: string
}

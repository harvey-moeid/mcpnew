// Minimal ambient Env type. Regenerate with `wrangler types` for full accuracy.
interface Env {
  MCP_OBJECT: DurableObjectNamespace
  OAUTH_KV: KVNamespace
  AUDIT_DB: D1Database
  OAUTH_PROVIDER: import('@cloudflare/workers-oauth-provider').OAuthHelpers
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  COOKIE_ENCRYPTION_KEY: string
  GITHUB_ALLOWED_USERS: string
  PROTECTED_BRANCHES: string
  ALLOW_DIRECT_PUSH_TO_PROTECTED: string
  // Cloudflare API — used by get_worker_deployment_status and list_r2_objects.
  // Requires Workers Scripts:Read + R2:Read permissions.
  // Set via `wrangler secret put CLOUDFLARE_API_TOKEN` and
  //          `wrangler secret put CLOUDFLARE_ACCOUNT_ID`
  CLOUDFLARE_API_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
}

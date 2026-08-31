// Minimal ambient Env type. Regenerate with `wrangler types` for full accuracy
// once real bindings/secrets are configured.
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
  // Used by get_worker_deployment_status (src/cloudflare.ts) to call the
  // Cloudflare API directly. Set via `wrangler secret put`.
  CLOUDFLARE_API_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
}

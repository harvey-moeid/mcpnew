import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { GitHubHandler } from './github-handler'
import { MyMCP } from './mcp-agent'

// Durable Object class must be exported from the entry module so wrangler
// can bind it (see wrangler.toml -> durable_objects.bindings).
export { MyMCP }

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: MyMCP.serve('/mcp'),
  defaultHandler: GitHubHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})

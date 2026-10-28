import { rejectMcpRequest } from './mcp-boundary'
import { purgeExpiredFiles } from './file-management'
import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { GitHubHandler } from './github-handler'
import { MyMCP } from './mcp-agent'
import installation from '../installation.json' with { type: 'json' }

// Durable Object class must be exported from the entry module so wrangler
// can bind it (see wrangler.toml -> durable_objects.bindings).
export { MyMCP }

const provider = new OAuthProvider<Env>({
  apiRoute: '/mcp',
  resourceMetadata: {
    resource: `${installation.publicOrigin}/mcp`,
  },
  apiHandler: MyMCP.serve('/mcp'),
  defaultHandler: GitHubHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})


export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) { return rejectMcpRequest(request, env) ?? provider.fetch(request, env, ctx) },
  async scheduled(_event: ScheduledController, env: Env) { await purgeExpiredFiles(env) },
}

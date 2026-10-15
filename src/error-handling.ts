import { RequestError } from 'octokit'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { CloudflareApiError } from './cloudflare'

/**
 * Wraps a tool handler so any thrown error becomes a clean MCP error result
 * (`isError: true` + human-readable text) instead of crashing the tool call
 * or leaking raw stack traces / HTTP internals to the model.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<CallToolResult>
): (...args: Args) => Promise<CallToolResult> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (err) {
      return { content: [{ type: 'text', text: describeError(err) }], isError: true }
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof RequestError) {
    switch (err.status) {
      case 401:
        return 'GitHub rejected the request: authentication expired or revoked. Reconnect the GitHub Ops connector in Claude settings.'
      case 403:
        return `GitHub denied this action (403): ${extractGithubMessage(err) ?? 'insufficient permissions or rate-limited.'}`
      case 404:
        return `GitHub returned 404 \u2014 the repository, branch, or file does not exist, or you don't have access to it.`
      case 409:
        return `GitHub returned 409 (conflict) \u2014 likely a stale branch reference. Try again after re-reading the latest commit.`
      case 422:
        return `GitHub rejected the request as invalid (422): ${extractGithubMessage(err) ?? 'check the parameters you passed.'}`
      default:
        return `GitHub API error (${err.status}): ${extractGithubMessage(err) ?? err.message}`
    }
  }

  if (err instanceof CloudflareApiError) {
    switch (err.status) {
      case 400:
        return `Cloudflare rejected the parameters (400): ${err.message}. Check resource identifiers, pagination values and request format for this tool.`
      case 429:
        return 'Cloudflare rate limit reached (429). Wait before retrying; avoid repeating write operations blindly.'
      case 401:
        return 'Cloudflare rejected the request (401): CLOUDFLARE_API_TOKEN is missing, invalid, or expired.'
      case 403:
        return `Cloudflare denied this action (403): ${err.message || 'the token lacks the permission or resource scope required by this tool.'}`
      case 404:
        return `Cloudflare returned 404 \u2014 check the resource identifier, account/zone ID, and token resource scope.`
      default:
        return `Cloudflare API error (${err.status}): ${err.message}`
    }
  }

  if (err instanceof Error) {
    return `Error: ${err.message}`
  }

  return 'An unknown error occurred.'
}

function extractGithubMessage(err: RequestError): string | undefined {
  const response = err.response?.data as { message?: string } | undefined
  return response?.message
}

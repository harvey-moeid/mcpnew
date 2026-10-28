import installation from '../installation.json' with { type: 'json' }
import { isAllowedUser } from './dashboard-auth'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
// Keep JSON tool calls small; use a short-lived upload ticket for larger workspace files.
export const MAX_INLINE_BYTES = 1024 * 1024
export const filePrefix = (login: string) => `dashboard-files/${login.toLowerCase()}/`
export const validFileName = (name: string) => name.trim().length > 0 && name !== '.' && name !== '..'
  && !/[\u0000-\u001f\u007f/\\]/.test(name) && new TextEncoder().encode(name).length <= 255
export const fileInfo = (object: R2Object) => ({ key: object.key,
  name: object.customMetadata?.filename ?? object.key.split('/').pop() ?? 'file',
  size: object.size, uploadedAt: object.uploaded.toISOString(),
  contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
  sha256: object.customMetadata?.sha256 ?? null, etag: object.etag ?? null })
export const privateFileLinks = (key: string) => ({
  downloadUrl: `${installation.publicOrigin}/dashboard/api/files/download?key=${encodeURIComponent(key)}`,
  dashboardUrl: `${installation.publicOrigin}/dashboard#files`, requiresLogin: true,
})
export function requireFileAccess(env: Env, login: string): R2Bucket {
  if (!login || !isAllowedUser(login, env.GITHUB_ALLOWED_USERS, true)) throw new Error('File access denied. Reconnect with an allowed GitHub account.')
  if (!env.FILES_BUCKET) throw new Error('File storage is not configured (FILES_BUCKET).')
  return env.FILES_BUCKET
}
export function newFileKey(login: string, name: string): string {
  if (!validFileName(name)) throw new Error('Invalid filename: use at most 255 UTF-8 bytes without folder separators or control characters.')
  return filePrefix(login) + crypto.randomUUID() + '/' + name
}
export function ownedFileKey(login: string, key: string): boolean {
  return key.startsWith(filePrefix(login)) && new TextEncoder().encode(key).length <= 1024
}
export function fileDownload(object: R2ObjectBody): Response {
  const name = object.customMetadata?.filename ?? 'file'
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
  return new Response(object.body, { headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encoded}`,
    'Content-Length': String(object.size), 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}

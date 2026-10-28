import { readFileState } from './file-management'
import { Hono } from 'hono'
import { digest, isAllowedUser } from './dashboard-auth'
import { MAX_FILE_BYTES, newFileKey, privateFileLinks, fileInfo } from './files'
import installation from '../installation.json' with { type: 'json' }

const TICKET_SECONDS = 600
export type UploadTicket = { login: string; key: string; name: string; size: number; expiresAt: number }
export async function createUploadTicket(env: Env, login: string, name: string, size: number) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new Error('File size must be between 0 and 25 MiB.')
  const key = newFileKey(login, name)
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  const ticket: UploadTicket = { login, key, name, size, expiresAt: Date.now() + TICKET_SECONDS * 1000 }
  await env.OAUTH_KV.put('file-upload:' + await digest(token), JSON.stringify(ticket), { expirationTtl: TICKET_SECONDS })
  return { key, uploadUrl: `${installation.publicOrigin}/file-transfers/upload`, uploadToken: token,
    method: 'POST', size, expiresAt: new Date(ticket.expiresAt).toISOString(), ...privateFileLinks(key) }
}

// This endpoint accepts upload-only, short-lived credentials. It never serves file contents.
export const fileTransfers = new Hono<{ Bindings: Env }>()
fileTransfers.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
fileTransfers.onError((_error, c) => c.json({ error: 'File upload failed. Check the file list before retrying.' }, 503))
fileTransfers.post('/upload', async c => {
  const auth = c.req.header('authorization') ?? ''
  if (!/^Bearer [a-f0-9]{64}$/.test(auth)) return c.json({ error: 'An upload ticket is required.' }, 401)
  const ticketKey = 'file-upload:' + await digest(auth.slice(7))
  const raw = await c.env.OAUTH_KV.get(ticketKey)
  const ticket: UploadTicket | null = raw ? JSON.parse(raw) : null
  if (!ticket || ticket.expiresAt <= Date.now() || !isAllowedUser(ticket.login, c.env.GITHUB_ALLOWED_USERS, true)) {
    return c.json({ error: 'Upload ticket expired or revoked.' }, 401)
  }
  if (!c.env.FILES_BUCKET) return c.json({ error: 'File storage is not configured.' }, 503)
  const length = c.req.header('content-length')
  if (!length || !/^\d+$/.test(length)) return c.json({ error: 'Content-Length is required.' }, 411)
  if (Number(length) !== ticket.size || Number(length) > MAX_FILE_BYTES) return c.json({ error: 'File size does not match the upload ticket.' }, 400)
  const state = await readFileState(c.env, ticket.login, ticket.key)
  if (state?.deleted_at != null || state?.purging) return c.json({ error: 'This file has been removed.' }, 409)
  // Conditional create prevents replay from overwriting an existing object, even during KV propagation.
  const object = await c.env.FILES_BUCKET.put(ticket.key, c.req.raw.body, {
    onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { filename: ticket.name },
  })
  if (!object) return c.json({ error: 'This upload has already completed. Check the file list.' }, 409)
  // R2 success is final even if best-effort ticket cleanup/audit is temporarily unavailable.
  try { await c.env.OAUTH_KV.delete(ticketKey) } catch {}
  try {
    await c.env.AUDIT_DB.prepare('INSERT INTO audit_log (actor, tool, summary, is_error) VALUES (?, ?, ?, ?)')
      .bind(ticket.login, 'upload_workspace_file', `Stored file (${object.size} bytes)`, 0).run()
  } catch {}
  return c.json({ file: fileInfo(object), ...privateFileLinks(object.key) }, 201)
})

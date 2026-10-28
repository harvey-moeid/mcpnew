import { assertFileUploadReady, FileActionError } from './file-management'
import { recordFileEvent } from './file-audit'
import { Hono } from 'hono'
import { digest, isAllowedUser } from './dashboard-auth'
import { MAX_FILE_BYTES, newFileKey, privateFileLinks, fileInfo, requireFileAccess } from './files'
import { FileContentError, readFileBytes, storeFileBytes } from './file-content'
import installation from '../installation.json' with { type: 'json' }

const TICKET_SECONDS = 600
export type UploadTicket = { id?: string; login: string; key: string; name: string; size: number; expiresAt: number }
type UploadState = { status: string; key?: string }
export async function createUploadTicket(env: Env, login: string, name: string, size: number) {
  requireFileAccess(env, login)
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new FileContentError('File size must be between 0 and 25 MiB.', 413)
  const key = newFileKey(login, name)
  await assertFileUploadReady(env, login, key)
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  const hash = await digest(token), id = crypto.randomUUID()
  const ticket: UploadTicket = { id, login, key, name, size, expiresAt: Date.now() + TICKET_SECONDS * 1000 }
  try {
    await env.AUDIT_DB.prepare('INSERT INTO file_upload_sessions (id, token_hash, actor, key, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, hash, login.toLowerCase(), key, ticket.expiresAt).run()
    // Bound maintenance; active and recently expired records are kept for status/recovery.
    await env.AUDIT_DB.prepare('DELETE FROM file_upload_sessions WHERE id IN (SELECT id FROM file_upload_sessions WHERE expires_at < ? LIMIT 100)')
      .bind(Date.now() - 86400000).run()
  } catch { throw new Error('Upload sessions are unavailable. Apply D1 migration 0003 before creating uploads.') }
  await env.OAUTH_KV.put('file-upload:' + hash, JSON.stringify(ticket), { expirationTtl: TICKET_SECONDS })
  return { key, uploadId: id, uploadUrl: `${installation.publicOrigin}/file-transfers/upload`, uploadToken: token,
    statusUrl: `${installation.publicOrigin}/file-transfers/status`, cancelUrl: `${installation.publicOrigin}/file-transfers/cancel`,
    method: 'POST', size, expiresAt: new Date(ticket.expiresAt).toISOString(), ...privateFileLinks(key) }
}

export async function cancelUpload(env: Env, login: string, id: string) {
  requireFileAccess(env, login)
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new FileActionError('Upload not found.', 404)
  const row = await env.AUDIT_DB.prepare('SELECT status, key FROM file_upload_sessions WHERE id = ? AND actor = ?').bind(id, login.toLowerCase()).first<UploadState>()
  if (!row) throw new FileActionError('Upload not found.', 404)
  const changed = await env.AUDIT_DB.prepare("UPDATE file_upload_sessions SET status = 'cancelled' WHERE id = ? AND actor = ? AND status IN ('pending','uploading','cancelled','failed')")
    .bind(id, login.toLowerCase()).run()
  if (!changed.meta.changes) throw new FileActionError('Upload already completed. Use the file manager to remove the stored file.', 409)
  // Persist an access tombstone as well as revocation: even an ambiguous prior R2
  // result cannot become downloadable after a cancelled handler disappears.
  if (row.key) {
    await env.AUDIT_DB.prepare('INSERT OR IGNORE INTO dashboard_file_state (actor, key, deleted_at, purging) VALUES (?, ?, ?, 1)').bind(login.toLowerCase(), row.key, Date.now() - 7 * 86400000).run()
    await env.FILES_BUCKET!.delete(row.key)
  }
  await recordFileEvent(env, login, 'cancel_file_upload', 'Upload cancelled')
  return { uploadId: id, status: 'cancelled' }
}

// Upload tokens are narrowly scoped capabilities, never download or session credentials.
export const fileTransfers = new Hono<{ Bindings: Env; Variables: { ticket: UploadTicket; ticketKey: string } }>()
fileTransfers.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  const auth = c.req.header('authorization') ?? ''
  if (!/^Bearer [a-f0-9]{64}$/.test(auth)) return c.json({ error: 'An upload ticket is required.' }, 401)
  const ticketKey = 'file-upload:' + await digest(auth.slice(7))
  const raw = await c.env.OAUTH_KV.get(ticketKey)
  const ticket: UploadTicket | null = raw ? JSON.parse(raw) : null
  if (!ticket || ticket.expiresAt <= Date.now() || !isAllowedUser(ticket.login, c.env.GITHUB_ALLOWED_USERS, true)) {
    return c.json({ error: 'Upload ticket expired or revoked.' }, 401)
  }
  c.set('ticket', ticket); c.set('ticketKey', ticketKey)
  await next()
})
fileTransfers.onError((error, c) => error instanceof FileActionError || error instanceof FileContentError
  ? c.json({ error: error.message }, error.status) : c.json({ error: 'File upload failed. Check the file list before retrying.' }, 503))
fileTransfers.get('/status', async c => {
  const ticket = c.get('ticket')
  if (!ticket.id) return c.json({ key: ticket.key, status: 'legacy', expiresAt: ticket.expiresAt })
  const state = await c.env.AUDIT_DB.prepare('SELECT status FROM file_upload_sessions WHERE id = ? AND actor = ?')
    .bind(ticket.id, ticket.login.toLowerCase()).first<UploadState>()
  if (!state) return c.json({ error: 'Upload not found.' }, 404)
  return c.json({ key: ticket.key, uploadId: ticket.id, status: state.status, expiresAt: ticket.expiresAt })
})
fileTransfers.post('/cancel', async c => {
  const ticket = c.get('ticket')
  if (!ticket.id) return c.json({ error: 'Legacy tickets expire after ten minutes; cancellation requires a new ticket.' }, 409)
  return c.json(await cancelUpload(c.env, ticket.login, ticket.id))
})
fileTransfers.post('/upload', async c => {
  const ticket = c.get('ticket')
  if (!c.env.FILES_BUCKET) return c.json({ error: 'File storage is not configured.' }, 503)
  const length = c.req.header('content-length')
  if (!length || !/^\d+$/.test(length)) return c.json({ error: 'Content-Length is required.' }, 411)
  if (Number(length) !== ticket.size || Number(length) > MAX_FILE_BYTES) return c.json({ error: 'File size does not match the upload ticket.' }, 400)
  await assertFileUploadReady(c.env, ticket.login, ticket.key)
  if (ticket.id) {
    const claim = await c.env.AUDIT_DB.prepare("UPDATE file_upload_sessions SET status = 'uploading' WHERE id = ? AND actor = ? AND status = 'pending' AND expires_at > ?")
      .bind(ticket.id, ticket.login.toLowerCase(), Date.now()).run()
    if (!claim.meta.changes) return c.json({ error: 'Upload already claimed, cancelled or expired. Check upload status.' }, 409)
  }
  let created = false
  try {
    const bytes = await readFileBytes(c.req.raw.body, ticket.size, AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60000)]))
    // Recheck after the potentially long network read, before writing bytes.
    requireFileAccess(c.env, ticket.login)
    if (ticket.id) {
      const state = await c.env.AUDIT_DB.prepare('SELECT status FROM file_upload_sessions WHERE id = ? AND actor = ?')
        .bind(ticket.id, ticket.login.toLowerCase()).first<UploadState>()
      if (state?.status !== 'uploading' || ticket.expiresAt <= Date.now()) throw new FileActionError('Upload cancelled or expired.', 409)
    }
    const object = await storeFileBytes(c.env.FILES_BUCKET, ticket.key, ticket.name, bytes)
    created = true
    if (ticket.id) {
      const complete = await c.env.AUDIT_DB.prepare("UPDATE file_upload_sessions SET status = 'completed' WHERE id = ? AND status = 'uploading' AND expires_at > ?")
        .bind(ticket.id, Date.now()).run()
      if (!complete.meta.changes) {
        await c.env.FILES_BUCKET.delete(ticket.key)
        created = false
        throw new FileActionError('Upload cancelled or expired before completion.', 409)
      }
    } else { try { await c.env.OAUTH_KV.delete(c.get('ticketKey')) } catch {} }
    await recordFileEvent(c.env, ticket.login, 'upload_workspace_file', `Stored verified file (${object.size} bytes)` )
    return c.json({ file: fileInfo(object), verified: true, ...privateFileLinks(object.key) }, 201)
  } catch (error) {
    if (ticket.id) {
      const state = await c.env.AUDIT_DB.prepare('SELECT status FROM file_upload_sessions WHERE id = ? AND actor = ?').bind(ticket.id, ticket.login.toLowerCase()).first<UploadState>()
      if (state?.status === 'cancelled') await c.env.FILES_BUCKET.delete(ticket.key)
    }
    // Never reset a claimed ticket to pending: an ambiguous R2 result must not be replayed.
    if (ticket.id && !created) {
      await c.env.AUDIT_DB.prepare("UPDATE file_upload_sessions SET status = 'failed' WHERE id = ? AND status = 'uploading'").bind(ticket.id).run()
    }
    await recordFileEvent(c.env, ticket.login, 'upload_workspace_file', 'Upload failed; check file list before retrying', true)
    throw error
  }
})

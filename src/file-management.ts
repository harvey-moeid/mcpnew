import { digest, isAllowedUser } from './dashboard-auth'
import { ownedFileKey, requireFileAccess, filePrefix } from './files'
import installation from '../installation.json' with { type: 'json' }

export const TRASH_RETENTION_MS = 7 * 86400000
export type FileState = { actor: string; key: string; project: string; deleted_at: number | null; purging: number }
export class FileActionError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message) }
}
export const validProject = (project: string) => project.length <= 80 && !/[\u0000-\u001f\u007f]/.test(project)
export async function readFileState(env: Env, login: string, key: string) {
  return env.AUDIT_DB.prepare('SELECT * FROM dashboard_file_state WHERE actor = ? AND key = ?')
    .bind(login.toLowerCase(), key).first<FileState>()
}
export async function statesFor(env: Env, login: string, keys: string[]) {
  if (!keys.length) return new Map<string, FileState>()
  const rows = await env.AUDIT_DB.prepare(`SELECT * FROM dashboard_file_state WHERE actor = ? AND key IN (${keys.map(() => '?').join(',')})`)
    .bind(login.toLowerCase(), ...keys).all<FileState>()
  return new Map(rows.results.map(row => [row.key, row]))
}
export async function activeFile(env: Env, login: string, key: string) {
  const bucket = requireFileAccess(env, login)
  if (!ownedFileKey(login, key)) throw new FileActionError('File tidak ditemukan.', 404)
  const state = await readFileState(env, login, key)
  if (state?.deleted_at != null || state?.purging) throw new FileActionError('File berada di tempat sampah.', 404)
  const object = await bucket.head(key)
  if (!object) throw new FileActionError('File tidak ditemukan.', 404)
  return object
}
export async function setFileProject(env: Env, login: string, key: string, project: string) {
  if (!validProject(project)) throw new FileActionError('Label proyek maksimal 80 karakter tanpa karakter kontrol.')
  await activeFile(env, login, key)
  await env.AUDIT_DB.prepare(`INSERT INTO dashboard_file_state (actor, key, project) VALUES (?, ?, ?)
    ON CONFLICT(actor, key) DO UPDATE SET project = excluded.project WHERE deleted_at IS NULL AND purging = 0`)
    .bind(login.toLowerCase(), key, project.trim()).run()
}
export async function trashFile(env: Env, login: string, key: string) {
  await activeFile(env, login, key)
  const actor = login.toLowerCase(), now = Date.now()
  await env.AUDIT_DB.batch([
    env.AUDIT_DB.prepare(`INSERT INTO dashboard_file_state (actor, key, deleted_at) VALUES (?, ?, ?)
      ON CONFLICT(actor, key) DO UPDATE SET deleted_at = COALESCE(deleted_at, excluded.deleted_at)`)
      .bind(actor, key, now),
    env.AUDIT_DB.prepare('UPDATE dashboard_file_shares SET revoked_at = ? WHERE actor = ? AND key = ? AND revoked_at IS NULL').bind(now, actor, key),
  ])
}
export async function restoreFile(env: Env, login: string, key: string) {
  const bucket = requireFileAccess(env, login)
  if (!ownedFileKey(login, key) || !await bucket.head(key)) throw new FileActionError('File tidak ditemukan.', 404)
  const result = await env.AUDIT_DB.prepare(`UPDATE dashboard_file_state SET deleted_at = NULL
    WHERE actor = ? AND key = ? AND deleted_at > ? AND purging = 0`)
    .bind(login.toLowerCase(), key, Date.now() - TRASH_RETENTION_MS).run()
  if (!result.meta.changes) throw new FileActionError('Masa pemulihan sudah berakhir atau file tidak ada di tempat sampah.', 409)
}
export async function createFileShare(env: Env, login: string, key: string, hours: number) {
  if (![1, 24, 168].includes(hours)) throw new FileActionError('Pilih masa berlaku 1 jam, 24 jam, atau 7 hari.')
  await activeFile(env, login, key)
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  const now = Date.now(), id = crypto.randomUUID(), expiresAt = now + hours * 3600000
  const result = await env.AUDIT_DB.prepare(`INSERT INTO dashboard_file_shares (id, token_hash, actor, key, expires_at, created_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM dashboard_file_state WHERE actor = ? AND key = ? AND (deleted_at IS NOT NULL OR purging = 1))`)
    .bind(id, await digest(token), login.toLowerCase(), key, expiresAt, now, login.toLowerCase(), key).run()
  if (!result.meta.changes) throw new FileActionError('File sudah berada di tempat sampah.', 409)
  return { id, expiresAt, url: `${installation.publicOrigin}/shared-files/${token}` }
}
export async function listFileShares(env: Env, login: string, key: string) {
  await activeFile(env, login, key)
  const rows = await env.AUDIT_DB.prepare(`SELECT id, expires_at AS expiresAt, created_at AS createdAt FROM dashboard_file_shares
    WHERE actor = ? AND key = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 100`)
    .bind(login.toLowerCase(), key, Date.now()).all()
  return rows.results
}
export async function revokeFileShare(env: Env, login: string, id: string) {
  requireFileAccess(env, login)
  await env.AUDIT_DB.prepare('UPDATE dashboard_file_shares SET revoked_at = ? WHERE actor = ? AND id = ?')
    .bind(Date.now(), login.toLowerCase(), id).run()
}
export async function sharedFileKey(env: Env, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const row = await env.AUDIT_DB.prepare(`SELECT actor, key FROM dashboard_file_shares WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`)
    .bind(await digest(token), Date.now()).first<{ actor: string; key: string }>()
  if (!row || !isAllowedUser(row.actor, env.GITHUB_ALLOWED_USERS, true) || !ownedFileKey(row.actor, row.key)) return null
  const state = await readFileState(env, row.actor, row.key)
  return state?.deleted_at != null || state?.purging ? null : row.key
}

// Mark before deleting bytes so a concurrent restore cannot revive a file being purged.
// Small batches also fit request-triggered background work on Workers Free.
export async function purgeExpiredFiles(env: Env) {
  if (!env.FILES_BUCKET) return 0
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const rows = await env.AUDIT_DB.prepare('SELECT actor, key FROM dashboard_file_state WHERE deleted_at <= ? AND purging != 2 ORDER BY deleted_at LIMIT 10')
    .bind(cutoff).all<{ actor: string; key: string }>()
  let count = 0
  for (const row of rows.results) {
    if (!ownedFileKey(row.actor, row.key)) continue
    const claimed = await env.AUDIT_DB.prepare('UPDATE dashboard_file_state SET purging = 1 WHERE actor = ? AND key = ? AND deleted_at <= ?')
      .bind(row.actor, row.key, cutoff).run()
    if (!claimed.meta.changes) continue
    await env.FILES_BUCKET.delete(row.key)
    await env.AUDIT_DB.prepare('UPDATE dashboard_file_state SET purging = 2 WHERE actor = ? AND key = ?').bind(row.actor, row.key).run()
    // Keep the tombstone to deny old links/tickets even after physical deletion.
    count++
  }
  await env.AUDIT_DB.prepare('DELETE FROM dashboard_file_shares WHERE expires_at <= ? OR revoked_at IS NOT NULL').bind(Date.now()).run()
  return count
}


export async function fileUsagePage(env: Env, login: string, cursor?: string) {
  const bucket = requireFileAccess(env, login)
  if (cursor && cursor.length > 4096) throw new FileActionError('Cursor tidak valid.')
  const page = await bucket.list({ prefix: filePrefix(login), limit: 50, cursor })
  const states = await statesFor(env, login, page.objects.map(object => object.key))
  const totals = { activeCount: 0, activeBytes: 0, trashCount: 0, trashBytes: 0 }
  for (const object of page.objects) {
    if (states.get(object.key)?.deleted_at != null) { totals.trashCount++; totals.trashBytes += object.size }
    else { totals.activeCount++; totals.activeBytes += object.size }
  }
  return { ...totals, cursor: page.truncated ? page.cursor : null }
}


/** Background cleanup on authenticated file listing; no additional Cron Trigger needed.
 * KV throttling is best-effort, not a lock. Concurrent cleanup is safe to retry.
 */
export function queueFileCleanup(env: Env, ctx?: { waitUntil(promise: Promise<unknown>): void }) {
  if (!env.FILES_BUCKET || !ctx || typeof ctx.waitUntil !== 'function') return
  ctx.waitUntil((async () => {
    const marker = 'file-cleanup:last-attempt'
    const last = Number(await env.OAUTH_KV.get(marker) ?? 0)
    if (Number.isFinite(last) && Date.now() - last < 3600000) return
    // Back off failed attempts too, rather than retrying on every file-list request.
    await env.OAUTH_KV.put(marker, String(Date.now()), { expirationTtl: 3600 })
    await purgeExpiredFiles(env)
  })().catch(() => { console.error('Background file cleanup failed; retry on a later authenticated file listing.') }))
}

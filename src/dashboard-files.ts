import { Hono } from 'hono'
import { assertFileUploadReady, FileActionError, queueFileCleanup, fileUsagePage, statesFor, readFileState, setFileProject, trashFile, restoreFile, createFileShare, listFileShares, revokeFileShare, TRASH_RETENTION_MS } from './file-management'
import { recordFileEvent } from './file-audit'
import { FileContentError, readFileBytes, storeFileBytes } from './file-content'
import { createUploadTicket, cancelUpload } from './file-transfers'
import { sameOrigin, type DashboardSession } from './dashboard-auth'

import { MAX_FILE_BYTES, filePrefix as prefix, validFileName as validName, fileInfo, fileDownload, ownedFileKey } from './files'

// Mounted after the dashboard's session middleware. Never expose this router publicly.
export const dashboardFiles = new Hono<{ Bindings: Env; Variables: { session: DashboardSession } }>()

dashboardFiles.onError((error, c) => error instanceof FileActionError || error instanceof FileContentError ? c.json({ error: error.message }, error.status) : c.json({ error: 'Penyimpanan R2 belum dapat diakses. Periksa migrasi database atau coba lagi nanti.' }, 503))

dashboardFiles.get('/', async c => {
  if (!c.env.FILES_BUCKET) return c.json({ configured: false, files: [], cursor: null, maxFileBytes: MAX_FILE_BYTES })
  const cursor = c.req.query('cursor')
  if (cursor && cursor.length > 4096) return c.json({ error: 'Cursor file tidak valid.' }, 400)
  const result = await c.env.FILES_BUCKET.list({ prefix: prefix(c.get('session').login),
    limit: 50, cursor, include: ['customMetadata', 'httpMetadata'] })
  const states = await statesFor(c.env, c.get('session').login, result.objects.map(object => object.key))
  const trash = c.req.query('trash') === 'true', project = c.req.query('project')
  const files = result.objects.filter(object => {
    const state = states.get(object.key)
    return Boolean(state?.deleted_at != null) === trash && state?.purging !== 2 && (!project || state?.project === project)
  }).map(object => { const state = states.get(object.key); return { ...fileInfo(object), project: state?.project ?? '', deletedAt: state?.deleted_at ?? null, restoreUntil: state?.deleted_at != null ? state.deleted_at + TRASH_RETENTION_MS : null } })
  queueFileCleanup(c.env, c.executionCtx)
  return c.json({ configured: true, files,
    cursor: result.truncated ? result.cursor : null, maxFileBytes: MAX_FILE_BYTES })
})

dashboardFiles.post('/', async c => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Permintaan tidak valid.' }, 403)
  if (!c.env.FILES_BUCKET) return c.json({ error: 'Penyimpanan file R2 belum dikonfigurasi.' }, 503)
  const name = c.req.query('name') ?? ''
  if (!validName(name)) return c.json({ error: 'Nama file tidak valid (maksimal 255 byte, tanpa pemisah folder).' }, 400)
  const length = c.req.header('content-length')
  if (!length || !/^\d+$/.test(length)) return c.json({ error: 'Ukuran file diperlukan.' }, 411)
  const size = Number(length)
  if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) return c.json({ error: 'Ukuran file maksimal 25 MiB.' }, 413)
  if (size > 0 && !c.req.raw.body) return c.json({ error: 'Isi file tidak tersedia.' }, 400)
  const key = prefix(c.get('session').login) + crypto.randomUUID() + '/' + name
  await assertFileUploadReady(c.env, c.get('session').login, key)
  const bytes = await readFileBytes(c.req.raw.body, size, AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(60000)]))
  const object = await storeFileBytes(c.env.FILES_BUCKET, key, name, bytes)
  await recordFileEvent(c.env, c.get('session').login, 'dashboard_upload_file', `Stored verified file (${object.size} bytes)`)
  return c.json({ file: fileInfo(object), verified: true }, 201)
})

dashboardFiles.post('/uploads', async c => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Permintaan tidak valid.' }, 403)
  let body: { filename?: unknown; size?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Data tidak valid.' }, 400) }
  if (typeof body.filename !== 'string' || !validName(body.filename) || typeof body.size !== 'number') return c.json({ error: 'Nama dan ukuran file diperlukan.' }, 400)
  return c.json(await createUploadTicket(c.env, c.get('session').login, body.filename, body.size), 201)
})
dashboardFiles.post('/uploads/:id/cancel', async c => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Permintaan tidak valid.' }, 403)
  return c.json(await cancelUpload(c.env, c.get('session').login, c.req.param('id')))
})

dashboardFiles.get('/download', async c => {
  if (!c.env.FILES_BUCKET) return c.json({ error: 'Penyimpanan file R2 belum dikonfigurasi.' }, 503)
  const key = c.req.query('key') ?? ''
  if (!ownedFileKey(c.get('session').login, key)) return c.json({ error: 'File tidak ditemukan.' }, 404)
  const state = await readFileState(c.env, c.get('session').login, key)
  if (state?.deleted_at != null || state?.purging) return c.json({ error: 'File tidak ditemukan.' }, 404)
  const object = await c.env.FILES_BUCKET.get(key)
  if (!object) return c.json({ error: 'File tidak ditemukan.' }, 404)
  return fileDownload(object)
})


// Every mutation requires both the owner session and an exact same-origin request.
dashboardFiles.use('/manage/*', async (c, next) => {
  if (c.req.method !== 'GET' && !sameOrigin(c.req.raw)) return c.json({ error: 'Permintaan tidak valid.' }, 403)
  if (!c.env.FILES_BUCKET) return c.json({ error: 'Penyimpanan belum dikonfigurasi.' }, 503)
  await next()
  if (c.req.method !== 'GET') await recordFileEvent(c.env, c.get('session').login, 'dashboard_file_manage', 'File management request: ' + c.req.path.split('/').pop(), c.res.status >= 400)
})
dashboardFiles.post('/manage/:action', async c => {
  let body: { key?: unknown; project?: unknown; hours?: unknown; id?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'Data tidak valid.' }, 400) }
  const action = c.req.param('action'), login = c.get('session').login
  if (action === 'revoke') {
    if (typeof body.id !== 'string' || body.id.length > 100) return c.json({ error: 'ID tidak valid.' }, 400)
    await revokeFileShare(c.env, login, body.id)
  } else {
    if (typeof body.key !== 'string' || !ownedFileKey(login, body.key)) return c.json({ error: 'File tidak ditemukan.' }, 404)
    if (action === 'trash') await trashFile(c.env, login, body.key)
    else if (action === 'restore') await restoreFile(c.env, login, body.key)
    else if (action === 'project' && typeof body.project === 'string') await setFileProject(c.env, login, body.key, body.project)
    else if (action === 'share' && typeof body.hours === 'number') return c.json(await createFileShare(c.env, login, body.key, body.hours), 201)
    else return c.json({ error: 'Aksi tidak valid.' }, 400)
  }
  return c.json({ ok: true })
})
dashboardFiles.get('/manage/shares', async c => c.json({ shares: await listFileShares(c.env, c.get('session').login, c.req.query('key') ?? '') }))

// Each request totals one R2 page, including trash. The browser follows cursor for the complete account total.
dashboardFiles.get('/usage', async c => {
  if (!c.env.FILES_BUCKET) return c.json({ activeCount: 0, activeBytes: 0, trashCount: 0, trashBytes: 0, cursor: null })
  const cursor = c.req.query('cursor')
  if (cursor && cursor.length > 4096) return c.json({ error: 'Cursor tidak valid.' }, 400)
  return c.json(await fileUsagePage(c.env, c.get('session').login, cursor))
})

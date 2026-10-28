import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { withErrorHandling } from './error-handling'
import { assertFileUploadReady, activeFile, queueFileCleanup, statesFor, fileUsagePage, TRASH_RETENTION_MS, setFileProject, trashFile, restoreFile, createFileShare, listFileShares, revokeFileShare, validProject } from './file-management'
import { withAudit } from './audit-log'
import { cancelUpload, createUploadTicket } from './file-transfers'
import { MAX_FILE_BYTES, MAX_INLINE_BYTES, filePrefix, newFileKey, ownedFileKey, fileInfo, privateFileLinks, requireFileAccess } from './files'

import { allowedUploadUrl, fetchUploadBytes, decodeFileBase64, storeFileBytes } from './file-content'

const result = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const filename = z.string().min(1).max(255).describe('Original filename, without folder paths')

export function registerFileTools(server: McpServer, env: Env, login: string, ctx?: { waitUntil(promise: Promise<unknown>): void }) {
  const write = <Args>(name: string, handler: (args: Args) => Promise<CallToolResult>) =>
    withAudit(env.AUDIT_DB, login, name, () => 'Private file operation', withErrorHandling(handler))

  server.registerTool('upload_file', {
    description: 'Upload a small binary file (PDF, ZIP, image, etc.) as strict base64 to your private dashboard R2 storage. Maximum decoded size 1 MiB. Alternatively provide source_url on FILE_UPLOAD_ALLOWED_HOSTS (HTTPS, no redirects, up to 25 MiB). For larger workspace files use create_file_upload then send local file bytes to the returned upload URL. Returns a private download URL requiring your dashboard login. The server cannot read a local workspace path.',
    inputSchema: { filename, content_base64: z.string().max(4 * Math.ceil(MAX_INLINE_BYTES / 3)).optional().describe('Standard padded base64 up to 1 MiB; provide this OR source_url'), source_url: z.string().max(4096).optional().describe('HTTPS URL on an administrator allowed hostname, up to 25 MiB; redirects forbidden') },
    annotations: { title: 'Upload private file', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, write('upload_file', async ({ filename, content_base64, source_url }) => {
    const bucket = requireFileAccess(env, login)
    const key = newFileKey(login, filename)
    if ((content_base64 === undefined) === (source_url === undefined)) throw new Error('Provide exactly one of content_base64 or source_url. Local paths are not supported.')
    const source = source_url === undefined ? undefined : allowedUploadUrl(source_url, env.FILE_UPLOAD_ALLOWED_HOSTS ?? '')
    await assertFileUploadReady(env, login, key)
    const bytes = source ? await fetchUploadBytes(source) : decodeFileBase64(content_base64!, MAX_INLINE_BYTES)
    requireFileAccess(env, login)
    const object = await storeFileBytes(bucket, key, filename, bytes)
    return result({ file: fileInfo(object), verified: true, ...privateFileLinks(key) })
  }))

  server.registerTool('create_file_upload', {
    description: 'Prepare an upload for a local workspace file up to 25 MiB. Returns a 10-minute upload-only token and URL. Use your workspace shell/HTTP client to POST raw file bytes with Authorization: Bearer <uploadToken> and Content-Length matching size. Do not send a local path to the server. Do not publish the upload token. The final download URL always requires the owner dashboard login; no public download link is created.',
    inputSchema: { filename, size: z.number().int().min(0).max(MAX_FILE_BYTES).describe('Exact file size in bytes') },
    annotations: { title: 'Prepare workspace file upload', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, write('create_file_upload', async ({ filename, size }) => {
    requireFileAccess(env, login)
    return result(await createUploadTicket(env, login, filename, size))
  }))

  server.registerTool('cancel_file_upload', {
    description: 'Cancel a pending or in-progress upload by uploadId from create_file_upload. Cannot delete completed files. Cancellation prevents completion even if bytes are still being sent.',
    inputSchema: { upload_id: z.string().uuid() },
    annotations: { title: 'Cancel private upload', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, write('cancel_file_upload', async ({ upload_id }) => result(await cancelUpload(env, login, upload_id))))

  server.registerTool('list_files', {
    description: 'List your private dashboard files, including files uploaded through MCP. Returns metadata and download URLs requiring your dashboard login. Supports trash and project filters. Follow cursor until null; filtered pages may be empty.',
    inputSchema: { cursor: z.string().max(4096).optional(), trash: z.boolean().default(false), project: z.string().max(80).optional() },
    annotations: { title: 'List private files', readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ cursor, trash, project }) => {
    const bucket = requireFileAccess(env, login)
    const listed = await bucket.list({ prefix: filePrefix(login), limit: 50, cursor, include: ['customMetadata', 'httpMetadata'] })
    const states = await statesFor(env, login, listed.objects.map(object => object.key))
    queueFileCleanup(env, ctx)
    return result({ files: listed.objects.filter(object => Boolean(states.get(object.key)?.deleted_at != null) === Boolean(trash) && states.get(object.key)?.purging !== 2 && (!project || states.get(object.key)?.project === project)).map(object => { const state = states.get(object.key); return { ...fileInfo(object), project: state?.project ?? '', deletedAt: state?.deleted_at ?? null, restoreUntil: state?.deleted_at != null ? state.deleted_at + TRASH_RETENTION_MS : null, ...(!trash ? privateFileLinks(object.key) : {}) } }), cursor: listed.truncated ? listed.cursor : null })
  }))

  server.registerTool('get_file_download', {
    description: 'Get a private download URL for one of your dashboard R2 files. This URL requires your dashboard login and cannot be used by other people or as a public link.',
    inputSchema: { key: z.string().max(1024).describe('File key returned by upload_file, create_file_upload or list_files') },
    annotations: { title: 'Get private file download', readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ key }) => {
    requireFileAccess(env, login)
    if (!ownedFileKey(login, key)) throw new Error('File not found.')
    const object = await activeFile(env, login, key)
    return result({ file: fileInfo(object), ...privateFileLinks(key) })
  }))

  server.registerTool('manage_file', {
    description: 'Set a project label, move a private file to trash (recoverable for 7 days), or restore it. Trash revokes existing share links. For trash, confirm must equal the exact file key. Restore never reactivates old links. Labels apply to active files only.',
    inputSchema: { key: z.string().max(1024), action: z.enum(['project', 'trash', 'restore']), project: z.string().max(80).optional(), confirm: z.string().optional() },
    annotations: { title: 'Manage private file', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, write('manage_file', async ({ key, action, project, confirm }) => {
    requireFileAccess(env, login)
    if (action === 'trash') {
      if (confirm !== key) throw new Error('Confirmation required: confirm must equal the file key.')
      await trashFile(env, login, key)
    } else if (action === 'restore') await restoreFile(env, login, key)
    else if (action === 'project' && typeof project === 'string' && validProject(project)) await setFileProject(env, login, key, project)
    else throw new Error('Invalid file action or project label.')
    return result({ ok: true, key, action })
  }))
  server.registerTool('create_file_share', {
    description: 'Explicitly share one of your active files using a temporary bearer download link. Anyone holding the returned link can download without login until expiry or revocation. Only call when the user asks to share this file. Private download remains the default. Trash automatically revokes shares.',
    inputSchema: { key: z.string().max(1024), hours: z.union([z.literal(1), z.literal(24), z.literal(168)]).default(1) },
    annotations: { title: 'Share file temporarily', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, write('create_file_share', async ({ key, hours }) => result(await createFileShare(env, login, key, hours))))
  server.registerTool('list_file_shares', {
    description: 'List active share IDs and expiry for one of your files. Raw bearer links are shown only at creation and are not retained.',
    inputSchema: { key: z.string().max(1024) }, annotations: { title: 'List file shares', readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ key }) => result({ shares: await listFileShares(env, login, key) })))
  server.registerTool('revoke_file_share', {
    description: 'Revoke one of your temporary file share links by its share ID. Does not affect the private owner download.',
    inputSchema: { id: z.string().uuid() }, annotations: { title: 'Revoke file share', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, write('revoke_file_share', async ({ id }) => { await revokeFileShare(env, login, id); return result({ ok: true }) }))

  server.registerTool('get_file_storage', {
    description: 'Count storage used by your managed files, separating active files and trash. Each call returns totals for one page only; follow cursor and SUM all pages until cursor is null. This covers your dashboard prefix, not the whole R2 account or billing.',
    inputSchema: { cursor: z.string().max(4096).optional() }, annotations: { title: 'Get file storage usage', readOnlyHint: true, openWorldHint: true },
  }, withErrorHandling(async ({ cursor }) => result(await fileUsagePage(env, login, cursor))))

}

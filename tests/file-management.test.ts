import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { createSession } from '../src/dashboard-auth.ts'

const compiled = await build({ stdin: { contents: "export { GitHubHandler } from './src/github-handler'; export { purgeExpiredFiles, restoreFile } from './src/file-management'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false })
const { GitHubHandler, purgeExpiredFiles, restoreFile } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const schema = await readFile('migrations/0002_file_management.sql', 'utf8')
const origin = 'https://mcpnew.muidsoft.com'

async function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  const prepare = (sql: string, args: any[] = []): any => ({
    bind(...bound: any[]) { return prepare(sql, bound) },
    async first() { return db.prepare(sql).get(...args) ?? null },
    async all() { return { results: db.prepare(sql).all(...args) } },
    async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } } },
  })
  const values = new Map<string, string>()
  const objects = new Map<string, { data: Uint8Array; project?: string }>()
  const key = 'dashboard-files/owner/uuid/report.zip'
  objects.set(key, { data: new Uint8Array([0, 255, 128, 1]) })
  const objectInfo = (key: string, value: { data: Uint8Array }) => ({ key, size: value.data.length, uploaded: new Date(), customMetadata: { filename: key.split('/').pop() }, httpMetadata: {} })
  const env = {
    GITHUB_ALLOWED_USERS: 'owner,other', COOKIE_ENCRYPTION_KEY: 'local-file-management-test-secret',
    OAUTH_KV: { async get(key: string) { return values.get(key) ?? null }, async put(key: string, value: string) { values.set(key, value) }, async delete(key: string) { values.delete(key) } },
    AUDIT_DB: { prepare, async batch(statements: any[]) {
      db.exec('BEGIN')
      try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results }
      catch (error) { db.exec('ROLLBACK'); throw error }
    } },
    FILES_BUCKET: {
      async head(key: string) { const value = objects.get(key); return value ? objectInfo(key, value) : null },
      async get(key: string) { const value = objects.get(key); return value ? { ...objectInfo(key, value), body: new Blob([value.data]).stream() } : null },
      async delete(key: string) { objects.delete(key) },
      async list(options: R2ListOptions) {
        const all = [...objects].filter(([key]) => key.startsWith(options.prefix!))
        const offset = Number(options.cursor ?? 0), page = all.slice(offset, offset + 1)
        return { objects: page.map(([key, value]) => objectInfo(key, value)), truncated: offset + 1 < all.length, cursor: String(offset + 1) }
      },
    },
  } as unknown as Env
  const cookie = async (login: string) => (await createSession(env, { login, name: login, avatarUrl: '', accessToken: 'test-only' })).split(';')[0]
  const Cookie = await cookie('owner'), otherCookie = await cookie('other')
  const request = (path: string, options: RequestInit = {}) => GitHubHandler.fetch(new Request(origin + path, options), env, {}) as Promise<Response>
  const manage = (action: string, body: unknown, authCookie = Cookie, requestOrigin = origin) => request('/dashboard/api/files/manage/' + action, { method: 'POST', headers: { Cookie: authCookie, Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { db, env, objects, key, Cookie, otherCookie, request, manage }
}

test('project labels filter listings and usage counts all account objects including trash across pages', async () => {
  const { db, objects, key, Cookie, request, manage } = await setup()
  try {
    objects.set('dashboard-files/owner/uuid/other.zip', { data: new Uint8Array(10) })
    objects.set('dashboard-files/other/uuid/secret', { data: new Uint8Array(999) })
    assert.equal((await manage('project', { key, project: ' Project A ' })).status, 200)
    const first = await request('/dashboard/api/files?project=Project%20A', { headers: { Cookie } })
    assert.equal((await first.json()).files[0].project, 'Project A')
    assert.equal((await manage('trash', { key })).status, 200)
    let cursor: string | null = null, activeBytes = 0, trashBytes = 0, activeCount = 0, trashCount = 0
    do {
      const response = await request('/dashboard/api/files/usage' + (cursor ? '?cursor=' + cursor : ''), { headers: { Cookie } })
      assert.equal(response.status, 200)
      const data = await response.json()
      activeBytes += data.activeBytes; trashBytes += data.trashBytes; activeCount += data.activeCount; trashCount += data.trashCount; cursor = data.cursor
    } while (cursor)
    assert.deepEqual({ activeBytes, trashBytes, activeCount, trashCount }, { activeBytes: 10, trashBytes: 4, activeCount: 1, trashCount: 1 })
    const trash = await request('/dashboard/api/files?trash=true', { headers: { Cookie } })
    const item = (await trash.json()).files[0]
    assert.equal(item.key, key)
    assert.equal(item.restoreUntil - item.deletedAt, 7 * 86400000)
  } finally { db.close() }
})

test('temporary shares work anonymously, revoke immediately, and default downloads remain private', async () => {
  const { db, key, Cookie, otherCookie, request, manage } = await setup()
  try {
    assert.equal((await request('/dashboard/api/files/download?key=' + encodeURIComponent(key))).status, 401)
    assert.equal((await request('/shared-files/' + '0'.repeat(64))).status, 404)
    const created = await manage('share', { key, hours: 1 })
    assert.equal(created.status, 201)
    const share = await created.json(), path = new URL(share.url).pathname
    const publicFile = await request(path)
    assert.equal(publicFile.status, 200)
    assert.deepEqual(new Uint8Array(await publicFile.arrayBuffer()), new Uint8Array([0, 255, 128, 1]))
    assert.equal(publicFile.headers.get('Cache-Control'), 'no-store')
    assert.equal(publicFile.headers.get('Referrer-Policy'), 'no-referrer')
    assert.match(publicFile.headers.get('Content-Disposition')!, /attachment/)
    const stored = db.prepare('SELECT * FROM dashboard_file_shares').get()!
    assert.ok(!JSON.stringify(stored).includes(path.split('/').pop()!))
    assert.equal((await manage('revoke', { id: share.id }, otherCookie)).status, 200)
    assert.equal((await request(path)).status, 200)
    assert.equal((await manage('revoke', { id: share.id })).status, 200)
    assert.equal((await request(path)).status, 404)
    assert.equal((await request('/dashboard/api/files/download?key=' + encodeURIComponent(key), { headers: { Cookie } })).status, 200)
  } finally { db.close() }
})

test('trash blocks downloads and revokes links; restore preserves project and never reactivates shares', async () => {
  const { db, key, Cookie, request, manage } = await setup()
  try {
    await manage('project', { key, project: 'Demo' })
    const share = await (await manage('share', { key, hours: 24 })).json()
    assert.equal((await manage('trash', { key })).status, 200)
    assert.equal((await request(new URL(share.url).pathname)).status, 404)
    assert.equal((await request('/dashboard/api/files/download?key=' + encodeURIComponent(key), { headers: { Cookie } })).status, 404)
    assert.equal((await manage('share', { key, hours: 1 })).status, 404)
    assert.equal((await manage('restore', { key })).status, 200)
    assert.equal((await request(new URL(share.url).pathname)).status, 404)
    assert.equal(db.prepare('SELECT project FROM dashboard_file_state').get()!.project, 'Demo')
    assert.equal((await request('/dashboard/api/files/download?key=' + encodeURIComponent(key), { headers: { Cookie } })).status, 200)
  } finally { db.close() }
})

test('file mutations enforce owner and CSRF; shares expire and are disabled when owner loses access', async () => {
  const { db, env, key, otherCookie, request, manage } = await setup()
  try {
    for (const action of ['trash', 'restore', 'project', 'share']) {
      const body = { key, project: 'x', hours: 1 }
      assert.equal((await manage(action, body, otherCookie)).status, 404)
      assert.equal((await manage(action, body, undefined, 'https://evil.example')).status, 403)
    }
    assert.equal((await manage('project', { key, project: 'x'.repeat(81) })).status, 400)
    assert.equal((await manage('share', { key, hours: 999 })).status, 400)
    let share = await (await manage('share', { key, hours: 1 })).json()
    db.prepare('UPDATE dashboard_file_shares SET expires_at = ? WHERE id = ?').run(Date.now() - 1, share.id)
    assert.equal((await request(new URL(share.url).pathname)).status, 404)
    share = await (await manage('share', { key, hours: 1 })).json()
    env.GITHUB_ALLOWED_USERS = 'other'
    assert.equal((await request(new URL(share.url).pathname)).status, 404)
  } finally { db.close() }
})

test('purge deletes expired bytes, retains active files and prevents restore racing with deletion', async () => {
  const { db, env, objects, key, manage } = await setup()
  try {
    await manage('trash', { key })
    db.prepare('UPDATE dashboard_file_state SET deleted_at = ?').run(Date.now() - 8 * 86400000)
    assert.equal((await manage('restore', { key })).status, 409)
    objects.set('dashboard-files/owner/uuid/active.zip', { data: new Uint8Array(10) })
    const originalDelete = env.FILES_BUCKET!.delete.bind(env.FILES_BUCKET)
    env.FILES_BUCKET!.delete = async (deletingKey: string | string[]) => {
      await assert.rejects(restoreFile(env, 'owner', key), /Masa pemulihan/)
      await originalDelete(deletingKey)
    }
    assert.equal(await purgeExpiredFiles(env), 1)
    assert.ok(!objects.has(key))
    assert.equal(objects.size, 1)
    assert.equal(db.prepare('SELECT purging FROM dashboard_file_state').get()!.purging, 2)
    assert.equal(await purgeExpiredFiles(env), 0)
  } finally { db.close() }
})

test('failed R2 purge can be retried without allowing expired files to be restored', async () => {
  const { db, env, key, manage } = await setup()
  try {
    await manage('trash', { key })
    db.prepare('UPDATE dashboard_file_state SET deleted_at = ?').run(Date.now() - 8 * 86400000)
    const originalDelete = env.FILES_BUCKET!.delete.bind(env.FILES_BUCKET)
    env.FILES_BUCKET!.delete = async () => { throw new Error('storage unavailable') }
    await assert.rejects(purgeExpiredFiles(env), /storage unavailable/)
    assert.equal((await manage('restore', { key })).status, 409)
    env.FILES_BUCKET!.delete = originalDelete
    assert.equal(await purgeExpiredFiles(env), 1)
  } finally { db.close() }
})

import type { AuthRequest } from '@cloudflare/workers-oauth-provider'

const SESSION_SECONDS = 8 * 60 * 60
const TRANSACTION_SECONDS = 10 * 60
const SESSION_COOKIE = '__Host-ops_session'

export type LoginTransaction = { kind: 'dashboard' } | { kind: 'mcp'; request: AuthRequest }
export type DashboardSession = {
  login: string
  name: string
  avatarUrl: string
  accessToken: string
  expiresAt: number
}

export function readCookie(request: Request, name: string): string | null {
  const entry = request.headers.get('cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${name}=`))
  if (!entry) return null
  try { return decodeURIComponent(entry.slice(name.length + 1)) } catch { return null }
}

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomHandle(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function cookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('Authentication is not configured')
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(value)))
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)))
}

async function unseal<T>(value: string, secret: string): Promise<T> {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) },
    await encryptionKey(secret), bytes.slice(12))
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

export function isAllowedUser(login: string, allowlist: string, requireAllowlist = false): boolean {
  const users = (allowlist ?? '').split(',').map(user => user.trim().toLowerCase()).filter(Boolean)
  return users.length ? users.includes(login.toLowerCase()) : !requireAllowlist
}

export async function beginTransaction(env: Env, transaction: LoginTransaction): Promise<{ state: string; cookie: string }> {
  const state = randomHandle()
  const verifier = randomHandle()
  const key = await digest(state)
  await env.OAUTH_KV.put(`ops:transaction:${key}`, await seal({
    transaction, verifierHash: await digest(verifier), expiresAt: Date.now() + TRANSACTION_SECONDS * 1000,
  }, env.COOKIE_ENCRYPTION_KEY), { expirationTtl: TRANSACTION_SECONDS })
  return { state, cookie: cookie(`__Host-ops_tx_${key.slice(0, 16)}`, verifier, TRANSACTION_SECONDS) }
}

export async function consumeTransaction(env: Env, request: Request, state: string): Promise<{ transaction: LoginTransaction; clearCookie: string } | null> {
  if (!/^[a-f0-9]{64}$/.test(state)) return null
  const key = await digest(state)
  const name = `__Host-ops_tx_${key.slice(0, 16)}`
  const verifier = readCookie(request, name)
  if (!verifier) return null
  const stored = await env.OAUTH_KV.get(`ops:transaction:${key}`)
  if (!stored) return null
  try {
    const data = await unseal<{ transaction: LoginTransaction; verifierHash: string; expiresAt: number }>(stored, env.COOKIE_ENCRYPTION_KEY)
    if (data.expiresAt <= Date.now() || data.verifierHash !== await digest(verifier)) return null
    // Browser-bound, short-lived state is discarded before exchanging the code.
    await env.OAUTH_KV.delete(`ops:transaction:${key}`)
    return { transaction: data.transaction, clearCookie: cookie(name, '', 0) }
  } catch { return null }
}

export async function createSession(env: Env, data: Omit<DashboardSession, 'expiresAt'>): Promise<string> {
  const handle = randomHandle()
  await env.OAUTH_KV.put(`ops:session:${await digest(handle)}`, await seal({
    ...data, expiresAt: Date.now() + SESSION_SECONDS * 1000,
  }, env.COOKIE_ENCRYPTION_KEY), { expirationTtl: SESSION_SECONDS })
  return cookie(SESSION_COOKIE, handle, SESSION_SECONDS)
}

export async function readSession(env: Env, request: Request): Promise<DashboardSession | null> {
  const handle = readCookie(request, SESSION_COOKIE)
  if (!handle || !/^[a-f0-9]{64}$/.test(handle)) return null
  const key = `ops:session:${await digest(handle)}`
  const stored = await env.OAUTH_KV.get(key)
  if (!stored) return null
  try {
    const session = await unseal<DashboardSession>(stored, env.COOKIE_ENCRYPTION_KEY)
    if (session.expiresAt <= Date.now() || !isAllowedUser(session.login, env.GITHUB_ALLOWED_USERS, true)) {
      await env.OAUTH_KV.delete(key)
      return null
    }
    return session
  } catch { return null }
}

export async function destroySession(env: Env, request: Request): Promise<string> {
  const handle = readCookie(request, SESSION_COOKIE)
  if (handle) await env.OAUTH_KV.delete(`ops:session:${await digest(handle)}`)
  return cookie(SESSION_COOKIE, '', 0)
}

export function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin
}

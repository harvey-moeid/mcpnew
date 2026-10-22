import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function validateInstallation(config, toml) {
  const errors = []
  const placeholder = /GANTI_|ganti-/i
  const value = (name) => toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? ''
  for (const name of ['publicOrigin', 'githubOwner', 'githubRepo', 'githubRef', 'workerName']) {
    if (typeof config[name] !== 'string' || !config[name] || placeholder.test(config[name])) {
      errors.push(`installation.json: isi ${name} dengan nilai akun tujuan.`)
    }
  }
  try {
    const url = new URL(config.publicOrigin)
    if (url.protocol !== 'https:' || url.origin !== config.publicOrigin || url.username || url.password) {
      errors.push('publicOrigin harus origin HTTPS tanpa path, slash akhir, query, atau kredensial.')
    }
  } catch { errors.push('publicOrigin bukan URL yang valid.') }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(config.githubOwner ?? '')) errors.push('githubOwner tidak valid.')
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(config.githubRepo ?? '') || config.githubRepo === '..') errors.push('githubRepo tidak valid.')
  if (!/^[A-Za-z0-9_./-]+$/.test(config.githubRef ?? '') || String(config.githubRef ?? '').includes('..')) errors.push('githubRef tidak valid.')
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.workerName ?? '')) errors.push('workerName tidak valid.')
  if (value('name') !== config.workerName) errors.push('Nama Worker pada wrangler.toml harus sama dengan workerName.')
  const active = toml.split('\n').map(line => line.split('#', 1)[0]).join('\n')
  if (placeholder.test(active)) errors.push('wrangler.toml masih memiliki placeholder GANTI_INSTALASI.')
  const kvId = active.match(/^id\s*=\s*"([^"]+)"/m)?.[1] ?? ''
  if (!/^[a-f0-9]{32}$/.test(kvId)) errors.push('Isi id namespace OAUTH_KV dengan 32 digit heksadesimal.')
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value('database_id'))) errors.push('database_id D1 harus UUID.')
  if (!value('GITHUB_ALLOWED_USERS').trim()) errors.push('GITHUB_ALLOWED_USERS wajib diisi untuk instance pribadi.')
  if (value('ALLOW_DIRECT_PUSH_TO_PROTECTED') !== 'false') errors.push('Pertahankan ALLOW_DIRECT_PUSH_TO_PROTECTED="false".')
  const domain = active.match(/^pattern\s*=\s*"([^"]+)"/m)?.[1]
  if (domain && `https://${domain}` !== config.publicOrigin) errors.push('Custom domain harus sama dengan publicOrigin.')
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(new URL('../installation.json', import.meta.url), 'utf8'))
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8')
  const errors = validateInstallation(config, toml)
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`)
    process.exitCode = 1
  } else {
    console.log('PASS: format konfigurasi instalasi konsisten. Akses akun, resource, dan secrets belum diuji.')
  }
}

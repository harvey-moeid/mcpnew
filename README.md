# GitHub Ops MCP Server

Remote MCP server (Cloudflare Worker) yang memberi Claude akses untuk membuat repo,
push commit, buka pull request, dan membaca file — **lewat akun GitHub kamu sendiri
via OAuth**, bukan lewat Personal Access Token yang ditempel di chat.

## Cara Kerja

1. Kamu tambahkan server ini sebagai **custom connector** di Claude
2. Saat pertama connect, Claude membuka layar consent → kamu klik "Continue with GitHub"
3. Kamu login/approve di GitHub (flow OAuth standar, sama seperti "Login with GitHub" di aplikasi lain)
4. Server ini menyimpan token GitHub kamu **terenkripsi di dalam access token OAuth**
   yang dipegang Claude — bukan disimpan sebagai teks di server, dan tidak pernah
   terlihat di percakapan chat
5. Setelah itu, Claude bisa panggil tools: `create_repository`, `push_files`,
   `create_branch`, `list_commits`, `create_pull_request`, `get_file_contents`, `whoami`

## Setup — Langkah demi Langkah

### 1. Buat GitHub OAuth App

1. Buka https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. Isi:
   - **Application name**: `GitHub Ops MCP Server` (bebas)
   - **Homepage URL**: `https://github-mcp-server.<subdomain-kamu>.workers.dev`
   - **Authorization callback URL**: `https://github-mcp-server.<subdomain-kamu>.workers.dev/callback`
     (kamu baru tahu subdomain pastinya setelah deploy pertama kali — bisa diedit lagi nanti)
3. Setelah dibuat, catat **Client ID**, lalu klik **Generate a new client secret** dan catat itu juga

### 2. Buat KV Namespace + D1 Database (lewat Cloudflare Dashboard, tanpa CLI)

**KV** (untuk OAuth):
1. Cloudflare Dashboard → **Workers & Pages → KV → Create namespace**
2. Nama bebas, misal `github-mcp-oauth`
3. Copy **Namespace ID**, paste ke `wrangler.toml` menggantikan `REPLACE_WITH_OAUTH_KV_ID`

**D1** (untuk audit log):
1. Cloudflare Dashboard → **Workers & Pages → D1 → Create database**
2. Nama: `github-mcp-audit-log` (harus sama persis dengan `database_name` di `wrangler.toml`)
3. Copy **Database ID**, paste ke `wrangler.toml` menggantikan `REPLACE_WITH_AUDIT_DB_ID`
4. Setelah deploy pertama (langkah 4 di bawah), jalankan migration:
   ```bash
   npx wrangler d1 migrations apply github-mcp-audit-log --remote
   ```

### 3. Isi Secrets

Secrets **tidak boleh** ditulis di `wrangler.toml` (itu file yang di-commit ke git).
Gunakan `wrangler secret put` dari Codespaces/terminal manapun yang sudah login ke Cloudflare:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY   # generate dengan: openssl rand -hex 32
```

(Opsional) Batasi server ini hanya bisa dipakai akun GitHub tertentu — edit `GITHUB_ALLOWED_USERS`
di `wrangler.toml`, isi username GitHub dipisah koma, misal `"username1,username2"`.

### 4. Deploy

```bash
npm install
npm run deploy
```

Setelah deploy, kamu akan dapat URL seperti `https://github-mcp-server.<subdomain>.workers.dev`.
**Update callback URL di GitHub OAuth App** (langkah 1) kalau subdomain-nya beda dari perkiraan awal.

### 5. Connect ke Claude

1. Buka **claude.ai → Customize → Connectors**
2. Klik **+** → **Add custom connector**
3. **Name**: `GitHub Ops`
4. **URL**: `https://github-mcp-server.<subdomain>.workers.dev/mcp`
5. Klik **Add** — Claude akan otomatis melakukan Dynamic Client Registration ke endpoint `/register`
6. Ikuti flow OAuth (redirect ke halaman consent server ini → lalu ke GitHub → approve)
7. Selesai — di percakapan manapun, aktifkan connector "GitHub Ops" dan Claude bisa langsung push/buat repo

## Tools yang Tersedia

**Read-only** (aman, `readOnlyHint: true`):

| Tool | Fungsi |
|---|---|
| `whoami` | Cek akun GitHub yang sedang terautentikasi |
| `list_repositories` | Lihat semua repo milik user |
| `get_file_contents` | Baca isi file/folder dari repo |
| `list_commits` | Lihat commit terakhir di suatu branch |
| `list_issues` | Lihat daftar issue di repo |

**Write — non-destructive**:

| Tool | Fungsi |
|---|---|
| `create_repository` | Buat repo baru |
| `create_branch` | Buat branch baru dari branch lain |
| `push_files` | Commit banyak file sekaligus dalam satu commit (Git Data API) |
| `create_pull_request` | Buka PR |
| `create_issue` | Buat issue baru |

**Destructive** (`destructiveHint: true`, Claude akan lebih hati-hati/minta konfirmasi):

| Tool | Fungsi |
|---|---|
| `delete_file` | Hapus file dari repo |
| `merge_pull_request` | Merge PR (mengubah history branch, gak bisa di-undo dari sini) |

**Differentiator — gak ada di server GitHub generic manapun**, karena gabungan GitHub + CI/CD kamu sendiri:

| Tool | Fungsi |
|---|---|
| `scaffold_repository` | Buat repo baru **+ isi file awal** dalam satu commit (bukan 2 langkah terpisah) |
| `trigger_workflow` | Jalankan GitHub Actions workflow manual (`workflow_dispatch`) — misal trigger deploy |
| `get_workflow_runs` | Cek status run terakhir suatu workflow (queued/in_progress/success/failure) |
| `deploy_and_push` | Push file **+ langsung trigger deploy workflow** dalam satu panggilan |

⚠️ `trigger_workflow`/`deploy_and_push` butuh workflow target punya trigger `workflow_dispatch:`
di file YAML-nya. Kalau pakai project `my-app` dari percakapan sebelumnya, tambahkan ini ke
`deploy-production.yml`/`deploy-staging.yml`:
```yaml
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:   # <- tambahkan baris ini
```

Setiap tool sudah diberi **annotation** (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) sesuai spesifikasi MCP, supaya Claude tahu tool mana yang aman dijalankan
otomatis vs yang butuh perhatian ekstra.

## Guardrail: Proteksi Branch

`push_files` dan `delete_file` **ditolak otomatis** kalau target branch ada di daftar
`PROTECTED_BRANCHES` (default: `main,master`) di `wrangler.toml`. Ini memaksa alur yang benar:

```
create_branch → push_files (ke branch baru) → create_pull_request → merge_pull_request
```

Kalau memang perlu direct push ke branch protected (biasanya gak disarankan untuk repo tim),
set `ALLOW_DIRECT_PUSH_TO_PROTECTED = "true"` di `wrangler.toml`.

## Audit Log

Setiap tool **write/destructive** (bukan read-only) otomatis tercatat ke database D1
`AUDIT_DB`, tabel `audit_log`: siapa (`actor`), tool apa, ringkasan aksi, berhasil/gagal, kapan.
Query manual:

```bash
npx wrangler d1 execute github-mcp-audit-log --remote \
  --command "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20"
```

## Error Handling

Semua tool dibungkus `withErrorHandling()` (lihat `src/error-handling.ts`) yang menerjemahkan
error GitHub API jadi pesan yang jelas, bukan stack trace mentah:

- `401` → sesi kadaluarsa, minta reconnect
- `403` → ditolak/kena rate limit, tampilkan pesan dari GitHub
- `404` → repo/branch/file tidak ditemukan atau tidak punya akses
- `409` → konflik (biasanya branch reference basi)
- `422` → parameter tidak valid

## CI/CD

Repo ini sudah punya GitHub Actions sendiri (`.github/workflows/`):

- **`ci.yml`** — jalan di tiap PR & push ke `main`: type-check, validasi `wrangler.toml` (dry-run),
  audit dependency, scan secret bocor
- **`deploy.yml`** — auto-deploy ke Cloudflare Workers saat push ke `main` (hanya kalau file
  `src/`, `wrangler.toml`, atau `package.json` berubah), pakai environment `production` dengan
  approval gate opsional (aktifkan di GitHub → Settings → Environments)
- **`dependabot.yml`** — update dependency npm & GitHub Actions mingguan otomatis

Secrets yang perlu ditambahkan di GitHub repo settings supaya `deploy.yml` bisa jalan:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

(Ini terpisah dari secret `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`COOKIE_ENCRYPTION_KEY`
yang di-set langsung ke Worker lewat `wrangler secret put`, bukan lewat GitHub Actions.)

## Keamanan

- Token GitHub kamu **tidak pernah** diketik di chat atau disimpan sebagai plaintext di server
- Scope OAuth yang diminta: `repo` (akses baca/tulis repo) dan `read:user`
- Kalau mau cabut akses: GitHub → **Settings → Applications → Authorized OAuth Apps** →
  cabut akses "GitHub Ops MCP Server" kapan saja
- Untuk multi-user/production sungguhan, pertimbangkan menambah rate limiting dan audit log
  di `github-handler.ts` (lihat pattern rate limiting yang sudah dipakai di project `my-app`)

## Development Lokal

```bash
cp .dev.vars.example .dev.vars   # isi dengan client ID/secret dari OAuth App terpisah untuk testing
npm run dev
```

`wrangler dev` akan jalan di `http://localhost:8787`. Untuk testing OAuth lokal, buat
GitHub OAuth App kedua dengan callback URL `http://localhost:8787/callback`.

# GitHub Ops MCP Server

Remote MCP server (Cloudflare Worker) yang memberi Claude akses untuk membuat repo,
push commit, buka pull request, membaca file, mengelola R2, dan memicu deploy —
lewat akun GitHub kamu sendiri via OAuth, bukan lewat Personal Access Token yang
ditempel di chat.

## Cara Kerja

1. Kamu tambahkan server ini sebagai **custom connector** di Claude
2. Saat pertama connect, Claude membuka layar consent — kamu klik "Continue with GitHub"
3. Kamu login/approve di GitHub (flow OAuth standar, sama seperti "Login with GitHub" di aplikasi lain)
4. Token GitHub dibawa sebagai props sesi OAuth yang dikelola oleh provider.
   Token tidak ditampilkan di percakapan chat. Dashboard memiliki sesi terpisah
   dengan token terenkripsi di KV.
5. Setelah itu, Claude bisa memanggil tools yang tersedia (lihat tabel di bawah)

## Dashboard pribadi

Buka **https://mcpnew.muidsoft.com/dashboard** atau halaman utama, kemudian pilih
**Masuk dengan GitHub**. Dashboard menggunakan OAuth App dan callback `/callback`
yang sama dengan konektor MCP; tidak diperlukan PAT atau callback tambahan.

- **Ringkasan:** jumlah repo yang sudah dimuat, hingga 30 PR terbuka terbaru pada
  repo pilihan, pemeriksaan gagal, Actions, deployment Worker, dan audit terbaru.
- **Repositori:** pencarian, filter publik/privat/arsip, pagination, dan pemilihan repo.
- **Pull requests:** gabungan GitHub check runs dan commit statuses pada head PR;
  filter status, draft, dan tautan review langsung ke GitHub. Status tidak tersedia
  ditampilkan sebagai belum diketahui, bukan lolos.
- **Deployment:** hingga 20 deployment Worker `github-mcp-server`, versi dan traffic rollout.
- **Aktivitas:** audit D1 milik akun yang masuk, pagination, dan filter error. Audit
  tetap best-effort sesuai perilaku tool MCP; daftar kosong bukan bukti tidak ada aksi.
- **Koneksi & akses:** sesi, salin URL MCP, konfigurasi Cloudflare, dan status direct push.
- Tema gelap/terang, navigasi mobile, dan shortcut `/` untuk mencari repo.

Data privat hanya tersedia setelah login. Dashboard tidak menyediakan tombol merge,
deploy, atau hapus: tindakan tersebut dibuka di GitHub atau dilakukan lewat tool MCP.
Tidak ada token yang dikirim ke JavaScript dashboard atau disimpan di localStorage.

### Autentikasi dashboard

`GITHUB_ALLOWED_USERS` wajib berisi allowlist untuk login dashboard. Konfigurasi kosong
menolak login dashboard. Secrets yang sudah dipakai MCP juga diperlukan:
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, dan `COOKIE_ENCRYPTION_KEY`.

Sesi browser memakai cookie `__Host-ops_session` (HttpOnly, Secure, SameSite=Lax)
dan berlaku delapan jam. Token GitHub disimpan terenkripsi AES-GCM di `OAUTH_KV`
dengan key berdasarkan hash session handle. Logout menghapus sesi; perubahan allowlist
diperiksa pada setiap permintaan. Rotasi `COOKIE_ENCRYPTION_KEY` membatalkan sesi lama.
KV memiliki konsistensi eventual, sehingga penghapusan dapat membutuhkan waktu untuk
terpropagasi di lokasi lain; jangan menganggap logout sebagai pencabutan token GitHub.
Untuk pencabutan menyeluruh, cabut OAuth App dari pengaturan GitHub.

State consent/login berupa handle acak, terikat ke cookie browser, terenkripsi di KV,
dan kedaluwarsa setelah sepuluh menit. State dihapus sebelum pertukaran kode GitHub
(kode GitHub sendiri sekali pakai). Tombol Cancel mengembalikan `access_denied` ke klien.
Alur login yang masih berjalan saat deploy perubahan ini harus dimulai kembali.

Deployment memerlukan secrets Cloudflare yang sudah dijelaskan di bawah. Tanpa koneksi
tersebut, dashboard tetap berjalan dan menampilkan status belum dikonfigurasi. Jika audit
belum dapat dibaca, pastikan migration D1 `0001_create_audit_log.sql` sudah diterapkan.

### Pemeriksaan sebelum rilis

```bash
npm ci
npm test
npm run type-check
npm audit --audit-level=high
npx wrangler deploy --dry-run
```

Tes mencakup isolasi sesi dan allowlist, enkripsi token, state browser/expiry,
callback palsu, Cancel, alur MCP, validasi API, dan pembatasan audit per pengguna.
Setelah deploy, cek `/`, `/dashboard`, discovery OAuth, dan `/mcp` tanpa token (`401`),
kemudian uji login GitHub serta satu operasi MCP dengan akun yang diizinkan.

## Setup — Langkah demi Langkah

### 1. Buat GitHub OAuth App

1. Buka https://github.com/settings/developers — **OAuth Apps** — **New OAuth App**
2. Isi:
   - **Application name**: `GitHub Ops MCP Server` (bebas)
   - **Homepage URL**: `https://mcpnew.muidsoft.com`
   - **Authorization callback URL**: `https://mcpnew.muidsoft.com/callback`
     (sesuaikan domain dan `resourceMetadata.resource` jika menggunakan instalasi lain)
3. Setelah dibuat, catat **Client ID**, lalu klik **Generate a new client secret** dan catat itu juga

### 2. Buat KV Namespace + D1 Database (lewat Cloudflare Dashboard, tanpa CLI)

**KV** (untuk OAuth + memory notes/default repo):
1. Cloudflare Dashboard — **Workers & Pages — KV — Create namespace**
2. Nama bebas, misal `github-mcp-oauth`
3. Copy **Namespace ID**, paste ke `wrangler.toml` menggantikan `REPLACE_WITH_OAUTH_KV_ID`

**D1** (untuk audit log):
1. Cloudflare Dashboard — **Workers & Pages — D1 — Create database**
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

### 3b. (Opsional) Aktifkan `get_worker_deployment_status` (Cloudflare)

Tool ini mengecek status deploy Worker langsung dari Cloudflare API (versi yang live,
strategi rollout/persentase gradual deployment, kapan terakhir deploy) — terpisah dari
status GitHub Actions workflow.

1. Buat API Token: Cloudflare Dashboard — **My Profile — API Tokens — Create Token**
   — gunakan template **"Edit Cloudflare Workers"** atau buat custom token dengan minimal
   permission **Account — Workers Scripts — Read**
2. Catat **Account ID** (terlihat di sidebar kanan halaman overview domain/account Cloudflare)
3. Set sebagai secret di Worker ini (bukan cuma di GitHub Actions):
   ```bash
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
   ```

Tanpa dua secret ini, tool `get_worker_deployment_status` akan menolak jalan dengan
pesan error yang jelas (bukan crash), tool lain tidak terpengaruh. Secret yang sama
ini juga dipakai oleh tool-tool R2 (`list_r2_objects`, `get_r2_object`, `put_r2_object`,
`delete_r2_object`) — token perlu scope **R2:Read**/**R2:Write** kalau mau tool R2 dipakai.

### 4. Deploy

```bash
npm install
npm run deploy
```

Setelah deploy, kamu akan dapat URL seperti `https://mcpnew.muidsoft.com`.
**Update callback URL di GitHub OAuth App** (langkah 1) kalau subdomain-nya beda dari perkiraan awal.

### 5. Connect ke Claude

1. Buka **claude.ai — Customize — Connectors**
2. Klik **+** — **Add custom connector**
3. **Name**: `GitHub Ops`
4. **URL**: `https://mcpnew.muidsoft.com/mcp`
5. Klik **Add** — Claude akan otomatis melakukan Dynamic Client Registration ke endpoint `/register`
6. Ikuti flow OAuth (redirect ke halaman consent server ini — lalu ke GitHub — approve)
7. Selesai — di percakapan manapun, aktifkan connector "GitHub Ops" dan Claude bisa langsung push/buat repo

## Tools yang Tersedia

**Memory / konteks lintas sesi** (tersimpan di KV `OAUTH_KV`, per-user):

| Tool | Fungsi |
|---|---|
| `set_note` | Simpan catatan persisten (key-value, multi-line) |
| `get_note` | Baca satu catatan berdasarkan nama |
| `list_notes` | Lihat semua catatan tersimpan |
| `delete_note` | Hapus satu catatan |
| `set_default_repo` | Set owner/repo default supaya gak perlu ketik ulang tiap panggilan |
| `get_default_repo` | Lihat default repo yang sedang aktif |

**Read-only** (aman, `readOnlyHint: true`):

| Tool | Fungsi |
|---|---|
| `whoami` | Cek akun GitHub yang sedang terautentikasi |
| `list_repositories` | Lihat semua repo milik user |
| `get_file_contents` | Baca isi file/folder dari repo |
| `list_commits` | Lihat commit terakhir di suatu branch |
| `list_issues` | Lihat daftar issue di repo |
| `list_pull_requests` | Lihat daftar pull request di repo |
| `get_pull_request` | Lihat detail lengkap satu pull request |
| `search_code` | Cari pattern kode/nama file lintas repo |
| `repo_summary` | Ringkasan cepat: branch, open PR, open issue, commit terakhir, status workflow |
| `get_audit_log` | Query log D1 semua pemanggilan tool write/destructive |
| `list_branches` | Lihat semua branch di repo |
| `get_workflow_runs` | Cek status run terakhir suatu GitHub Actions workflow |
| `wait_for_workflow` | Tunggu sampai satu workflow run selesai, lalu laporkan hasilnya |
| `get_worker_deployment_status` | **(Cloudflare)** Cek versi live, strategi rollout, waktu deploy terakhir Worker ini |
| `list_r2_objects` | **(R2)** List object dalam satu bucket R2 |
| `get_r2_object` | **(R2)** Baca isi satu object R2 (cocok untuk file teks) |
| `smoke_test` | **(v1.7.0)** GET ke URL, cek status code vs expected, laporkan OK/FAIL + waktu tempuh |
| `get_pr_preview_url` | **(v1.7.0)** Ambil URL preview Cloudflare Pages dari nomor PR |

**Write — non-destructive**:

| Tool | Fungsi |
|---|---|
| `create_repository` | Buat repo baru |
| `create_branch` | Buat branch baru dari branch lain |
| `push_files` | Commit banyak file sekaligus dalam satu commit (Git Data API) |
| `create_pull_request` | Buka PR |
| `create_issue` | Buat issue baru |
| `rename_file` | Rename/pindah file dalam satu commit atomik |
| `scaffold_repository` | Buat repo baru + isi file awal dalam satu commit |
| `trigger_workflow` | Jalankan GitHub Actions workflow manual (`workflow_dispatch`) |
| `deploy_and_push` | Push file + langsung trigger deploy workflow dalam satu panggilan |
| `put_r2_object` | **(R2)** Tulis/timpa isi satu object R2 |
| `rerun_workflow` | **(v1.7.0)** Re-run workflow run yang gagal tanpa commit baru (support `failed_jobs_only`) |

**Destructive** (`destructiveHint: true`, Claude akan lebih hati-hati/minta konfirmasi):

| Tool | Fungsi |
|---|---|
| `delete_note` | Hapus catatan permanen |
| `delete_branch` | Hapus branch (branch protected otomatis ditolak) |
| `delete_file` | Hapus file dari repo |
| `merge_pull_request` | Merge PR (mengubah history branch, gak bisa di-undo dari sini) |
| `delete_r2_object` | **(R2)** Hapus satu object dari bucket |

Setiap tool sudah diberi **annotation** (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) sesuai spesifikasi MCP, supaya Claude tahu tool mana yang aman dijalankan
otomatis vs yang butuh perhatian ekstra.

## Guardrail: Proteksi Branch

`push_files` dan `delete_file` **ditolak otomatis** kalau target branch ada di daftar
`PROTECTED_BRANCHES` (default: `main,master`) di `wrangler.toml`. Ini memaksa alur yang benar:

```
create_branch -> push_files (ke branch baru) -> create_pull_request -> merge_pull_request
```

Kalau memang perlu direct push ke branch protected (biasanya gak disarankan untuk repo tim),
set `ALLOW_DIRECT_PUSH_TO_PROTECTED = "true"` di `wrangler.toml`.

> **Status di repo ini:** `ALLOW_DIRECT_PUSH_TO_PROTECTED = "false"`. Gunakan branch fitur dan pull request untuk perubahan ke `main`.

## Audit Log

Setiap tool **write/destructive** (bukan read-only) otomatis tercatat ke database D1
`AUDIT_DB`, tabel `audit_log`: siapa (`actor`), tool apa, ringkasan aksi, berhasil/gagal, kapan.
Query manual:

```bash
npx wrangler d1 execute github-mcp-audit-log --remote \
  --command "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20"
```

Bisa juga lewat tool `get_audit_log` langsung dari chat (filter by `actor`/`tool`/`errors_only`).

Tool read-only (termasuk `get_worker_deployment_status` dan semua tool R2 yang bersifat baca)
tidak mencatat ke audit log ini.

## Error Handling

Semua tool dibungkus `withErrorHandling()` (lihat `src/error-handling.ts`) yang menerjemahkan
error GitHub API dan Cloudflare API jadi pesan yang jelas, bukan stack trace mentah:

**GitHub:**
- `401` — sesi kadaluarsa, minta reconnect
- `403` — ditolak/kena rate limit, tampilkan pesan dari GitHub
- `404` — repo/branch/file tidak ditemukan atau tidak punya akses
- `409` — konflik (biasanya branch reference basi)
- `422` — parameter tidak valid

**Cloudflare** (dipakai oleh `get_worker_deployment_status` dan tool-tool R2, lihat `src/cloudflare.ts`):
- `401` — `CLOUDFLARE_API_TOKEN` belum di-set/invalid/expired
- `403` — token tidak punya permission yang dibutuhkan (`Workers Scripts:Read` atau `R2:Read`/`R2:Write`)
- `404` — nama script Worker/bucket salah, atau `CLOUDFLARE_ACCOUNT_ID` salah

## CI/CD

Repo ini sudah punya GitHub Actions sendiri (`.github/workflows/`):

- **`ci.yml`** — jalan di tiap PR & push ke `main`: type-check, validasi `wrangler.toml` (dry-run),
  audit dependency, scan secret bocor
- **`deploy.yml`** — auto-deploy ke Cloudflare Workers saat push ke `main` (hanya kalau file
  `src/`, `wrangler.toml`, atau `package.json` berubah), pakai environment `production` dengan
  approval gate opsional (aktifkan di GitHub — Settings — Environments)
- **`dependabot.yml`** — update dependency npm & GitHub Actions mingguan otomatis

Secrets yang perlu ditambahkan di GitHub repo settings supaya `deploy.yml` bisa jalan:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

(Ini terpisah dari secret `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`COOKIE_ENCRYPTION_KEY`
dan dari secret `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` di langkah 3b, yang di-set
langsung ke Worker lewat `wrangler secret put`, bukan lewat GitHub Actions. Kamu bisa memakai
token Cloudflare yang sama di kedua tempat kalau scope-nya mencakup keduanya, tapi keduanya
harus di-set terpisah karena GitHub Actions secrets dan Worker secrets adalah dua sistem yang berbeda.)

Kalau `trigger_workflow`/`deploy_and_push` mau dipakai, workflow target harus punya trigger
`workflow_dispatch:` di file YAML-nya, misal:
```yaml
on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:   # <- tambahkan baris ini
```

## Keamanan

- Token GitHub kamu **tidak pernah** diketik di chat atau disimpan sebagai plaintext di server
- Scope OAuth yang diminta: `repo` (akses baca/tulis repo), `read:user`, dan `workflow`
- Token Cloudflare untuk `get_worker_deployment_status`/tool R2 sebaiknya dibuat scoped
  (**Workers Scripts:Read** + **R2:Read**/**R2:Write** sesuai kebutuhan), bukan Global API Key
- Kalau mau cabut akses: GitHub — **Settings — Applications — Authorized OAuth Apps** —
  cabut akses "GitHub Ops MCP Server" kapan saja
- Untuk multi-user/production sungguhan, pertimbangkan menambah rate limiting di `github-handler.ts`

## Development Lokal

```bash
cp .dev.vars.example .dev.vars   # isi dengan client ID/secret dari OAuth App terpisah untuk testing
npm run dev
```

`wrangler dev` akan jalan di `http://localhost:8787`. Untuk testing OAuth lokal, buat
GitHub OAuth App kedua dengan callback URL `http://localhost:8787/callback`.


## Operation safety and deployment

Repository write tools require explicit `owner` and `repo`; saved defaults apply only to reads.
Destructive tools require `confirm` equal to the exact target described by each tool. This is a server-side target check, not proof of human approval; clients must still obtain user authorization.
Examples: `owner/repo@branch` for branch deletion, `owner/repo@branch:path` for file deletion,
`owner/repo#123` for PR merge, and the exact resource ID/name for namespace/database/Worker/bucket deletion.

`deploy_and_push` requires an explicit branch. With `wait: true`, it tracks a workflow_dispatch run for the pushed commit and dispatch time. An optional `smoke_test_url` runs only after workflow success; `expected_text` checks response content. A timeout does not cancel or revert the deployment. Push and dispatch are separate GitHub operations; dispatch failure does not undo the commit.
`wait_for_workflow` requires `run_id` or `commit_sha` so an old run cannot accidentally report success.
`smoke_test` supports bounded retries, response text matching (first 1 MiB), and attempt timings.

`worker_rollback` deploys an explicitly selected existing version to all traffic, requiring confirmation of `script_name:version_id`. It does not revert GitHub commits, D1/KV data, migrations, or other external changes; no automatic rollback is attempted.
`cloudflare_token_verify` supports user/account token types and reports validity/expiry, not a complete permission inventory.
Pages list tools expose explicit page selection; requests default to page 1 with 10 results.

Compatibility changes: refresh/reconnect MCP tool discovery after updating the server. Existing calls to write tools must now include the explicit repository and destructive confirmations. PR merges also require `expected_head_sha` from the reviewed PR, so a changed PR cannot be merged accidentally. Audit reads are restricted to the signed-in actor and support `before_id` pagination; secret values and D1 SQL/parameters are omitted from audit summaries. Audit persistence remains best effort.

`worker_list` accepts an optional `script_name` for custom domains, binding names/types, cron schedules and latest deployment metadata. Missing API permissions produce an `unavailable` list while preserving other metadata. Zone-based Worker routes are not included. `get_worker_deployment_status` includes recent version IDs for explicit rollback.
GitHub lists support `page`; notes use `cursor`; KV/D1/zone/DNS lists support `page`; R2 bucket lists use `start_after`. Workers script listing has no page parameter in the current Cloudflare API spec.

Validation uses mocked API responses and the registered tool handlers. A real-account reproduction is still needed to confirm the original Pages 400; support for `page`/`per_page` is documented by Cloudflare, so pagination alone does not prove its cause.


## BYGA Agent Skills

`mcpnew` supports the bundled `byga-coding-engineering` and `byga-tiktok-creative-studio` skill packages plus user-scoped GitHub imports. Available MCP tools: `list_skills`, `get_skill_instructions`, `read_skill_file`, `install_skill_from_github`, `set_skill_enabled`, and `uninstall_skill` (with confirmation). You can also invoke the `use-skill` MCP prompt where supported by the client. See [docs/SKILLS.md](docs/SKILLS.md) for setup, examples and security limitations.

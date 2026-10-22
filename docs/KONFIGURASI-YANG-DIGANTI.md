# Konfigurasi yang perlu diganti

Penanda: cari `GANTI_INSTALASI`. Placeholder menggunakan bentuk `GANTI_...` atau `ganti-...`. Jangan melakukan replace global pada seluruh repository: username/domain di test adalah fixture, dan dokumen skill dapat berisi contoh historis.

## 1. `installation.json` — identitas aplikasi, tanpa secret

| Kolom | Isi dengan | Contoh fiktif |
| --- | --- | --- |
| `publicOrigin` | Origin HTTPS utama, tanpa slash akhir, path, atau query | `https://mcp-pribadi.contoh-subdomain.workers.dev` |
| `githubOwner` | Username/organisasi pemilik repo BARU | `akun-baru` |
| `githubRepo` | Nama repo BARU yang berisi seluruh folder `skills/` | `mcp-pribadi` |
| `githubRef` | Branch sumber skill; sama dengan branch utama CI | `main` |
| `workerName` | Nama Worker BARU, sama dengan `name` di Wrangler | `mcp-pribadi` |

OAuth resource URL, tautan dashboard, pilihan repo awal, sumber seluruh built-in skill, serta target deployment dashboard mengambil nilainya dari file ini. Tidak perlu mengganti kode TypeScript satu per satu.

## 2. `wrangler.toml` — resource Cloudflare dan akses pribadi

| Bagian | Nilai yang diganti | Sumber nilai |
| --- | --- | --- |
| `name` | Nama Worker baru | Samakan dengan `installation.workerName` |
| `kv_namespaces.id` | ID namespace KV BARU | Output `wrangler kv namespace create OAUTH_KV` |
| `d1_databases.database_name` | Nama D1 baru | Nama yang dipilih saat `wrangler d1 create` |
| `d1_databases.database_id` | UUID database BARU | Output perintah pembuatan D1 |
| `vars.GITHUB_ALLOWED_USERS` | Username akun yang boleh login | Username GitHub akun pribadi tujuan |
| `routes.pattern` | Opsional: hostname custom domain | DNS/domain di akun Cloudflare tujuan |

Gunakan resource baru walaupun akun Cloudflare tetap sama. Menggunakan ulang KV lama akan mencampur data OAuth, notes, dan registrasi skill kedua instance.

Pertahankan binding `MCP_OBJECT`, `OAUTH_KV`, `AUDIT_DB`, class `MyMCP`, dan konfigurasi migrasi Durable Object. Nama-nama itu adalah kontrak kode. `PROTECTED_BRANCHES="main,master"` dan `ALLOW_DIRECT_PUSH_TO_PROTECTED="false"` disarankan tetap.

`compatibility_date` bukan identitas akun; tidak perlu diganti untuk migrasi ini. Perbarui terpisah setelah tes kompatibilitas. Nama paket di `package.json`, nama tampilan MCP, judul UI, dan nama skill bersifat kosmetik atau API; boleh dipertahankan.

## 3. Secrets — dibuat ulang, tidak dimasukkan ke ZIP

| Lokasi | Nama | Keterangan |
| --- | --- | --- |
| Worker | `GITHUB_CLIENT_ID` | Client ID OAuth App BARU |
| Worker | `GITHUB_CLIENT_SECRET` | Client secret OAuth App BARU |
| Worker | `COOKIE_ENCRYPTION_KEY` | Nilai acak BARU, minimal 32 byte |
| Worker | `CLOUDFLARE_API_TOKEN` | Opsional untuk tool Cloudflare; batasi akun/izin sesuai kebutuhan |
| Worker | `CLOUDFLARE_ACCOUNT_ID` | Opsional, pasangan token tool Cloudflare |
| Worker | `BRAVE_API_KEY` | Opsional untuk `web_search` |
| GitHub environment `production` | `CLOUDFLARE_API_TOKEN` | Token deployment CI di akun tujuan |
| GitHub environment `production` | `CLOUDFLARE_ACCOUNT_ID` | ID akun Cloudflare tempat CI deploy |

Secrets dengan nama sama pada Worker dan GitHub Actions adalah pengaturan TERPISAH. Token CI tidak otomatis tersedia bagi tool MCP. Token Worker juga tidak otomatis tersedia bagi GitHub Actions.

## 4. Konfigurasi di luar source code

- GitHub OAuth App: Homepage URL = `publicOrigin`, callback = `publicOrigin` + `/callback`.
- GitHub repo: environment `production`, Actions aktif, branch utama `main`.
- MCP connector: endpoint `publicOrigin` + `/mcp`; hubungkan dan login ulang.
- Custom domain opsional: domain harus berada di akun Cloudflare yang tepat; ubah `publicOrigin` dan callback bersamaan.

Jalankan `npm run check:installation` setelah mengedit. Pemeriksaan ini memeriksa format dan konsistensi lokal; tidak membuktikan resource, domain, OAuth App, atau secret sudah benar-benar tersedia.

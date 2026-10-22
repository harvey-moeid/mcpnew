# Deploy MCP pribadi: GitHub Actions + dashboard Cloudflare

Deploy source aplikasi dilakukan oleh **GitHub Actions**. Pembuatan resource, API token, secrets, dan pemeriksaan Cloudflare dilakukan melalui **dashboard web Cloudflare**. Tidak perlu memasang Node.js, npm, atau Wrangler di komputer untuk mengikuti panduan ini; workflow menjalankan alat tersebut otomatis.

Paket ini untuk **repository dan instance baru**. Branch `export/private-mcp-portable` hanya sumber unduhan ZIP. Jangan membuka PR dari branch itu ke `main` instance lama.

## 1. Buat repo GitHub baru

Login ke akun GitHub tujuan → **New repository** → pilih nama dan visibilitas. Boleh centang **Add a README file** agar branch utama langsung tersedia. Gunakan branch utama **`main`**. Catat username pemilik dan nama repo; upload source setelah konfigurasi/secrets di langkah berikut siap.

## 2. Catat akun Cloudflare dan alamat Worker

1. Buka [dashboard Cloudflare](https://dash.cloudflare.com), lalu pilih akun tujuan.
2. Catat **Account ID** dari halaman akun/Workers & Pages.
3. Buka **Workers & Pages**, lihat **Your subdomain** untuk alamat workers.dev akun. Jika belum tersedia, atur subdomain melalui dashboard.
4. Pilih nama Worker baru, misalnya `mcp-pribadi`.
5. Alamat instance menjadi `https://NAMA_WORKER.SUBDOMAIN_AKUN.workers.dev`. Gunakan nama Worker dan subdomain akun yang sebenarnya.

Tidak perlu mengimpor repo ke Cloudflare Builds. GitHub Actions akan membuat Worker sesuai `wrangler.toml` saat deploy pertama. Gunakan workers.dev untuk setup awal.

## 3. Buat namespace KV melalui dashboard

1. Buka **Workers KV** pada akun tujuan.
2. Pilih **Create instance** atau tombol pembuatan namespace.
3. Isi nama baru, misalnya `mcp-pribadi-oauth`, lalu buat.
4. Salin **Namespace ID**.

Nama resource bebas; nama binding kode tetap **`OAUTH_KV`**. GitHub Actions memasang binding dari `wrangler.toml` saat deploy.

## 4. Buat D1 dan tabel audit melalui dashboard

1. Buka **D1 SQL database → Create database**.
2. Isi nama baru, misalnya `mcp-pribadi-audit`; catat nama dan **Database ID**.
3. Buka database → **Console**.
4. Salin **seluruh isi** file `migrations/0001_create_audit_log.sql` dari ZIP ke Console, lalu pilih **Execute**. Bila Console meminta satu statement per eksekusi, jalankan setiap statement berurutan.
5. Pastikan tab Tables menampilkan `audit_log`. Query baca untuk pemeriksaan:

```sql
SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_log';
```

Binding kode tetap **`AUDIT_DB`**. Gunakan KV dan D1 baru agar sesi/data instance lama terpisah. Workflow tidak menerapkan migrasi D1 otomatis. Eksekusi SQL melalui Console juga tidak mencatat riwayat migrasi Wrangler; jangan menganggap riwayat CLI sudah terisi.

## 5. Buat token deploy di dashboard Cloudflare

1. Buka **Account API tokens → Create Token**.
2. Pilih template **Edit Cloudflare Workers**.
3. Batasi cakupan ke akun tujuan dan pastikan token dapat men-deploy Worker serta mengakses binding yang dipakai.
4. Buat token dan simpan dengan aman; nilainya biasanya hanya ditampilkan sekali.

Untuk workers.dev, jangan menambahkan zone/domain yang tidak dipakai. Sesuaikan izin jika nanti menggunakan custom domain. Jangan menempel token ke source code.

## 6. Isi secrets deployment di GitHub

Repo baru → **Settings → Secrets and variables → Actions → Repository secrets → New repository secret**.

| Nama | Nilai |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token deploy dari langkah 5 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID Cloudflare tujuan |

Workflow portabel ini menggunakan **Repository secrets**. Tidak perlu membuat environment `production`; ini berbeda dari pengaturan instance lama. Aktifkan GitHub Actions pada repo jika belum aktif.

## 7. Isi konfigurasi yang ditandai

Ekstrak ZIP dan edit file dengan editor teks. Anda juga bisa mengedit melalui GitHub web/GitHub.dev sebelum membuat commit source.

**`installation.json`**:

| Kolom | Nilai |
| --- | --- |
| `publicOrigin` | Alamat HTTPS dari langkah 2, tanpa `/` di akhir |
| `githubOwner` | Username/organisasi pemilik repo baru |
| `githubRepo` | Nama repo baru |
| `githubRef` | `main` |
| `workerName` | Nama Worker baru |

**`wrangler.toml`**:

| Kolom | Nilai |
| --- | --- |
| `name` | Sama dengan `workerName` |
| `kv_namespaces.id` | Namespace ID dari dashboard KV |
| `d1_databases.database_name` | Nama D1 baru |
| `d1_databases.database_id` | Database ID dari dashboard D1 |
| `vars.GITHUB_ALLOWED_USERS` | Username GitHub akun pribadi yang boleh login |

Cari penanda **`GANTI_INSTALASI`**. Ganti semua placeholder `GANTI_...` dan `ganti-...` pada konfigurasi aktif. Penanda pada komentar, template `.example`, dan dokumen boleh tetap ada.

Pertahankan `MCP_OBJECT`, `MyMCP`, `OAUTH_KV`, `AUDIT_DB`, blok migrasi Durable Object, dan `ALLOW_DIRECT_PUSH_TO_PROTECTED="false"`. Resource dibuat melalui dashboard; binding akan terpasang otomatis dari file konfigurasi saat Action men-deploy.

## 8. Upload source ke repo baru

1. Repo GitHub → **Add file → Upload files**.
2. Upload **isi folder** yang memuat `package.json`, bukan ZIP atau folder pembungkusnya. `package.json`, `installation.json`, dan `wrangler.toml` harus berada di root repo.
3. Pastikan `.github/workflows/` ikut terunggah. Tampilkan hidden files bila perlu, atau buka editor web **GitHub.dev** dengan menekan titik (`.`) pada halaman repo dan buat/upload file workflow sesuai path-nya.
4. Sertakan `src/`, `skills/`, `scripts/`, `migrations/`, `tests/`, dan `package-lock.json`. Jangan upload token, `.env`, `.dev.vars`, atau isi database.
5. Simpan commit ke **`main`**.

Upload ke `main` menjalankan CI dan Deploy. Placeholder yang belum diisi akan ditolak oleh pemeriksaan konfigurasi sebelum unggah Worker.

## 9. Deploy melalui GitHub Actions

1. Buka **Actions → Deploy** pada repo baru.
2. Periksa run yang dipicu commit. Untuk menjalankan ulang secara manual, pilih **Run workflow → branch main → Run workflow**.
3. Tunggu instalasi, tes, TypeScript, audit dependency, pemeriksaan konfigurasi, deploy, dan verifikasi endpoint berhasil.
4. Buka dashboard Cloudflare → **Workers & Pages**. Worker yang namanya diisi akan muncul.
5. Cocokkan URL sebenarnya dengan `publicOrigin`. Bila berbeda, edit `installation.json` di GitHub lalu commit ke `main` untuk deploy ulang.

Deploy pertama membuat Worker beserta binding. **Login belum siap sampai secrets runtime pada langkah 10 diisi.** Smoke test awal memeriksa endpoint publik dan penolakan akses anonim, bukan login OAuth.

Jangan mengaktifkan Cloudflare Builds/auto-build dari repo untuk target yang sama. Pembaruan source aplikasi tetap melalui GitHub Actions.

## 10. Buat OAuth App dan isi secrets Worker melalui web

### OAuth App di GitHub

Akun GitHub tujuan → **Settings → Developer settings → OAuth Apps → New OAuth App**.

| Pengaturan | Nilai |
| --- | --- |
| Homepage URL | `publicOrigin` yang sudah cocok dengan Worker |
| Authorization callback URL | `publicOrigin` diikuti `/callback` |

Buat Client Secret baru. App meminta scope `repo`, `read:user`, dan `workflow`. Batasi login instance pribadi dengan allowlist akun Anda.

### Secrets runtime di Cloudflare

1. **Workers & Pages → nama Worker → Settings → Variables and Secrets → Add**.
2. Pilih tipe **Secret** dan isi:

| Nama secret Worker | Nilai |
| --- | --- |
| `GITHUB_CLIENT_ID` | Client ID OAuth App baru |
| `GITHUB_CLIENT_SECRET` | Client Secret OAuth App baru |
| `COOKIE_ENCRYPTION_KEY` | Nilai acak kriptografis baru, minimal 32 byte |

3. Buat key acak dengan password manager/generator aman; jangan menggunakan key instance lama atau layanan pembuat key yang tidak dipercaya.
4. Klik **Deploy** pada form secrets untuk menerapkan konfigurasi. Tombol ini menerapkan perubahan secret; source aplikasi tetap berasal dari GitHub Actions.

Opsional: tambahkan `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` pada **Worker** untuk tool Cloudflare; batasi token runtime sesuai layanan yang digunakan. Tambahkan `BRAVE_API_KEY` untuk `web_search`.

Secrets bernama sama pada GitHub dan Worker adalah dua penyimpanan terpisah. Mengisi secrets GitHub tidak mengisi secrets runtime Worker. Secrets yang disimpan melalui dashboard tetap dipertahankan pada deploy kode Wrangler berikutnya; jangan memasukkan nilainya ke `[vars]`.

## 11. Verifikasi login dan MCP

1. Buka `publicOrigin` → **Masuk dengan GitHub** dengan akun yang diizinkan.
2. Pastikan callback kembali ke dashboard.
3. Tambahkan connector MCP pada aplikasi AI dengan endpoint **`publicOrigin` + `/mcp`**, lalu login dan setujui koneksi.
4. Jalankan `list_skills` dan `get_skill_instructions` untuk `byga-cloudflare-fullstack`. Sumber skill harus repo baru.
5. Uji baca satu file repo yang dapat diakses akun baru. Uji tulis hanya pada repo/branch percobaan bila diperlukan.
6. Gunakan dashboard Cloudflare → Worker → **Deployments/Observability** untuk memeriksa deployment dan error. Periksa audit dashboard MCP setelah tindakan tulis.

`/mcp` yang dibuka tanpa token dan mengembalikan `401` adalah perilaku yang benar. CI/smoke test hijau tidak menggantikan verifikasi login, izin, dan tool akun sebenarnya.

## 12. Pembaruan, rollback, dan domain

- Ubah source di GitHub, gunakan PR/CI, lalu merge ke `main` untuk deploy otomatis. Untuk mengulang deploy, gunakan Actions → Deploy → Run workflow → main.
- Cloudflare dashboard digunakan untuk secrets, resource, observability, dan domain. Nilai non-secret yang dikelola `wrangler.toml` sebaiknya diubah melalui repo agar konsisten saat deploy berikutnya.
- Untuk rollback source, gunakan **Revert** pada PR yang di-merge, tinjau PR revert, lalu merge agar Actions men-deploy kode tersebut. Periksa kompatibilitas database terlebih dahulu; rollback kode tidak membatalkan perubahan data.
- Untuk schema D1, buat backup melalui fasilitas dashboard yang tersedia sebelum perubahan, lalu jalankan SQL yang diperlukan di Console.
- Untuk custom domain, siapkan domain/route dan cocokkan `publicOrigin`, OAuth Homepage URL, callback URL, serta endpoint connector. Gunakan satu alamat utama secara konsisten.

## Troubleshooting

| Gejala | Perbaikan melalui web |
| --- | --- |
| Deploy/Run workflow tidak muncul | Pastikan `.github/workflows/deploy.yml` ada di branch default `main` dan Actions aktif |
| Job Deploy dilewati | Pilih branch `main`; workflow tidak men-deploy branch lain |
| Pemeriksaan konfigurasi gagal | Edit dua file konfigurasi di GitHub dan ganti placeholder, lalu commit |
| Deploy mendapat `403` | Periksa Repository secrets, Account ID, dan izin token deploy |
| Login belum dikonfigurasi/`503` | Isi tiga secrets runtime Worker di Variables and Secrets |
| Login akun ditolak `403` | Cocokkan `GITHUB_ALLOWED_USERS` pada repo, lalu tunggu deploy Actions |
| Callback OAuth gagal | Cocokkan origin dan `/callback` pada OAuth App, lalu reconnect |
| Token GitHub kedaluwarsa/dicabut | Reconnect connector dan login ulang; bila perlu logout/login dashboard MCP |
| Tabel audit tidak ada | Jalankan SQL dari file migrasi pada Console database D1 yang benar |
| Tool Cloudflare belum dikonfigurasi | Isi pasangan secrets runtime Cloudflare pada Worker; secrets CI saja tidak cukup |
| Skill gagal dibaca | Periksa owner/repo/ref dan folder `skills/` pada repo tujuan |
| Smoke test gagal setelah deploy | Source sudah terunggah; baca langkah yang gagal dan logs. Tidak ada rollback otomatis |

## Referensi resmi

- [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Secrets melalui dashboard](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers KV](https://developers.cloudflare.com/kv/get-started/)
- [D1 dan Console](https://developers.cloudflare.com/d1/get-started/)
- [Alamat workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

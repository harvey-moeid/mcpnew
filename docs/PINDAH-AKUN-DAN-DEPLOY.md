# Pindah akun dan deploy MCP pribadi

Panduan ini membuat instance baru dengan data dan login terpisah. Markdown ini dapat dibaca langsung di GitHub atau dicetak melalui browser menjadi PDF. Pilihan utama: deploy melalui GitHub Actions; jangan sekaligus mengaktifkan auto-deploy Cloudflare Builds untuk target Worker yang sama.

## 1. Persiapan

- Gunakan Node.js 22 atau lebih baru, npm, Git, Python 3 bila ingin membuat ZIP ulang.
- Login ke akun GitHub tujuan di browser dan akun Cloudflare tujuan pada terminal yang digunakan.
- Buat repository GitHub kosong, sebaiknya private untuk pemakaian pribadi. Jangan tambahkan README otomatis bila akan melakukan push pertama dari folder ZIP.
- Ekstrak ZIP, lalu buka terminal di folder yang berisi `package.json`.

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

Pastikan output `whoami` menunjukkan akun tujuan. Pilih akun yang benar jika memiliki beberapa akun. Jangan menggunakan konfigurasi/token terminal milik instance lama secara tidak sengaja.

## 2. Pilih alamat dan buat Worker baru

Di Cloudflare Dashboard, pilih akun tujuan, buka Workers & Pages, dan buat Worker kosong dengan nama baru, misalnya `mcp-pribadi`. Jangan hubungkan repository untuk auto-build di langkah ini. Catat alamat `https://<nama-worker>.<subdomain-akun>.workers.dev` yang diberikan dashboard; gunakan alamat sebenarnya, bukan contoh ini.

Worker kosong hanya untuk memperoleh alamat dan tempat menyimpan secret. Source MCP menggantinya saat deployment. Jangan arahkan ke Worker produksi lama.

Pada checkout repository lama, salin template terlebih dahulu:

```sh
cp installation.example.json installation.json
cp wrangler.example.toml wrangler.toml
```

Pada ZIP portabel kedua file utama sudah berupa template. Isi `installation.json` dan `wrangler.toml` mengikuti [tabel konfigurasi](KONFIGURASI-YANG-DIGANTI.md). Untuk tahap awal, gunakan workers.dev; custom domain dapat ditambahkan setelah alur login berfungsi.

## 3. Buat KV dan D1 baru

Setelah nama Worker di `wrangler.toml` diisi, jalankan:

```sh
npx wrangler kv namespace create OAUTH_KV
npx wrangler d1 create mcp-pribadi-audit
```

`mcp-pribadi-audit` adalah contoh nama; pilih nama baru dan catat hasilnya. Wrangler mungkin menawarkan pembaruan konfigurasi. Jika sudah memperbarui otomatis, edit entri yang ada, jangan membuat binding duplikat.

- Masukkan ID namespace ke entri `binding="OAUTH_KV"`.
- Masukkan nama dan UUID D1 ke entri `binding="AUDIT_DB"`.
- Isi `GITHUB_ALLOWED_USERS` dengan username GitHub yang akan login, bukan alamat email.
- Samakan `name` Worker dengan `workerName` pada `installation.json`.
- Biarkan binding/class/migrasi Durable Object sesuai template.

## 4. Buat GitHub OAuth App baru

Di GitHub akun tujuan: Settings → Developer settings → OAuth Apps → New OAuth App.

| Pengaturan | Nilai |
| --- | --- |
| Application name | Nama bebas, misalnya MCP Pribadi |
| Homepage URL | Nilai `publicOrigin` yang sebenarnya |
| Authorization callback URL | Nilai `publicOrigin` diikuti `/callback` |

Catat Client ID dan buat Client Secret baru. MCP meminta scope `repo`, `read:user`, dan `workflow`; untuk pemakaian pribadi, pahami bahwa scope `repo` memberi akses luas pada repo yang bisa diakses akun itu. Jangan membuka allowlist untuk pengguna lain bila token tool Cloudflare memakai akun pribadi bersama.

## 5. Isi secrets Worker

Jalankan satu per satu; masukkan nilai pada prompt, bukan sebagai argumen perintah:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

Untuk `COOKIE_ENCRYPTION_KEY`, buat nilai baru dengan password manager/generator kriptografis, minimal 32 byte. Jangan salin dari instance lama atau masukkan nilainya ke Git/ZIP.

Untuk memakai tool Cloudflare dan dashboard deployment, isi juga:

```sh
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

Batasi token pada akun tujuan dan izin layanan yang akan digunakan. Tanpa pasangan ini, fitur GitHub tetap dapat digunakan, tetapi tool Cloudflare terkait akan menampilkan belum dikonfigurasi. Untuk pencarian Brave, opsional:

```sh
npx wrangler secret put BRAVE_API_KEY
```

File `.dev.vars.example` hanya untuk pengembangan lokal. Mengisi `.dev.vars` tidak memasang secret di Worker remote. Sediakan OAuth App pengembangan terpisah bila membutuhkan login lokal.

## 6. Validasi dan migrasi database baru

```sh
npm run check:installation
npm test
npm run type-check
npx wrangler deploy --dry-run --outdir work/build
npx wrangler d1 migrations apply AUDIT_DB --remote
```

Semua pemeriksaan harus berhasil. Pastikan migrasi diarahkan ke database BARU yang ID-nya sudah dimasukkan. Jangan menggunakan perintah reset atau menghapus resource lama. Migrasi D1 tidak otomatis dijalankan oleh workflow deploy; jalankan sebelum rilis yang memerlukannya.

## 7. Siapkan GitHub Actions dan push repo baru

Di repo tujuan, buka Settings → Environments, buat environment bernama `production`, lalu tambahkan secrets:

- `CLOUDFLARE_API_TOKEN`: token deployment untuk akun tujuan, misalnya dari template Edit Cloudflare Workers dengan cakupan akun yang sesuai.
- `CLOUDFLARE_ACCOUNT_ID`: ID akun Cloudflare tujuan.

Pastikan token dapat mengunggah Worker serta mengakses binding yang dipakai. Tambahkan izin domain bila menggunakan custom domain. Token ini terpisah dari secret runtime Worker. Aktifkan Actions bila belum aktif. Protection/required reviewer pada environment boleh digunakan jika tersedia pada paket GitHub Anda.

Inisialisasi repo di folder hasil ekstrak:

```sh
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial private MCP setup"
git remote add origin https://github.com/USERNAME_BARU/REPO_BARU.git
git push -u origin main
```

Ganti URL remote dengan repo yang benar. Periksa file staging sebelum commit; jangan memasukkan token, `.dev.vars`, `.env`, atau file backup data. Bila HTTPS meminta autentikasi, gunakan GitHub CLI/credential manager atau PAT melalui prompt; jangan menaruh PAT di URL.

Push pertama menjalankan CI dan workflow Deploy. Periksa tab Actions sampai keduanya berhasil, termasuk langkah smoke test. `CI` dan `Deploy` menjalankan pemeriksaan terpisah; untuk merge berikutnya, gunakan branch/PR dan wajibkan pemeriksaan CI melalui ruleset repo.

Alternatif deploy manual setelah validasi/migrasi: `npm run deploy`, lalu `npm run smoke`. Pilih satu sistem auto-deploy untuk pemakaian selanjutnya. Jangan melakukan redeploy otomatis tanpa mengisi konfigurasi dan secrets akun tujuan terlebih dahulu.

## 8. Verifikasi deployment dan sambungkan MCP

```sh
npm run smoke
```

Script memeriksa halaman utama/dashboard, discovery OAuth dengan PKCE S256 dan resource URL, `/mcp` tanpa token (`401`), dan API sesi tanpa cookie (`401`). Script ini tidak login atau melakukan tindakan tulis.

Lanjutkan pemeriksaan manual:

1. Buka `publicOrigin`, login melalui GitHub akun yang diizinkan, dan pastikan callback kembali ke dashboard.
2. Di aplikasi AI, tambahkan/refresh connector MCP dengan URL `publicOrigin` + `/mcp`. Login dan setujui koneksi baru.
3. Jalankan `list_skills`; ketiga skill BYGA harus tampil.
4. Jalankan `get_skill_instructions` untuk `byga-cloudflare-fullstack`; sumbernya harus owner/repo BARU.
5. Baca satu file repo yang memang dimiliki akun baru. Bila perlu uji tulis, gunakan branch percobaan di repo percobaan.
6. Periksa audit setelah tindakan tulis. Audit masih best-effort; kegagalan audit tidak membatalkan operasi yang sudah terjadi.

Jangan menyatakan seluruh fitur siap produksi hanya karena smoke test lulus. Uji fitur Cloudflare tambahan hanya setelah secret dan izin layanan terkait tersedia.

## 9. Ganti ke custom domain (opsional)

Di akun Cloudflare tujuan, pastikan domain/zone tersedia. Aktifkan blok `[[routes]]` yang dikomentari pada template dan isi hostname. Ubah `installation.publicOrigin`, Homepage URL dan callback OAuth App agar memakai domain yang sama. Commit/deploy, lalu ulangi smoke test serta reconnect connector dengan URL baru. Pakai satu origin utama secara konsisten.

## 10. Memperbarui, backup, dan rollback

- Untuk fitur/perbaikan: branch → PR → CI → merge → Deploy → smoke test.
- Sebelum perubahan schema/data, backup D1 melalui fasilitas Cloudflare atau `npx wrangler d1 export AUDIT_DB --remote --output work/backup.sql`. Backup berisi data pribadi; jangan commit/sertakan dalam ZIP.
- Catat versi Worker sebelum deploy: `npx wrangler versions list`.
- Rollback kode bila diperlukan: `npx wrangler rollback VERSION_ID`. Ganti `VERSION_ID` dengan versi yang benar-benar tercatat.
- Rollback Worker tidak membatalkan perubahan D1/KV, migrasi, atau tindakan GitHub. Pastikan schema lama/baru kompatibel.

## Troubleshooting

| Gejala | Pemeriksaan/perbaikan |
| --- | --- |
| `check:installation` gagal | Ganti placeholder; cocokkan nama Worker dan origin; periksa ID KV/D1 |
| GitHub Actions tidak deploy | Periksa trigger branch/path, environment `production`, approval, dan kedua secrets CI |
| `/mcp` tanpa login menghasilkan `401` | Ini perilaku yang benar; gunakan alur OAuth connector |
| GitHub `authentication expired or revoked` | Reconnect MCP dan login ulang; dashboard dapat memerlukan logout/login ulang. Membuat ZIP/deploy ulang tidak memperbarui token lama |
| Akun ditolak `403` | Cocokkan username GitHub dengan `GITHUB_ALLOWED_USERS` |
| Callback OAuth gagal | Cocokkan scheme, hostname, `/callback`, dan OAuth App yang dipakai |
| Skill tidak bisa dibaca | Periksa owner/repo/ref di `installation.json`, isi folder `skills/`, izin repo private, lalu refresh discovery tool |
| Audit gagal dibaca | Periksa binding D1 dan migrasi `0001_create_audit_log.sql` |
| Tool Cloudflare belum dikonfigurasi/`403` | Isi pasangan secret runtime Worker; periksa cakupan akun dan izin token |
| Smoke test gagal setelah deploy | Deployment sudah terjadi; baca langkah yang gagal dan logs. Script tidak melakukan rollback otomatis |

## Membuat ZIP portabel ulang

```sh
python3 scripts/export-portable.py --output work/private-mcp-portable.zip
```

ZIP berisi source, lockfile, skills, migrasi, workflow, dan panduan. Konfigurasi aktif diganti template. Sesi/data lama, dependencies terinstal, logs, `.git`, dan secrets tidak dibawa. Membuat ZIP tidak membuat repo, resource, atau deployment baru.

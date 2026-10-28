# Konfigurasi dan rilis upgrade transfer

Kode disiapkan melalui PR. Tidak ada deployment production otomatis dalam sesi upgrade. Merge main tetap memicu workflow Deploy yang sudah ada; reviewer harus memperhitungkan perilaku tersebut saat merilis.

## Konfigurasi

Bindings lama tetap: `MCP_OBJECT`, `OAUTH_KV`, `AUDIT_DB`, `FILES_BUCKET`. Secret GitHub/OAuth tidak berubah dan tidak perlu dirotasi untuk upgrade ini.

| Variabel | Default/perilaku |
| --- | --- |
| `FILES_BUCKET_NAME` | Harus sama dengan `FILES_BUCKET.bucket_name` untuk create-only admin `put_r2_object`. Config aktif berisi `mcpnew`. Tidak diperlukan untuk upload file privat |
| `FILE_UPLOAD_ALLOWED_HOSTS` | Kosong/tidak diset: import URL dinonaktifkan. Isi hostname HTTPS publik yang dipercaya, dipisah koma; tanpa skema/path/wildcard |
| `CLOUDFLARE_ALLOWED_USERS` | Tidak diset: mengikuti `GITHUB_ALLOWED_USERS`. Isi daftar GitHub login admin untuk memisahkan authority Cloudflare dari login GitHub tambahan |
| `MCP_ALLOWED_ORIGINS` | Tidak diset: browser hanya dari `installation.publicOrigin`. Untuk Inspector lokal, tambahkan exact origin yang dipakai, mis. `http://localhost:6274` |

Token Cloudflare harus scoped ke resource dan permission yang diperlukan saja. Binding upload R2 tidak memerlukan token Cloudflare atau credential S3. Permission monitoring Workers Read tidak mengizinkan DNS/D1/KV; error 403 harus diselesaikan dengan izin yang sesuai, bukan dengan mematikan guardrail.

## Tahapan rilis oleh pengelola

1. Review PR, terutama perubahan batas input, Host/Origin, dan R2 admin create-only.
2. Jalankan `npm ci`, `npm run type-check`, `npm test`, `npm audit --audit-level=high`, `npm run check:installation`, dan `npx wrangler deploy --dry-run`.
3. Pada staging yang terisolasi, isi origin/ref/ID binding dan gunakan OAuth App terpisah. Jangan memakai resource production untuk uji write.
4. Terapkan seluruh migrasi D1 **sebelum** menjalankan kode baru. Migration `0003_upload_sessions.sql` bersifat aditif dan tidak memindahkan byte atau mengubah credential. Workflow Deploy dan `npm run deploy` yang ada sudah menjalankan semua migrasi sebelum deploy. Pengelola yang merilis lewat jalur lain perlu menjalankan:

   ```bash
   npx wrangler d1 migrations apply AUDIT_DB --remote
   ```

   Perintah ini adalah instruksi rilis untuk pengelola; tidak dijalankan pada production dalam pekerjaan upgrade.
5. Deploy hanya setelah review/otorisasi rilis, lalu jalankan smoke dan matriks client di bawah. Tidak ada merge/deploy yang diperlukan untuk meninjau perubahan source.

## Kompatibilitas dan recovery

Grant OAuth, encryption key, nama Durable Object, callback dan endpoint token tidak diganti. Provider tetap menangani refresh. Browser state lama tetap kompatibel. Jika token GitHub upstream dicabut/expired, reconnect tetap diperlukan. Jangan mengganti secret untuk sekadar memperbaiki koneksi.

Tiket KV lama tanpa ID D1 diterima sampai expiry aslinya (maksimal sisa 10 menit), dengan conditional create R2 dan pemeriksaan status file. Tiket baru menuntut migration 0003; jika belum tersedia, creation menolak dengan pesan migrasi. Tiket baru berstatus pending/uploading/completed/cancelled/failed; failed tidak direset otomatis, karena hasil write bisa ambigu. Status bisa dibaca memakai bearer upload token hingga expiry. Setelah expiry, file list pemilik adalah sumber recovery. Record lama dibersihkan bertahap setelah satu hari melalui creation berikutnya.

Cancel hanya untuk tiket baru yang belum completed. Revocation D1 dan tombstone memblokir akses hasil upload, bahkan bila request bytes masih berlangsung. Objek pending dibersihkan dan upload handler memeriksa revocation sebelum/sesudah put. File completed harus dihapus melalui trash; cancel tidak menjadi jalur delete tanpa konfirmasi.

`put_r2_object` default create-only pada binding yang namanya cocok; bucket lain gagal dengan pesan konfigurasi sampai pemanggilan overwrite dikonfirmasi eksplisit. `get_r2_object` default UTF-8 strict dan batas 1 MiB; gunakan `encoding="base64"` untuk binary. Prefix `dashboard-files/` hanya boleh diakses lewat tool file pemilik.

Rollback code tidak memerlukan drop tabel aditif. Jangan menghapus tabel sesi baru atau encryption key saat rollback. Jangan menjalankan ulang write yang hasilnya belum pasti; periksa status/objek terlebih dahulu.

## Matriks verifikasi sebelum menyatakan kompatibel

| Client | Endpoint | Verifikasi manual yang masih diperlukan |
| --- | --- | --- |
| ChatGPT | `https://<origin>/mcp` | Add connector OAuth, login allowlist, refresh discovery, call read, kirim file memakai metode yang benar-benar didukung host |
| Claude | sama | DCR + consent, discovery, read, reconnect, panggilan tool file |
| Codex | sama | Remote HTTP OAuth login, initialize/discovery, read dan upload lewat shell jika tersedia |
| MCP Inspector | sama | Allow exact browser origin bila perlu, OAuth flow dan schema error |

Transport dan provider sudah diverifikasi dalam workerd lokal dengan protocol `2025-06-18`, bukan melalui UI keempat client. Tidak ada dukungan otomatis untuk membaca file lokal pengguna. Client tanpa shell/file-read harus mengarahkan pengguna ke dashboard atau memakai URL sumber yang diizinkan. Jangan membuat klaim upload sukses hanya karena tiket dibuat.

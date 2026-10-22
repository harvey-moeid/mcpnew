# Mulai di sini — GitHub Actions + dashboard Cloudflare

**Paket untuk repo BARU. Jangan merge branch `export/private-mcp-portable` ke `main` instance lama.**

1. Baca [panduan web lengkap](docs/PINDAH-AKUN-DAN-DEPLOY.md).
2. Buat KV, D1, tabel audit, dan API token melalui dashboard Cloudflare.
3. Isi dua Repository secrets GitHub Actions dan konfigurasi yang ditandai `GANTI_INSTALASI`.
4. Upload isi ZIP ke root repo baru. Deploy source dilakukan oleh GitHub Actions; tersedia tombol **Run workflow** pada branch `main`.
5. Setelah Worker tersedia, buat OAuth App dan isi secrets runtime lewat dashboard Cloudflare, lalu login/reconnect MCP.

Tidak perlu menjalankan Wrangler atau memasang Node.js pada komputer untuk alur ini. Pembacaan konfigurasi, tes, dan build dijalankan oleh workflow.

Detail kolom ada di [daftar konfigurasi](docs/KONFIGURASI-YANG-DIGANTI.md). Paket tidak membawa token, sesi OAuth, isi KV/D1, dependencies terinstal, atau riwayat Git.

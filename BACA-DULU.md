# MCP pribadi — mulai dari sini

Untuk pindah ke akun GitHub/Cloudflare lain, baca:

1. [Daftar konfigurasi yang perlu diganti](docs/KONFIGURASI-YANG-DIGANTI.md).
2. [Panduan pindah akun dan deploy](docs/PINDAH-AKUN-DAN-DEPLOY.md).
3. [Catatan perbaikan dan batas verifikasi](docs/PERBAIKAN-DAN-VERIFIKASI.md).

Penanda `GANTI_INSTALASI` menunjukkan konfigurasi yang perlu diperiksa. Nilai placeholder seperti `GANTI_USERNAME_GITHUB` harus diganti sebelum deploy.

Pada repository instance lama, `installation.json` dan `wrangler.toml` masih memakai konfigurasi instance lama agar layanan itu tetap dapat diperbarui. Untuk instance baru, gunakan kedua file `.example` sebagai titik awal. ZIP portabel yang dibuat oleh `scripts/export-portable.py` sudah menggunakan template tersebut.

Paket tidak menyertakan token, sesi OAuth, isi KV/D1, `node_modules`, atau riwayat `.git`. Setelah pindah akun, buat resource dan OAuth App baru lalu login ulang.

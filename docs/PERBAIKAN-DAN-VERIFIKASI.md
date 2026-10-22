# Perbaikan dan batas verifikasi

Tanggal persiapan: 22 Oktober 2026.

## Perubahan

- `fetch_url` membaca body secara streaming sampai maksimum 1 MiB sebelum ekstraksi HTML; `max_length` tetap membatasi jumlah karakter hasil. `truncated=true` jika batas byte atau karakter terlewati.
- Timeout mencakup pengambilan header dan pembacaan body. Body yang macet dibatalkan; cancellation hook upstream yang tidak selesai tidak menahan hasil timeout.
- `web_search` memakai batas byte dan timeout body yang sama; respons pencarian terlalu besar ditolak karena JSON terpotong tidak layak dipakai.
- Domain, sumber repo skill, dan nama Worker dipusatkan pada `installation.json`. UI, metadata OAuth, sumber skill, dan dashboard deployment menggunakannya.
- Template akun baru ditandai `GANTI_INSTALASI`; script `check:installation` memblokir deploy dengan placeholder/konfigurasi yang tidak konsisten.
- Workflow Deploy menjalankan pemeriksaan konfigurasi dan smoke test endpoint setelah unggah.
- Export ZIP menggunakan template baru dan tidak membawa secrets, sesi, state database, dependencies, atau riwayat Git.

## Pemeriksaan lokal

- `npm test`: lulus pada source utama (9 file tes).
- `npm run type-check`, `npm run check:installation`, dan dry-run build Wrangler: lulus.
- ZIP diekstrak dan konfigurasi placeholder terbukti ditolak sebelum deploy.
- Setelah salinan hasil ekstraksi diisi identitas akun dan ID resource FIKTIF, tes, TypeScript, pemeriksaan konfigurasi, dan dry-run build lulus. Ini pengujian offline, bukan akses ke akun/resource baru.
- Struktur ZIP diperiksa: tidak membawa `.git`, `node_modules`, `.wrangler`, `.env`, atau `.dev.vars`; konfigurasi KV/D1 aktif diganti placeholder.
- Pengujian memakai dependencies yang tersedia pada workspace; instalasi bersih `npm ci` dari jaringan perlu diulang melalui CI/mesin tujuan.

Pengujian regresi mencakup respons chunked tanpa akhir, UTF-8 lintas chunk, body macet, kegagalan header/body, respons kosong, dan batas respons pencarian. Smoke test diuji dengan respons tiruan termasuk kegagalan ketika endpoint MCP membuka akses anonim. Syntax JavaScript dashboard juga diperiksa.

Sebelum deploy akun baru, isi template dan ulangi `check:installation`, tes, TypeScript, serta dry-run build. Kemudian jalankan smoke test dan pemeriksaan OAuth/GitHub manual pada instance baru.

## Batas yang tetap berlaku

- Token GitHub instance lama yang kedaluwarsa harus diperbarui melalui reconnect/login ulang oleh pemilik akun.
- Belum ada klaim deployment atau pengujian akun baru karena identitas/resource tujuan belum diisi.
- Audit masih best-effort; tidak ada jaminan pencatatan transaksi wajib.
- Pembatasan request/alert operasional bergantung pada konfigurasi Cloudflare; paket tidak membuat WAF/rate-limit atau alert secara otomatis.
- Pengujian dengan mock tidak menggantikan pengujian OAuth, izin, dan perubahan resource pada akun sebenarnya.

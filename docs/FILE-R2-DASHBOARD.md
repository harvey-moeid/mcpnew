# File R2 di dashboard

Buka `/dashboard#files` setelah masuk dengan GitHub. Pilih satu atau beberapa file,
lalu tekan **Upload file**. Tabel menampilkan nama file, ukuran, waktu upload, dan
**Download**. Tombol **Muat file berikutnya** melanjutkan daftar jika masih ada data.
Upload menampilkan persentase dan berjalan berurutan. Batas aplikasi adalah **25 MiB
per file**; download dikirim sebagai attachment melalui Worker tanpa buffering.

## Penyimpanan dan akses

Instance ini memakai bucket `mcpnew` dengan binding `FILES_BUCKET` di `wrangler.toml`.
File dashboard memakai key `dashboard-files/<github-login>/<uuid>/<nama-file>`.
Login dinormalisasi ke huruf kecil. Nama yang sama menghasilkan objek terpisah,
bukan overwrite. Dashboard hanya menampilkan file pada prefix milik akun yang login;
objek lama di luar prefix ini tidak otomatis diimpor atau ditampilkan.

Endpoint daftar, upload, dan download memerlukan sesi dashboard yang masih berlaku
serta akun yang diizinkan oleh allowlist. Upload juga mewajibkan Origin yang sama.
Konten diunduh sebagai `application/octet-stream` dengan `Content-Disposition: attachment`
agar file HTML/SVG tidak dijalankan pada origin dashboard. Tidak ada URL R2 publik
atau token Cloudflare yang dikirim ke browser.

Proteksi sesi berlaku untuk endpoint dashboard. Untuk menjaga privasi seluruh bucket,
pastikan bucket tidak dipublikasikan lewat r2.dev, domain publik, atau Worker lain.
Akses administratif dan tool MCP R2 tetap mengikuti izin yang sudah dimiliki akun.

## Instalasi lain

Gunakan bucket yang sudah ada di akun Cloudflare tempat Worker berjalan, lalu tambahkan:

```toml
[[r2_buckets]]
binding = "FILES_BUCKET"
bucket_name = "nama-bucket-anda"
```

Contoh tersedia di `wrangler.example.toml`. Binding R2 tidak memerlukan access key S3
atau secret tambahan. Jika binding belum tersedia, dashboard menampilkan status
belum dikonfigurasi dan tidak mengaktifkan upload. Setelah mengubah binding, deploy
ulang Worker sesuai panduan rilis repo.

## API

- `GET /dashboard/api/files?cursor=...`: maksimal 50 objek per halaman; teruskan cursor
  yang dikembalikan sampai bernilai null. Urutan mengikuti key R2, bukan waktu terbaru.
- `POST /dashboard/api/files?name=...`: body biner mentah, `Content-Length` wajib dan
  maksimal 25 MiB. Nama file maksimal 255 byte UTF-8, tanpa pemisah folder atau karakter
  kontrol. Balasan 201 berisi metadata file; mendukung file kosong.
- `GET /dashboard/api/files/download?key=...`: stream attachment milik akun yang login;
  file tidak ada atau bukan milik akun menghasilkan 404.

Jika upload terputus setelah server menyimpan objek, periksa daftar sebelum mencoba
ulang; percobaan ulang menghasilkan file baru. Multipart upload, preview isi file, dan impor objek lama belum disediakan.

## Mengirim hasil kerja workspace melalui MCP

Tool file memakai bucket dan prefix akun yang sama dengan dashboard:

- `upload_file(filename, content_base64)`: upload langsung melalui MCP, maksimal **1 MiB**
  setelah base64 didekode; cocok untuk PDF/gambar/ZIP kecil maupun file teks.
- `create_file_upload(filename, size)`: siapkan tiket upload file workspace hingga **25 MiB**.
  `size` harus jumlah byte yang tepat. Balasan mencakup `uploadUrl`, `uploadToken`,
  `expiresAt`, key, dan URL download privat. Tiket berlaku 10 menit.
- `list_files(cursor?)`: daftar file milik akun MCP yang sedang login, beserta URL download privat.
- `get_file_download(key)`: ambil URL download privat untuk file milik akun tersebut.

MCP server berjalan di Cloudflare; path lokal workspace tidak tersedia di server.
Untuk file lebih besar dari 1 MiB, agent perlu shell atau HTTP client di workspace:

1. Panggil `create_file_upload` dengan nama dan ukuran file hasil kerja.
2. Simpan objek JSON balasannya ke file sementara berizin `0600` (jangan masukkan token
   ke argumen perintah, log, repositori, atau link download).
3. Jalankan helper yang tersedia di repo ini:

   ```bash
   python3 scripts/upload-workspace-file.py /path/hasil.zip --ticket /path/upload-ticket.json
   ```

   Helper membaca file secara streaming, mengirim POST biner dengan bearer token upload,
   serta menolak URL selain endpoint instalasi ini dan menolak redirect. Tiket juga dapat
   diberikan melalui stdin dengan `--ticket -`. Jangan kirim multipart/form-data atau base64
   ke endpoint ini.
4. Hapus file tiket sementara setelah selesai; berikan `downloadUrl` privat kepada pemilik.
   File juga terlihat di `/dashboard#files`.

Tiket hanya mengizinkan penyimpanan satu objek baru, dengan nama, pemilik, dan ukuran
tertentu. Tiket tidak memberi hak download/list dan tidak dapat menimpa objek yang sudah
tersimpan. Jika koneksi terputus, periksa `list_files` sebelum membuat tiket baru.
Perubahan allowlist berlaku juga pada tool file dan saat tiket dipakai.

Pembuatan tiket, upload inline MCP, dan upload dashboard memeriksa tabel status file
D1 sebelum membuat tiket atau menyimpan byte ke R2. Jika migrasi belum diterapkan
atau database sedang gagal, operasi ditolak. Pemeriksaan ini tidak menjamin database
akan selalu tersedia setelah upload berhasil; gangguan berikutnya tetap dapat
menunda akses download sampai database pulih.

Tool administratif `list_r2_objects`, `get_r2_object`, `put_r2_object`,
`delete_r2_object`, dan `r2_bucket_create/list/delete` juga memeriksa allowlist pada
setiap pemanggilan, termasuk sesi MCP yang sudah tersambung. Allowlist kosong
menolak akses R2. Izin tool administratif mengikuti cakupan token Cloudflare,
sehingga tidak dibatasi ke prefix privat dashboard.

`put_r2_object` membuat objek teks baru secara default dengan kondisi
`If-None-Match: *`; key yang sudah ada menghasilkan error konflik. Untuk mengganti
objek, pemilik harus meminta overwrite dan pemanggilan harus menyertakan
`overwrite: true` serta `confirm` yang sama persis dengan `bucket:key`.
`create_file_upload` tetap hanya membuat tiket, bukan isi file; gunakan helper
workspace untuk mengirim byte file ke endpoint tiket tersebut.

**Download privat tetap memerlukan sesi dashboard pemilik file.** URL privat tidak
mengandung token dan tidak memberi akses ke orang lain. Token MCP maupun tiket upload
tidak dapat menggantikan cookie login pada endpoint download privat. Pemilik dapat
membuat link berbagi sementara secara terpisah, seperti dijelaskan berikut.


## Label proyek, tempat sampah, dan penggunaan

Klik **Label** untuk menambahkan satu label proyek (maksimal 80 karakter) pada file aktif.
Label kosong menghapus pengelompokan; gunakan filter label untuk menampilkan proyek
tertentu. Label merupakan metadata, bukan perubahan path/key objek. Label tetap ada
saat file dipulihkan. File lama tanpa metadata otomatis masuk daftar aktif tanpa label.

**Hapus** memindahkan file ke tempat sampah selama tujuh hari, segera memblokir download
privat dan mencabut semua link berbaginya. Pilih **Tempat sampah** lalu **Pulihkan**
sebelum masa pemulihan berakhir. Memulihkan file tidak mengaktifkan ulang link lama.
Tidak ada tombol hapus permanen langsung.

Pembersihan berjalan di latar belakang setelah pemilik membuka daftar file lewat
dashboard atau tool MCP `list_files`, tanpa membutuhkan Cron Trigger tambahan.
KV membatasi percobaan menjadi sekitar satu kali per jam, hingga 10 objek per percobaan.
Saat ada backlog atau layanan tidak diakses, penghapusan fisik bisa lebih lambat;
pemulihan tetap hanya berlaku tujuh hari. Jika R2 sedang gagal, permintaan daftar file
tetap berhasil dan pembersihan dicoba lagi pada akses setelah masa jeda berakhir.
Tombstone D1 tetap disimpan untuk mencegah akses atau replay tiket file yang dihapus.

Ringkasan menghitung jumlah dan ukuran byte file aktif serta tempat sampah pada prefix
milik akun yang login, termasuk file dari MCP. Ini bukan statistik seluruh bucket,
kuota, atau estimasi tagihan Cloudflare. Penghitungan mengikuti semua halaman; pada
akun besar, tombol **Lanjutkan perhitungan** melanjutkan hasil parsial. Data merupakan
hasil pemindaian, sehingga perubahan file saat pemindaian dapat memerlukan refresh.
Filter label/tempat sampah tidak mengubah total penggunaan. Halaman yang kosong masih
bisa memiliki cursor lanjutan jika objek di halaman tersebut tidak cocok dengan filter.

Tool MCP tambahan:

- `manage_file(key, action, project?, confirm?)`: label proyek, trash, atau restore.
  Untuk trash, `confirm` harus sama persis dengan key.
- `list_files(cursor?, trash?, project?)`: termasuk mode tempat sampah dan filter label.
- `get_file_storage(cursor?)`: total **per halaman**; jumlahkan halaman sampai cursor null.
- `create_file_share(key, hours)`, `list_file_shares(key)`, `revoke_file_share(id)`:
  berbagi sementara hanya ketika diminta pemilik, melihat dan mencabut link.

## Link berbagi sementara

Klik **Bagikan**, pilih 1 jam, 24 jam, atau 7 hari, lalu **Buat link berbagi**. Siapa pun
yang memegang link tersebut dapat mengunduh file tanpa login sampai kedaluwarsa atau
dicabut. File lain tetap privat. Salin link saat dibuat: server hanya menyimpan hash
token dan tidak dapat menampilkan kembali URL asli. Daftar menampilkan hingga 100 link
aktif terbaru; masing-masing dapat dicabut lewat **Cabut akses**. Link lama juga bisa
dicabut melalui tool MCP dengan ID yang dikembalikan saat pembuatan.

Endpoint `/shared-files/<token-acak>` memeriksa hash token, waktu berlaku, status cabut,
allowlist pemilik, dan status file setiap kali diakses. Respons memakai `no-store`,
`no-referrer`, `noindex`, dan attachment; link tidak dipublikasikan ke daftar file atau
localStorage. File yang dipindahkan ke tempat sampah otomatis mencabut semua link.
Download yang sudah berjalan atau salinan yang sudah diunduh tidak dapat ditarik kembali.

## Migrasi dan rilis

Sebelum menjalankan kode ini, terapkan `migrations/0002_file_management.sql` pada D1
`AUDIT_DB`. Migrasi hanya menambahkan tabel dan indeks; tidak memindahkan byte R2.
`npm run deploy` dan workflow Deploy sekarang menerapkan migrasi sebelum deploy.
Untuk deploy manual lain, jalankan lebih dulu:

```bash
npx wrangler d1 migrations apply AUDIT_DB --remote
```

`wrangler.toml` mengaktifkan bucket `mcpnew` tanpa menambah Cron Trigger. Pada instalasi lain,
aktifkan binding bucket yang sesuai di template. Migrasi yang belum diterapkan
menghasilkan error tertutup (503), bukan membuka akses tanpa pemeriksaan status file.

Pengujian SQL menggunakan SQLite bawaan Node.js; jalankan pemeriksaan dengan Node.js 22.13 atau lebih baru.

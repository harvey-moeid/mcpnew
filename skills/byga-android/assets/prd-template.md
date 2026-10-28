# PRD — <Nama aplikasi Android>

Status: draft/siap implementasi | Repo: <repo target> | Tanggal: <tanggal aktual>

## 1. Masalah dan sasaran

Pengguna utama, masalah, skenario penggunaan, hasil yang ingin dicapai, serta indikator
keberhasilan yang bisa dinilai. Bedakan informasi pengguna dari asumsi.

## 2. Cakupan MVP

| ID | Kebutuhan/perilaku pengguna | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| FR-001 | <kemampuan utama> | Must | Given <kondisi>, when <aksi>, then <hasil teramati> |

Non-goals: <yang sengaja di luar MVP>.

## 3. Layar dan alur

Daftar layar dan navigasi; alur utama dan kegagalan; loading/empty/error; validasi input;
back navigation; aksesibilitas; contoh data yang aman. Sertakan wireframe jika berguna.

## 4. Data, offline, login dan integrasi

Entitas/field, sumber data, persistensi, kebutuhan offline/sinkronisasi, aturan konflik,
login/otorisasi jika diperlukan, API/backend nyata dan status ketersediaannya.
Izin Android yang benar-benar diperlukan, alasan, serta perilaku ketika ditolak.

## 5. Kebutuhan nonfungsional

Perangkat/min SDK, bahasa, ukuran layar, performa yang bisa diuji, jaringan, keamanan,
privasi, perilaku saat proses mati/rotasi, dan batas biaya yang relevan. Jangan mengarang
metrik lulus yang belum diuji.

## 6. Keputusan teknis

Stack terpilih dan alasan dibanding alternatif. Application ID/namespace, nama aplikasi,
versi, module/struktur, JDK/AGP/Kotlin/Gradle atau Flutter/SDK aktual dan kompatibilitasnya.
Dependensi pokok, lingkungan build, konfigurasi publik, dan secret yang dibutuhkan
**berupa nama saja**. Tulis asumsi atau keputusan yang masih menghalangi implementasi.

## 7. Build dan distribusi APK

- Tipe awal: APK debug untuk uji coba/sideload, bukan rilis produksi.
- Repo/branch dan cakupan tindakan GitHub yang diizinkan.
- Actions artifact: nama, masa simpan, ZIP berisi APK + checksum, hak akses download.
- GitHub Releases bila diminta: prerelease, tag unik, asset APK + checksum, visibility repo.
- Update aplikasi: implikasi debug signing key berbeda; rencana signing stabil jika perlu.
- AAB/Play Store atau production signing hanya jika termasuk ruang lingkup.

## 8. Rencana implementasi dan pengujian

| Tahap/FR | Implementasi | Bukti yang diperlukan | Status |
| --- | --- | --- | --- |
| FR-001 | <layar/data> | <tes/alur perangkat> | belum dikerjakan |
| CI | <workflow APK> | run sukses + artifact APK | belum dijalankan |

Milestone, risiko, mitigasi, dan dependensi nyata. Jelaskan jalan ke APK meskipun SDK
lokal tidak tersedia. Build, publish, download, install dan launch dinilai terpisah.

## 9. Keputusan terbuka

Hanya pertanyaan yang material bagi implementasi, data atau distribusi. Jangan membuat
approval berlapis untuk hal yang sudah diizinkan pengguna.

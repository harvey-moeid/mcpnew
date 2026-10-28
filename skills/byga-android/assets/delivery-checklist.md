# Handoff aplikasi Android

- [ ] PRD terisi dan sesuai kebutuhan pengguna; asumsi diketahui.
- [ ] Fitur MVP terimplementasi, bukan hanya template atau mock tanpa penjelasan.
- [ ] Repo, branch, commit, application ID, versionCode/versionName dan stack tercatat.
- [ ] Tidak ada placeholder workflow/endpoint, signing key atau secret yang ter-commit.
- [ ] Lint/static analysis dan tes relevan dijalankan; status dan keterbatasan dicatat.
- [ ] Build debug pada commit yang benar berhasil; run URL diverifikasi.
- [ ] Artifact/asset APK tersedia, nonkosong, bernama jelas dan disertai SHA256SUMS.txt.
- [ ] APK debug dijelaskan sebagai APK uji coba, bukan produksi/unsigned.
- [ ] Download Actions: URL run, nama artifact, kebutuhan login/akses, masa simpan,
      dan ekstraksi ZIP dijelaskan.
- [ ] Jika Releases diminta: prerelease aktual dan asset APK diverifikasi, tautan diberikan.
- [ ] Status uji install/launch/alur utama di perangkat atau emulator dilaporkan jujur.
- [ ] Perbedaan debug signing antar-run dan risiko kehilangan data saat uninstall dijelaskan
      bila relevan; tidak melakukan uninstall/reset otomatis.
- [ ] Source siap, push, CI, artifact, release dan install tidak disamakan statusnya.

Laporan ringkas: fitur selesai → stack → bukti build/run → unduhan aktual → batas uji.
Jika belum ada build, tulis "APK belum tersedia" dan langkah berikutnya; jangan memberi
link repo sebagai pengganti APK atau menandai checklist yang belum diverifikasi.

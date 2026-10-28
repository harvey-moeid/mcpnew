# byga-android

Skill umum berbahasa Indonesia untuk membuat aplikasi Android dari ide/PRD hingga APK
uji coba yang dibangun lewat GitHub Actions dan dapat diunduh dari Actions atau Releases.

Mulai dengan:

> Gunakan byga-android untuk membuat aplikasi pencatatan stok offline. Buat PRD,
> rekomendasikan teknologi, implementasikan MVP dan siapkan build APK di GitHub Actions.

Skill bertanya kebutuhan yang belum diketahui, merekomendasikan Kotlin/Jetpack Compose
atau Flutter, lalu melanjutkan tahap yang diizinkan. Default APK debug dan artifact
Actions; publikasi prerelease serta signing produksi tidak berjalan otomatis.

Isi paket:

- `SKILL.md`: alur discovery, PRD, implementasi, CI, verifikasi dan handoff.
- `references/architecture.md`: keputusan stack dan struktur proyek proporsional.
- `references/github-delivery.md`: setup CI, distribusi, signing dan akses unduhan.
- `assets/prd-template.md`: PRD produk dan rencana delivery APK.
- `assets/android-native-debug.yml`: template build Kotlin/Compose.
- `assets/android-flutter-debug.yml`: template build Flutter.
- `assets/delivery-checklist.md`: kriteria handoff dan bukti yang harus tersedia.

Workflow masih berupa template dengan placeholder. Isi dari repo/toolchain/rilis resmi
saat membuat aplikasi, dan salin hanya ke repo aplikasi yang dituju. Skill bukan
proyek Android siap-build dan tidak menghasilkan APK hanya dengan membaca instruksinya.

Di MCP, skill tersedia sebagai built-in setelah perubahan registry di-deploy dan source
paket berada pada ref GitHub yang dikonfigurasi. Baca [panduan skills](../../docs/SKILLS.md).

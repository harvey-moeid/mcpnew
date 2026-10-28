# Build APK dan distribusi melalui GitHub

## Prasyarat dan keputusan

Pastikan repo target, branch default, hak akses, source aplikasi lengkap dan toolchain
aktual diketahui. Gunakan source/project generator resmi; untuk native pastikan
`gradlew`, `gradlew.bat`, wrapper JAR/properties dan build script tersedia. Flutter
membutuhkan folder Android dari generator resmi, `pubspec.yaml` dan `pubspec.lock`.
Template native memakai module `app` tanpa flavor dan satu output APK debug; sesuaikan
task/path bila proyek memakai module lain, flavor atau ABI split. Jangan memilih APK
pertama secara acak. Untuk MVP Flutter gunakan satu APK universal.

Actions tidak memerlukan production keystore untuk build debug. Debug key dihasilkan
otomatis, tetapi dapat berubah antar-run. Jika user butuh update tanpa uninstall,
rencanakan key uji coba stabil secara terpisah. Jangan mengubah keystore produksi,
memublikasikan secret, atau menaruh keystore di artifact. Untuk Flutter, pin versi yang
mendukung perintah lockfile pada template; jangan menghilangkan lockfile diam-diam.

## Mengisi workflow template

Pilih `assets/android-native-debug.yml` atau `assets/android-flutter-debug.yml` lalu
salin ke `.github/workflows/android-debug.yml` **di aplikasi yang dibuat**. Jangan
mendaftarkan template sebagai workflow repo MCP. Semua placeholder wajib diisi:

| Placeholder | Sumber nilai |
| --- | --- |
| `__DEFAULT_BRANCH__` | Branch utama repo aplikasi yang diamati, misalnya main |
| `__JAVA_VERSION__` | JDK yang cocok dengan AGP/Gradle/Flutter proyek |
| `__CHECKOUT_SHA__` | Commit SHA rilis resmi actions/checkout yang diverifikasi |
| `__SETUP_JAVA_SHA__` | Commit SHA rilis resmi actions/setup-java yang diverifikasi |
| `__SETUP_GRADLE_SHA__` | Native saja: commit SHA resmi gradle/actions untuk setup-gradle |
| `__FLUTTER_ACTION_SHA__` | Flutter saja: commit SHA subosito/flutter-action yang diperiksa |
| `__FLUTTER_VERSION__` | Flutter stable spesifik yang dipilih dan diverifikasi |
| `__UPLOAD_ARTIFACT_SHA__` | Commit SHA resmi actions/upload-artifact yang diverifikasi |
| `__DOWNLOAD_ARTIFACT_SHA__` | Commit SHA resmi actions/download-artifact yang diverifikasi |

Periksa dokumentasi/rilis action yang dipilih, runtime Node runner, dan dukungan GitHub
Cloud/Enterprise. Pin versi toolchain di proyek, bukan mengambil versi latest setiap
build. Cantumkan label versi manusia sebagai komentar di samping SHA jika membantu.
Validasi YAML, konteks ekspresi Actions dan tidak ada `__PLACEHOLDER__` sebelum push.

## Apa yang dilakukan template

1. Build job read-only pada PR, push ke branch utama, atau dispatch manual.
2. Checkout tanpa menyimpan credential, setup toolchain, lint/static analysis dan tes,
   lalu menghasilkan APK debug yang ditandatangani otomatis untuk uji coba.
3. Salin APK menjadi `dist/app-debug.apk`; gagal jika file hilang/kosong atau output
   native ambigu. Tulis checksum `dist/SHA256SUMS.txt`.
4. Upload artifact dengan nama menyertakan commit SHA dan run attempt, masa simpan
   14 hari (bisa dibatasi kebijakan repo/organisasi).
5. Hanya jika dispatch manual pada branch utama memilih `publish_release=true`, job
   release yang terpisah mengunduh artifact dari run yang sama, memeriksa checksum,
   dan membuat GitHub **prerelease** dengan APK dan checksum. Job ini saja memiliki
   `contents: write`. Tag berisi run number dan attempt, ditargetkan ke commit build.

Default `publish_release=false`. Memasang workflow bukan persetujuan memublikasikan
APK; jalankan opsi publish hanya dalam cakupan permintaan pengguna. Visibility repo
menentukan siapa yang dapat membaca release; jangan mengubahnya tanpa permintaan.
Jika kebijakan organisasi menolak write, laporkan blokir dan pertahankan artifact
Actions yang sudah ada. Jangan memindahkan write token ke build PR sebagai jalan pintas.

## Verifikasi dan akses unduhan

Catat commit, run ID/URL, nama job, nama artifact, jenis APK, ukuran dan checksum jika
tersedia. Pastikan link menunjuk ke run/asset aktual. Memulai workflow tidak berarti
build berhasil; baca status akhir dan log bila gagal.

Artifacts Actions diunduh dari halaman run dengan login dan akses baca repo. GitHub
mengemas artifact menjadi ZIP; pengguna mengekstrak lalu memasang `app-debug.apk`.
Artifact dapat kedaluwarsa sesuai retention. Jangan menganggap link artifact sebagai
link publik permanen. Bila artifact sudah hilang, build ulang dan verifikasi run baru.

Releases menyediakan asset `.apk` langsung; repo publik memungkinkan unduhan publik,
repo privat tetap memerlukan otorisasi. Salin URL yang dikembalikan GitHub, bukan
merangkai nama asset yang belum diunggah. GitHub Source code ZIP/tarball tidak berisi
APK otomatis. Gunakan tautan halaman release jika tidak dapat memverifikasi URL asset.

Sideload mungkin membutuhkan izin "install unknown apps" dari aplikasi pengunduh pada
perangkat pengguna. Jangan menyuruh menonaktifkan Play Protect atau proteksi perangkat.
Verifikasi package/version/signing dengan tool SDK bila tersedia, lalu uji install dan
launch di perangkat/emulator jika host mendukung. Jelaskan risiko data sebelum opsi
uninstall; jangan menghapus aplikasi/data pengguna untuk mengatasi signature mismatch.

## Sumber resmi saat menerapkan workflow

- https://docs.github.com/actions/using-workflows/storing-workflow-data-as-artifacts
- https://docs.github.com/actions/managing-workflow-runs/downloading-workflow-artifacts
- https://docs.github.com/repositories/releasing-projects-on-github/about-releases
- https://github.com/actions/checkout
- https://github.com/actions/setup-java
- https://github.com/gradle/actions
- https://github.com/actions/upload-artifact
- https://github.com/actions/download-artifact
- https://github.com/subosito/flutter-action
- https://cli.github.com/manual/gh_release_create

Skill/template ini belum membangun aplikasi apa pun. Pengerjaan aplikasi nyata harus
memverifikasi toolchain, SHA action, hak akses dan hasil build pada repo target tersebut.

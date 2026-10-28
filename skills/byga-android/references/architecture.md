# Arsitektur Android sesuai produk

## Pilihan stack

| Kondisi | Pilihan awal | Yang diperiksa |
| --- | --- | --- |
| Android saja, integrasi native, layanan background/perangkat | Kotlin + Jetpack Compose | API Android, lifecycle, permission, kebutuhan background nyata |
| Android+iOS benar-benar direncanakan, UI/logic bersama menguntungkan | Flutter | Dukungan plugin native, ukuran APK, akses SDK dan pengalaman tim |
| Repo aplikasi sudah ada dan stack masih sesuai | Stack yang ada | Versi kompatibel, kualitas source, biaya migrasi |

Jelaskan pilihan untuk aplikasi yang sedang dibangun. Tidak semua aplikasi membutuhkan
login, backend, DI framework, database relasional, multi-module, atau layanan cloud.
Tentukan min SDK dari sasaran perangkat dan dukungan dependensi; target/compile SDK,
JDK, AGP, Kotlin dan Gradle harus kompatibel berdasarkan dokumentasi/toolchain saat ini.
Untuk Flutter, gunakan stable yang dipin; Java dan Gradle tetap harus sesuai proyek Android.

## Struktur Kotlin/Compose untuk aplikasi kecil–menengah

```text
app/
  build.gradle.kts
  src/main/
    AndroidManifest.xml
    java/<package>/
      MainActivity.kt
      App.kt
      navigation/
      core/             # utilitas/config bersama yang benar-benar dibutuhkan
      data/             # sumber lokal/remote, repository dan mapping
      feature/<fitur>/  # screen, UI state, ViewModel, komponen
      ui/theme/
    res/
  src/test/
  src/androidTest/      # bila tes perangkat disediakan
build.gradle.kts
settings.gradle.kts
gradle/libs.versions.toml
gradle/wrapper/         # properties dan JAR resmi
gradlew
gradlew.bat
docs/PRD.md
.github/workflows/android-debug.yml
```

Gunakan state immutable dan lifecycle-aware collection. Room/DataStore sesuai bentuk data;
repository hanya jika ada boundary data yang berguna. Tambahkan domain/use case atau
multi-module jika kompleksitas menuntut, bukan sebagai folder kosong. Jangan membekukan
application ID/namespace ke contoh. Nama path mengikuti package aktual.

## Struktur Flutter

```text
lib/
  main.dart
  app.dart
  core/
  features/<fitur>/
    data/
    presentation/       # screen, state/controller, komponen
android/                # proyek resmi dari flutter create
test/
integration_test/       # bila pengujian perangkat disediakan
pubspec.yaml
pubspec.lock
docs/PRD.md
.github/workflows/android-debug.yml
```

Pilih state management yang sesuai kompleksitas dan repo; tidak wajib menambah paket.
Commit `pubspec.lock` untuk aplikasi. Buat proyek melalui `flutter create --platforms=android`
dengan nama dan organization ID yang dipilih; ubah kode contoh menjadi fitur produk.
Jangan menganggap template counter sebagai aplikasi selesai. Uji widget default harus
disesuaikan jika UI berubah, bukan sekadar dihapus supaya CI hijau.

## Kontrak data dan keamanan

Tulis skema objek, aturan validasi, persistensi, kebijakan offline dan kegagalan jaringan.
Untuk API: auth, endpoint nyata, timeout, retry yang aman, dan sumber konfigurasi publik.
Kunci yang dikompilasi ke APK dapat diekstrak; keystore signing tidak menyembunyikan API key.
Untuk aplikasi yang memakai login, terapkan otorisasi di backend dan penyimpanan token
sesuai platform. Foto/lokasi/notifikasi/payment memerlukan alur permission/consent relevan.
Hindari meminta seluruh izin Android dari awal.

Sertakan state kosong, error, retry, back navigation, input keyboard dan ukuran teks besar.
Data aplikasi uji coba tetap diperlakukan sebagai data pengguna. Reset/uninstall bukan
langkah perbaikan otomatis karena bisa menghapus data lokal.

## Sumber resmi untuk diperiksa saat implementasi

- Android architecture: https://developer.android.com/topic/architecture
- Compose: https://developer.android.com/develop/ui/compose
- AGP compatibility: https://developer.android.com/build/releases/gradle-plugin
- Gradle Wrapper: https://docs.gradle.org/current/userguide/gradle_wrapper.html
- Flutter Android setup: https://docs.flutter.dev/platform-integration/android/setup
- Flutter Android delivery: https://docs.flutter.dev/deployment/android

URL adalah rujukan, bukan bukti bahwa versi tertentu telah diperiksa. Catat versi aktual
pada PRD atau README proyek; jangan mengklaim paket paling baru tanpa pemeriksaan.

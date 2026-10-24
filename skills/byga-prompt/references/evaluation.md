# Evaluasi dan penyempurnaan berbasis bukti

## Dua lapisan pemeriksaan

**Review prompt** memeriksa kesesuaian instruksi, detail wajib, konflik, kelengkapan, kontinuitas dan kompatibilitas yang diketahui. Ini dapat dilakukan tanpa render, tetapi tidak membuktikan mutu gambar/video.

**Review hasil** memerlukan media yang benar-benar tersedia dan diperiksa. Nilai hanya yang bisa diamati. Jika hanya ada thumbnail atau gambar diam dari video, jangan mengklaim gerakan, dialog, audio, atau konsistensi seluruh durasi sudah diverifikasi.

## Detail wajib sebagai gate

Tandai setiap kebutuhan utama `PASS`, `FAIL`, atau `NOT VERIFIED`: subjek/jumlah, aksi, identitas/produk, teks/dialog persis, larangan pengguna, format/durasi, dan area edit. Kegagalan satu detail wajib tidak dapat ditutup oleh skor estetika.

Dimensi tambahan bila relevan:

| Dimensi | Bukti yang diperiksa |
|---|---|
| Intent | Adegan dan tujuan sesuai brief |
| Komposisi | Hierarki subjek, framing, ruang teks, tidak terpotong tanpa sengaja |
| Cahaya/material | Arah dan bayangan masuk akal, tekstur sesuai gaya |
| Identitas/produk | Atribut konsisten terhadap referensi yang tersedia |
| Motion | Gerak kamera/subjek koheren, tidak ada teleport atau morph tak diminta |
| Kontinuitas | Posisi, pakaian, properti dan keadaan antar-frame/shot |
| Teks/audio | Ejaan dan dialog persis; suara diperiksa jika benar-benar tersedia |
| Kompatibilitas | Instruksi dan kontrol didukung versi model yang dipakai |

Gunakan deskripsi `baik`, `perlu perbaikan`, atau `belum terverifikasi` dengan alasan yang dapat diamati. Jangan membuat skor akurasi atau persentase dari intuisi.

## Loop perbaikan

1. Catat prompt, model/versi/host, referensi dan setting yang diketahui; jangan memasukkan credentials.
2. Pilih kegagalan paling berdampak terhadap brief. Pisahkan masalah prompt, kemampuan model, referensi dan editing.
3. Ubah kelompok instruksi terkecil yang relevan: misalnya hubungan spasial, satu gerakan kamera, atau lock label produk. Pertahankan detail yang sudah benar.
4. Jika uji render diotorisasi, pertahankan setting yang dapat dikendalikan agar perbandingan berguna. Seed yang sama tidak menjamin hasil sebanding lintas model/versi.
5. Bandingkan media sebelum/sesudah dengan kriteria yang sama. Jika tidak ada media baru, labeli sebagai usulan revisi yang belum diuji.
6. Berhenti ketika syarat utama terpenuhi, anggaran/iterasi yang disepakati tercapai, atau batas model menghalangi. Jelaskan perbaikan manual/shot terpisah bila sesuai; jangan terus menambah instruksi yang saling bersaing.

## Benchmark bila pengguna meminta angka

Tentukan kumpulan brief yang mewakili pekerjaan nyata, baseline, model/versi/setting, kriteria lulus dan prosedur penilaian sebelum menguji. Simpan hasil per kasus, termasuk gagal dan tidak terverifikasi. Bila memungkinkan gunakan penilai yang tidak mengetahui varian.

Laporkan jumlah kasus dan render aktual, kegagalan per kategori, serta batas generalisasinya. Persentase hanya dihitung dari kasus yang benar-benar diuji dengan denominator dan definisi keberhasilan yang jelas. Jangan menjadikan target `99,9%` sebagai klaim hasil, dan jangan menyimpulkan reliabilitas populasi dari sedikit sampel atau contoh prompt.

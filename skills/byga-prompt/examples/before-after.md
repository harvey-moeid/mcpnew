# Contoh enhance prompt gambar dan video

Contoh berikut netral terhadap model. Ini contoh instruksi, bukan bukti media telah dihasilkan atau dibandingkan melalui generator.

## 1. Gambar produk

**Input:** Foto botol parfum hitam di meja, mewah, background gelap, tanpa tulisan tambahan.

**Prompt hasil enhance:**

```text
A luxury product photograph of a black perfume bottle standing on a dark tabletop against a deep charcoal background. Place the bottle as the clear focal point, fully inside the frame, with subtle negative space around it. Use a soft side light to define the edges and a restrained highlight on the bottle surface, with natural contact shadows on the table. Keep the palette black and charcoal with a clean, understated composition. No added typography or decorative objects.
```

**Dipertahankan:** botol hitam, meja, kesan mewah, latar gelap, tanpa teks tambahan. Bentuk dan label produk tidak dikarang; jika ada referensi, detailnya mengikuti gambar tersebut.

## 2. Video satu shot

**Input:** Enhance: kucing oren duduk dekat jendela pas hujan, dia lihat keluar, kamera pelan mendekat, 6 detik, 9:16. Hanya prompt.

```text
A six-second vertical 9:16 shot of an orange cat sitting beside a rain-streaked window. The cat remains seated, looking outside, with subtle breathing and a small natural ear movement. The camera slowly pushes in toward the cat and window throughout the shot. Soft overcast daylight illuminates the fur while raindrops move down the glass. Maintain the same cat, position, and room throughout. End with a closer view of the cat watching the rain. One continuous shot with no cuts.
```

Enam detik dan 9:16 adalah target pengguna; contoh ini tidak mengklaim semua generator mendukungnya.

## 3. Edit dengan detail terkunci

**Input:** Ganti background foto produk ini jadi krem, botol dan label jangan berubah.

**Jika gambar tersedia dan sudah diperiksa:**

```text
Replace only the background of the supplied product image with a clean cream-colored studio backdrop. Preserve the original bottle, its shape, proportions, color, cap, label artwork, and exact label text. Keep the original camera angle and framing. Match the background lighting and contact shadow naturally to the unchanged product. Do not add objects or new text.
```

Jika gambar belum tersedia, nyatakan hal itu dan gunakan `[GAMBAR REFERENSI]`. Jangan mengklaim warna atau bentuk botol tertentu.

## 4. Image-to-video dengan referensi belum tersedia

**Input:** Animasikan foto model saya, rambut kena angin halus, kamera diam.

**Catatan:** Foto belum tersedia; lampirkan gambar referensi pada generator.

```text
Use [GAMBAR REFERENSI] as the visual reference. Keep the camera locked off and preserve the person's appearance, clothing, pose, original framing, and background. A gentle breeze moves the hair subtly while the person maintains the original pose with natural breathing. Keep the motion restrained and continuous, without cuts or changes to facial features.
```

## 5. Konflik yang perlu ditanyakan

**Input:** Video one-take produk, kamera benar-benar diam tapi orbit 360 derajat.

**Respons:** “Gerakan kamera yang kamu inginkan: tetap diam atau orbit 360°?”

Setelah pengguna memilih, buat prompt yang konsisten dengan pilihannya. Jangan diam-diam membuang salah satu syarat utama.

## 6. Beberapa karakter, atribut tidak boleh tertukar

**Input:** Ilustrasi dua karakter: A jaket merah di kiri, B jas biru di kanan. A menyerahkan buku kuning ke B. Jangan tambah karakter.

```text
An illustration of exactly two characters. Character A stands on the left side of the frame wearing a red jacket. Character B stands on the right side wearing a blue suit. Character A hands a yellow book to character B, with the book clearly visible between them. Keep the characters' clothing colors and left-right positions distinct and unchanged. Use a clear composition that makes the handover easy to read. No additional characters.
```

Gaya ilustrasi dipertahankan tanpa dipaksa menjadi foto; warna, jumlah, posisi, objek dan arah aksi tetap sesuai brief.

## 7. Refine setelah render gagal

**Input:** Hasil video bikin botol berubah bentuk pas kamera mendekat. Label produk harus tetap. Foto produk tersedia.

**Jika hasil video dan foto referensi dapat diperiksa:** verifikasi kapan perubahan bentuk terjadi dan elemen mana yang terpengaruh. Jika video belum tersedia, labeli masalah sebagai laporan pengguna, bukan observasi sendiri.

```text
Use the supplied product image as the appearance reference. The bottle remains stationary and rigid throughout the shot. Preserve its silhouette, proportions, cap, label artwork, and exact label text. The camera makes a slow, straight push-in without orbiting, keeping the full bottle within the frame. Keep lighting stable and reflections subtle so the label remains visible. Do not rotate, deform, or transform the bottle. One continuous shot.
```

Revisi ini merupakan usulan untuk mengurangi gerakan yang bersaing. Keberhasilannya baru dinilai setelah render berikutnya; jika brief asli memerlukan orbit, jangan menghapus orbit tanpa menyelesaikan prioritas bersama pengguna.

## 8. Teks persis dan transparansi

**Input:** Edit logo ini: ganti teks jadi “Kopi Pagi”, pertahankan ikon, warna dan background transparan. Hanya prompt Bahasa Indonesia.

```text
Edit logo pada gambar referensi dengan mengganti hanya teksnya menjadi “Kopi Pagi”, dengan kapitalisasi dan ejaan persis seperti itu. Pertahankan ikon, warna, proporsi, posisi elemen, dan framing asli. Pertahankan latar belakang transparan; jangan tambahkan latar putih, bayangan, objek, atau teks lain.
```

Teks dan transparansi tetap menjadi detail wajib; belum ada klaim gambar berhasil diedit.

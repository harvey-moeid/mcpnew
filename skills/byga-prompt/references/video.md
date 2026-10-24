# VIDEO, image-to-video, dan edit video

## Satu shot yang dapat dikerjakan

Mulai dengan keadaan awal, jelaskan aksi yang terlihat, tentukan gerakan kamera, lalu keadaan akhir. Pertahankan identitas, pencahayaan, dan kontinuitas selama shot kecuali perubahan memang diminta.

Urutan praktis: subjek dan lingkungan → keadaan awal → aksi berurutan → kamera/framing → cahaya/gaya → keadaan akhir → batasan penting. Durasi dan rasio mengikuti brief atau kontrol generator; jangan mengarang batas model.

- Gunakan satu aksi utama untuk klip singkat; gerakan kecil sekunder boleh membantu konteks.
- Pilih kamera yang konsisten: locked-off, slow push-in, pan, tracking, orbit, atau handheld sesuai maksud. Jangan menyatukan arahan yang bertentangan.
- Jelaskan gerak subjek terpisah dari gerak kamera. Arah kiri/kanan harus jelas terhadap frame bila penting.
- Pertahankan fisika dan kontinuitas: objek tidak teleport, pakaian tidak berubah, anggota tubuh atau produk tidak berubah bentuk tanpa permintaan.
- Jangan mengubah prompt tenang menjadi rangkaian aksi cepat atau menambahkan cut ketika pengguna meminta one-take.

## Image-to-video

Jika gambar dilampirkan, gunakan sebagai anchor visual awal sesuai kemampuan tool. Fokus prompt pada apa yang bergerak, bagaimana kamera bergerak, dan apa yang tetap. Jangan menulis ulang seluruh adegan sehingga bertentangan dengan gambar.

Contoh pola: `Use the supplied image as the visual reference. The subject [ACTION]. The camera [MOVEMENT]. Preserve [IDENTITY/PRODUCT/ENVIRONMENT DETAILS]. End with [FINAL STATE].`

Gambar yang tidak tersedia harus ditandai `[GAMBAR REFERENSI]`; jangan mengarang ciri yang belum terlihat. Kendali first/last frame, keyframe, atau motion brush hanya ditawarkan jika model mendukungnya dan sudah diverifikasi.

## Beberapa shot

Pecah menjadi shot terpisah hanya bila diminta atau kebutuhan ceritanya memang memerlukan pergantian adegan. Cantumkan urutan, prompt per shot, durasi bila diberikan, dan sambungan kontinuitas. Jika ada timecode, rentang harus berurutan tanpa gap/overlap dan totalnya sama dengan durasi yang ditentukan.

Jangan menganggap satu generator dapat mengeksekusi seluruh storyboard dalam satu panggilan. Jelaskan bahwa shot dapat dirender terpisah dan digabungkan jika itu diperlukan.

## Audio dan teks

Pertahankan dialog dalam bahasa dan ejaan yang diminta; tulis terpisah dari arahan visual. Masukkan musik, ambience, VO, atau lip sync hanya bila diminta. Jika model tidak mendukung audio atau dukungannya belum diketahui, berikan sebagai catatan editing terpisah; jangan menjanjikan audio sudah dirender.

## Edit video

Tentukan rentang atau shot yang diubah, perubahan yang diminta, serta elemen tetap seperti identitas, durasi, frame rate, audio, dan framing jika diketahui. Jangan mengarang fitur edit temporal, masking, atau penguncian karakter suatu model.

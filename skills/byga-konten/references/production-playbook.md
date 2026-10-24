# BYGA TikTok Creative Studio — Production Playbook
Dokumen referensi untuk sumber (Knowledge) di Proyek ChatGPT pribadi. Gunakan bersama Master Instructions; instruksi pengguna dalam percakapan selalu mengendalikan tugas spesifik.

## A. Alur produksi ideal
1. Terima brief: akun, target penonton, tujuan, niche, format, topik/produk, aset referensi, durasi/jumlah slide, gaya, CTA, generator target.
2. Pilih satu sudut kreatif terkuat. Jika ide belum jelas, tawarkan beberapa angle yang berbeda dan rekomendasikan satu.
3. Susun logika naratif: hook → eskalasi/poin utama → payoff → CTA; untuk konten produk masukkan demo yang benar-benar terlihat.
4. Kunci identitas visual, karakter, dan dunia; baru pecah ke slide/shot. Gunakan prompt konsisten tanpa mengorbankan variasi komposisi.
5. Produksi aset sesuai kemampuan alat yang tersedia; jangan mengganti video yang diminta dengan gambar tanpa pemberitahuan.
6. QC: fakta, kebahasaan, kesinambungan karakter, timecode, area aman, keterbacaan, kecocokan audio, dan ketepatan CTA.

## B. Production brief — diisi hanya bila informasinya diketahui
- Akun/brand:
- Format: Carousel / Image / Video / UGC / Tren / Drama
- Audiens dan masalah/minat:
- Tujuan: reach / follow / save / comment / klik / konversi
- Topik dan klaim yang terbukti:
- Emosi utama:
- Durasi/jumlah slide:
- Bahasa, tone, dan gaya visual:
- Aset gambar/produk yang wajib dipertahankan:
- Teks persis yang wajib tampil:
- CTA:
- Model AI/generator yang digunakan:
- Batasan:

Jika brief singkat, isi asumsi yang aman dan mulai produksi; jangan memaksa pengguna mengisi formulir.

## C. Sistem prompt visual

### C1. Master visual identity
Brand: [brand]. Format: [ratio]. Subject: [identitas tetap]. Visual style: [genre + medium]. Palette: [warna]. Texture: [material]. Lighting: [kondisi cahaya]. Camera language: [framing + lens]. Layout rules: [safe margins]. Consistency: never change [ciri penting]. Exclusions: [yang tidak boleh muncul].

### C2. Image prompt per frame
"[Describe one clear subject and its identity]. [Concrete expression and physical action]. Location: [specific location and props]. Composition: [shot size, perspective, visual hierarchy]. Lighting: [source, direction, mood]. Aesthetic: [style, palette, level of realism]. Preserve exactly: [reference characteristics]. Vertical 9:16; subject framed away from interface overlays. No incidental words, watermarks, or fake brand logos."

Jika teks visual memang harus dihasilkan, tambahkan hanya kata yang ditentukan pengguna, dengan posisi, hierarki, dan fallback overlay editor bila tidak akurat.

### C3. Video prompt per shot
"SHOT [number], duration [seconds]. Keep the SAME [character details / wardrobe / props / environment] as the reference. Start frame: [exact pose + placement]. Action: [single plausible movement with timing]. Facial expression: [emotion]. Camera: [shot size + one motivated movement]. Lighting: [specific source + continuity]. Background: [stable setting]. End frame: [pose or composition for matching next shot]. Style: [realistic/cinematic/etc]. Vertical 9:16. Avoid sudden scene change, facial morphing, extra limbs, disappearing props, on-screen gibberish."

Dialog Indonesia diletakkan di blok terpisah dengan speaker dan timing. Jika model mendukung dialog native audio, sesuaikan input setelah verifikasi kemampuan model; jika tidak, siapkan VO/TTS untuk pengeditan.

### C4. Character lock
- Nama karakter dan peran:
- Usia tampak:
- Bentuk wajah, mata, rambut, warna kulit, tinggi/postur:
- Pakaian inti, aksesori:
- Gesture khas, ekspresi dan cara bicara:
- Suara (kualitas/tempo/logat bila diminta):
- Detail yang tidak boleh berubah:
- Foto referensi primer bila tersedia:

Untuk konsistensi ekstrem, buat gambar referensi/keyframe karakter terlebih dulu, lalu gunakan keyframe itu untuk shot-shot berurutan bila generator mendukung. Prompt teks saja tidak menjamin wajah identik.

### C5. World lock + continuity ledger
World: lokasi, waktu, musim, palet, sumber cahaya, denah kasar, dekor dan properti. Ledger per shot: siapa yang ada, posisi relatif, arah tatap, pakaian, objek yang dipegang, awal/akhir gerakan, aksi yang baru selesai. Jika karakter memegang gelas di shot A, lanjutkan keberadaan gelas secara masuk akal di shot B.

## D. Template output per mode

### D1. Carousel 8 slide (adaptif)
1. Hook kuat: masalah/pertanyaan/kontras, visual paling mencolok.
2. Konteks/premis: jelaskan janji konten.
3. Insight pertama.
4. Insight kedua.
5. Contoh/ilustrasi yang konkret.
6. Hal mengejutkan atau kesalahan umum.
7. Kesimpulan/pembelajaran.
8. CTA yang sesuai tujuan (follow, save, komentar), bukan hard sell otomatis.
Untuk cerita atau tarot, urutan boleh diubah agar masuk akal. Tetap tulis teks final + visual prompt *setiap* slide, bukan hanya outline.

QC carousel: satu fungsi slide jelas; headline mudah dipindai; body tidak padat; kontras memadai; margin aman; teks yang diminta tidak hilang; brand konsisten.

### D2. Text-to-image: paket produksi
Tampilkan ringkasan gaya bila seri, prompt individual dalam bahasa yang cocok generator, negative prompt opsional, dan apa yang harus dipertahankan dari referensi. Hindari instruksi bertentangan seperti "extreme close-up" sekaligus "full-body wide shot".

### D3. Text-to-video 30 detik (contoh ritme)
- 0–3 s: hook/pattern interrupt.
- 3–8 s: situasi atau alasan menonton.
- 8–18 s: perkembangan/aksi/penjelasan.
- 18–25 s: reveal/payoff/demo.
- 25–30 s: resolusi dan CTA bila relevan.
Contoh hanyalah template, bukan kewajiban seluruh genre. Pecah secara praktis mengikuti batas klip generator. Total durasi dan waktu dialog harus konsisten.

### D4. UGC
- Hook problem atau hasil yang *dapat dibuktikan*.
- A-roll berupa percakapan yang tidak terlalu sempurna.
- B-roll menunjukkan produk, cara pakai, detail terlihat.
- Hindari testimoni palsu atau kalimat “saya sudah pakai 30 hari” tanpa dasar.
- Jika tidak ada data produk, tetap buat struktur kreatif dengan placeholder agar pengguna bisa mengisinya, bukan membuat klaim.
- CTA sesuai platform/kemitraan dan disclosure promosi yang berlaku.

### D5. Tren / Viral
Buat matriks ide (poin 1–5 subjektif): kekuatan hook, kecocokan audiens, potensi share/save, kemudahan produksi, diferensiasi. Skor kreatif bukan prediksi views. Untuk tren aktual, sumber dan tanggal diperlukan bila disebut “sedang viral”. Gunakan format/tren sebagai inspirasi, bukan menyalin skrip atau video pesaing.

### D6. Drama serial
Bangun premise -> escalation -> dilemma -> consequence. Siapkan "Previously on" untuk serial jika pengguna ingin. Cliffhanger harus membuka pertanyaan cerita yang nyata, bukan memotong adegan acak. Jaga logika hubungan, jam/hari, barang bukti, posisi karakter. Setelah episode selesai, rangkum 3–6 fakta baru ke Story Bible bila diminta atau jika seri akan berlanjut.

## E. Caption dan hashtag
Caption ideal bersifat natural dan relevan, dapat berupa hook alternatif, pertanyaan, insight, dan CTA. Hashtag secukupnya: topik spesifik + niche + akun/brand bila sesuai. Jangan selalu memakai tag umum seperti #fyp secara acak atau mengklaim satu set hashtag pasti viral.

## F. Preset brand
### @jalurtarot
Mystic Purple + Gold, premium, elegan, misterius hangat. Tata letak vertikal rapi dan mudah dibaca. Konten tarot/numerologi disampaikan sebagai refleksi atau hiburan tanpa janji hasil pasti. CTA yang paling sering dipakai adalah Follow @jalurtarot bila tujuan konten membangun akun.

### Akun lain / konten UGC / drama
Jangan warisi warna, logo, atau gaya dari @jalurtarot tanpa diminta. Jika brand belum jelas, pakai gaya editorial modern yang cocok dengan niche.

## G. QC pra-produksi (cek internal)
1. Ide punya penonton sasaran dan nilai yang jelas.
2. Hook benar-benar dikembangkan menjadi payoff, bukan clickbait.
3. Jumlah slide/shot dan timecode tepat.
4. Teks final benar, pendek, terbaca, dan tidak berkontradiksi.
5. Setiap prompt menghasilkan satu komposisi utama yang masuk akal.
6. Karakter, wardrobe, produk, properti, dunia, dan gerak konsisten.
7. Klaim tentang produk, kesehatan, uang, dan performa hanya bila didukung fakta.
8. Caption/CTA/hashtag sesuai tujuan; tidak berlebihan.
9. Prompt disesuaikan dengan alat produksi yang benar-benar tersedia.
10. Tidak mengaku telah merender aset bila output baru konsep atau prompt.

## H. Perintah cepat yang dapat dikenali
- "Menu" → tampilkan enam mode.
- "C: 8 slide tentang ..." → carousel lengkap.
- "I: prompt karakter ini, pertahankan wajah" → prompt visual.
- "V: video 30 detik tentang ..." → produksi video shot-by-shot.
- "U: UGC produk [detail], 20 detik" → iklan natural berbasis fakta.
- "T: ide tren minggu ini untuk niche ..." → riset bila penelusuran tersedia.
- "D: episode 1 drama ..." → episode lengkap dan Story Bible.
- "Lanjut episode 2" → sambung dengan kontinuitas.
- "Buat gambar final" → buat gambar memakai alat yang tersedia.
- "Hanya prompt" → jangan tambah storyboard panjang.
- "Maksimalkan" → fokus perbaikan hasil, bukan filler.

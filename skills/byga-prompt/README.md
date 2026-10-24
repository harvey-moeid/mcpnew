# BYGA Prompt — Gambar & Video v2.0

Skill untuk menyempurnakan prompt text-to-image, text-to-video, image-to-video, dan edit visual. Menjaga maksud, detail wajib, karakter/produk, serta teks persis sambil memperjelas komposisi, cahaya, kamera, dan gerakan.

## Penggunaan melalui MCP

1. Panggil `list_skills` dan cari `byga-prompt` setelah source sudah di-push dan Worker yang memuat registry baru sudah di-deploy.
2. Panggil `get_skill_instructions(name="byga-prompt")`.
3. Muat referensi yang diperlukan melalui `read_skill_file`; lalu berikan prompt asli dan kebutuhan visual.

Contoh permintaan:

- `Gunakan byga-prompt: foto produk kopi di meja kayu, natural, 1:1.`
- `Enhance prompt video ini, pertahankan karakter dan dialog, kamera slow push-in.`
- `Perbaiki prompt image-to-video dari foto ini. Hanya prompt, jangan render.`
- `Buat tiga variasi prompt gambar: minimalis, editorial, dan ilustrasi.`

## Isi paket

- `SKILL.md`: alur kerja, aturan menjaga maksud, format keluaran, dan QC.
- `references/image.md`: gambar, produk/karakter, dan edit.
- `references/video.md`: gerakan, kontinuitas, image-to-video, dan audio.
- `references/model-compatibility.md`: penyesuaian model tanpa mengarang fitur atau parameter.
- `references/visual-direction.md`: prioritas brief, peran referensi, dan kontinuitas seri.
- `references/evaluation.md`: evaluasi prompt vs hasil render, iterasi, dan benchmark.
- `assets/prompt-brief.md` dan `assets/evaluation-card.md`: template brief/evaluasi bila dibutuhkan.
- `examples/before-after.md`: contoh prompt beserta detail yang dipertahankan.

Folder ini juga dapat disalin ke direktori skill yang didukung host, misalnya `.agents/skills/byga-prompt/` untuk penggunaan per-repo pada host yang mendukungnya. Konfirmasi discovery dari host; file di folder `skills/` tidak otomatis menjadi native skill ChatGPT.

## Batas verifikasi

Skill berisi instruksi dan referensi, tanpa dependencies atau skrip eksekusi. Skill tidak menyediakan generator gambar/video, tidak mengaktifkan layanan berbayar, dan tidak menjamin hasil visual. Tes registry/validasi paket membuktikan pemuatan dan struktur file; penilaian mutu visual membutuhkan uji generator yang tersedia.

## Mode dan mutu

Mode: ENHANCE, DIAGNOSE, VARIANTS, REFINE, SERIES, dan HANDOFF. Default tetap satu prompt siap salin; `hanya prompt` tidak menambahkan laporan QC.

Versi 2 memperkuat penguncian detail wajib, pembagian fungsi referensi, konsistensi antar-shot, pemisahan gerak kamera/subjek, penyelesaian konflik, dan evaluasi hasil. Review prompt dapat memeriksa instruksi; kualitas render hanya dinilai dari media yang benar-benar tersedia. Target 99,9% bukan klaim akurasi atau tingkat keberhasilan. Benchmark membutuhkan brief representatif, kriteria lulus, model/setting, dan hasil aktual.

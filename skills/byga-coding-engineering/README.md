# BYGA Coding Engineering — Personal Agent Skill

Skill pribadi untuk audit, build, debugging, PR review, GitHub Actions, Cloudflare, D1/R2/KV, keamanan, performance, AI integration, trading apps, WebGL/3D, dan deployment. Dibuat dari master prompt **BYGA Coding Engineering Studio** dan engineering playbook milik pengguna.

## Isi paket

- `SKILL.md`: manifest dan aturan kerja inti, dibaca agen ketika skill dipilih.
- `references/`: instruksi lengkap, workflow, Cloudflare, security dan AI.
- `assets/`: template laporan audit, ringkasan PR, dan preflight deploy.
- `scripts/repo_inventory.py`: inventory metadata project yang read-only, tidak membaca file secrets.

## Cara memasang — ChatGPT Skills (akun/workspace eligible)

1. Buka ChatGPT > **Plugins** > **Skills**.
2. Pilih **Create** > **Upload from your computer**.
3. Unggah `BYGA_Coding_Engineering_Skill.zip` (berisi tepat satu folder root skill).
4. Tinjau hasil scan dan instruksi, lalu install/aktifkan jika tersedia. Pastikan akses disetel pribadi / tidak dibagikan.
5. Coba: `Gunakan skill byga-coding-engineering untuk audit workflow repo saya.`

**Penting:** Dukungan Skills langsung di ChatGPT tergantung plan, workspace dan izin. Menyiapkan ZIP tidak otomatis menginstalnya. Untuk ChatGPT Plus pribadi, gunakan opsi Codex atau Project jika tab Skills tidak tersedia.

## Cara memasang — Codex lokal (Windows 10/11)

Ekstrak ZIP lalu salin folder `byga-coding-engineering` sebagai folder berikut:

- Untuk satu repo: `<REPO>/.agents/skills/byga-coding-engineering/`
- Untuk pemasangan pribadi lintas repo: `~/.agents/skills/byga-coding-engineering/` (gunakan home user yang dipakai Codex).

Contoh PowerShell dari folder unduhan (sesuaikan path hasil ekstrak):

```powershell
$dest = Join-Path $HOME '.agents\skills\byga-coding-engineering'
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item -Path '.\byga-coding-engineering' -Destination $dest -Recurse -Force
Test-Path (Join-Path $dest 'SKILL.md')
```

Restart/refresh sesi Codex bila diperlukan; lalu minta `Gunakan skill byga-coding-engineering untuk memperbaiki CI repo ini`. Skill sendiri tidak memberikan akses GitHub, Cloudflare, atau permission deploy.

## Cara memasang — ChatGPT Project pribadi

Jika Skills belum tersedia di akun, buat Project `BYGA Coding Engineering Studio` dan tempel `references/original-master-instructions.md` ke Project Instructions; tambahkan ZIP atau Markdown referensi ke file proyek. Ini membuatnya sebagai konteks proyek, **bukan** skill global.

## Penggunaan

- `Cek root cause D1 writes tinggi. Jangan ubah data produksi dulu.`
- `Perbaiki workflow merah, tambah regression test, buat PR bila akses dan izin memungkinkan.`
- `Audit PR ini seperti Principal Engineer, beri temuan dengan file dan severity.`
- `Review semua langkah preflight sebelum deploy Cloudflare production.`

## Keamanan

Skill ini hanya berisi instruksi, referensi, template dan skrip analisis read-only. Tidak mengandung API key, token atau koneksi otomatis ke akun. Periksa script dan kode sebelum menjalankannya. Menyalin skill **tidak** memasang layanan, mengaktifkan model baru, atau menjamin hasil 99,9%.

Versi: 1.0 | Dibuat: 2026-10-18

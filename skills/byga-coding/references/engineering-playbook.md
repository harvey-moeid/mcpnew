# BYGA Coding Engineering Studio — Engineering Playbook v1.0

> **Fungsi:** Referensi operasional tambahan untuk Project Knowledge. **Instruksi proyek utama** tetap menjadi titik kendali. Playbook ini bukan sumber kebenaran tentang repo aktual; selalu verifikasi dari GitHub, Cloudflare, log, dan kode nyata.

## 0. Prinsip kerja

- **Observe → Hypothesize → Reproduce → Fix → Prove → Deliver → Monitor.**
- Read-only inspection lebih dahulu; ubah area yang paling sempit untuk menyelesaikan permintaan.
- Jangan memalsukan eksekusi tool, hasil test, deployment, status PR, atau kapasitas fitur eksternal.
- Bedakan fakta terobservasi, kemungkinan penyebab, perubahan yang sudah dieksekusi, dan rekomendasi belum diterapkan.
- Tindakan berisiko tinggi perlu target yang jelas, guard, backup/rollback, dan izin.
- Selalu preserve uncommitted work dan perubahan orang lain.

## 1. Routing: perintah → produk akhir

| Permintaan | Tindakan utama | Bukti kelulusan |
|---|---|---|
| “Cek PR” | Review diff, commit, checks, risiko, komentar | Temuan dengan file/line + tes/status PR |
| “Perbaiki PR/workflow merah” | Fetch failed checks/log; akar masalah; patch minimal | Log penyebab, diff, run/tes berikutnya |
| “Tambah fitur” | Kontrak, acceptance, implementasi, tes | Demo/test dan file yang berubah |
| “Blank screen” | Console/runtime, asset path, routing, CSP, env, 3D | Error reproduksi, smoke load, fallback |
| “Deploy Cloudflare” | Target env, wrangler/bindings, preflight, deploy, smoke | Deployment id/URL + health check aktual |
| “Kenapa D1 write tinggi?” | Analisis query per trigger, schedule, backfill, retries | Breakdown sumber writes + tindakan penghematan |
| “Audit keamanan” | Threat model, secrets, auth, injection, deps | Temuan severity + mitigasi |
| “Optimalkan FPS 3D” | Profile CPU/GPU/memory/quality tiers | Metrik sebelum/sesudah dari alat yang ada |
| “Buat arsitektur/PRD” | Kebutuhan, design decision, diagram, risiko, milestone | Scope dan acceptance criteria terukur |
| “Rollback” | Pahami perubahan, database kompatibilitas, backups | Target versi dan verifikasi rollback |

## 2. Discovery checklist

- Pastikan nama repo, owner, branch, base branch, environment, dan commit HEAD.
- Baca README, CONTRIBUTING, package manifest, lockfile, tsconfig, workflows, wrangler, migrations, .env.example (jangan membaca/menyalin nilai secret).
- Cari kode produksi yang terkait permintaan; hindari membaca semua file bila pencarian terarah cukup.
- Cek isu/PR, perbedaan lokal/remote, status dirty worktree, versi Node/runtime, package manager.
- Catat constraints yang sudah ditetapkan pengguna (mis. read-only binding ke D1 untuk aplikasi tertentu, cadence cron, compatibility API).
- Jangan mengeksekusi script instalasi dari repo tak tepercaya tanpa memahami efeknya.

## 3. Perbaikan bug berbasis bukti

### Alur
1. **Symptom:** apa yang terlihat, kapan, environment apa.
2. **Evidence:** log/stack trace, request/response tersanitasi, recent changes, reproduksi.
3. **Hypotheses:** 1–3 penyebab urut berdasarkan bukti.
4. **Isolation:** uji paling murah dan aman yang membedakan hipotesis.
5. **Fix:** ubah akar masalah minimal.
6. **Regression:** test otomatis atau langkah manual terukur.
7. **Guard:** logging, exception handling, feature flag, canary/rollback jika risiko tinggi.

### Contoh: layar hitam Worker/3D
- Periksa network 404/500, CSP, JS fatal exception, asset hashed filenames, fallback route SPA, import alias, bundler base path.
- Periksa WebGL context failure, dynamic import, loader timeout, memory/GPU, renderer disposal, hydration mismatch.
- Sediakan fallback UI yang jelas jika scene gagal; jangan menyembunyikan error dengan layar kosong.
- Pastikan mobile medium/low quality masih menjalankan interaksi utama.

## 4. GitHub Actions — checklist mendalam

### Duplikasi / pemborosan menit
- `push` dan `pull_request` pada branch sama dapat menjalankan dua pipeline; identifikasi mana yang diperlukan.
- Pisahkan lint/typecheck/unit/Playwright dan jangan menjalankan suite sama dua kali tanpa alasan.
- Gunakan `concurrency.group` yang stabil per workflow + PR/branch dan `cancel-in-progress` untuk PR; deployment release/production perlu perlakuan tersendiri.
- Batasi `permissions:` sedekat mungkin dengan minimum yang dipakai.
- Cache dependency sesuai lockfile, hindari cache output sensitif atau tak aman.
- Artifact hanya saat berguna, retention singkat sesuai kebijakan, jangan hapus yang diwajibkan audit.
- Deployment hanya dari branch/tag/event yang diizinkan, dan jangan dari PR fork dengan secrets.
- Cek reusable workflow agar tidak memicu build/test/deploy ulang tanpa sengaja.

### Contoh pola — hanya ilustrasi, sesuaikan repo
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test --if-present
      - run: npm run build --if-present
```
Catatan: versi actions/Node, cakupan tes, keamanan supply chain dan syntax repository harus dicek aktual. Contoh ini bukan jaminan bahwa desain concurrency cocok bagi semua proyek.

## 5. Cloudflare Workers/Pages — preflight dan deploy

### Preflight
- Tentukan `staging`/`production`; periksa `wrangler.toml/jsonc`, scripts, compatibility date/flags, routes/custom domains, `vars`, bindings D1/R2/KV/DO, secret names, cron triggers.
- Periksa jenis otorisasi cloud: read-only atau write. Jangan memakai environment prod untuk eksperimen.
- Untuk perubahan DB, baca migrations status dan rencana rollback. Jangan mengandalkan rollback kode untuk membalik perubahan schema/data.
- Periksa origin/CORS, auth admin (Cloudflare Access bila dipakai), frontend `PUBLIC_ORIGIN`, callback URL, WebSocket upgrade.
- Smoke test endpoint auth dan non-auth, halaman utama, fungsi core, monitor runtime errors.

### Rollout bertahap
1. Audit git/workflow dan build lokal.
2. Jalankan migration yang kompatibel dan mempunyai backup jika diperlukan.
3. Deploy target yang tepat (staging dulu untuk perubahan besar).
4. Periksa deployment id, health, logs, fungsi core, dan biaya.
5. Jika regresi: rollback code yang kompatibel atau forward-fix, sesuai risiko data.

## 6. D1: hemat kuota, aman data

### Root cause matriks
| Gejala | Kandidat penyebab | Verifikasi |
|---|---|---|
| Writes tinggi tiap 5 menit | Upsert semua candle berulang | Trace jumlah rows berubah vs dieksekusi |
| Lonjakan serentak | Cron duplikat, retries, overlapping runs | Jadwal, locks, event id |
| Writes meningkat per symbol | Backfill terus-menerus / toggles tidak dihormati | Cursor backfill tiap symbol |
| D1 reads tinggi | Polling tanpa cache, query scan | Logs query dan execution plan |
| DB tumbuh cepat | Retention tidak dijalankan | Count tabel/timestamp |

### Pola optimasi
- Idempotency keys pada event, candle close timestamp unik, dan checkpoint backfill agar tidak mengulang.
- Hindari `UPSERT` tanpa syarat bila nilai identik masih menimbulkan kerja tulis; verifikasi semantik DB.
- Batch queries/transaksi dengan batas yang benar, gunakan indeks sesuai query nyata; indeks pun memiliki biaya write.
- Cache hasil read yang bisa stale dan gunakan R2 untuk objek JSON/media besar; jangan memindahkan data transaksional ke KV asal-asalan.
- Gunakan toggles backfill masing-masing simbol yang benar-benar dihormati scheduler.
- Sediakan opsi backfill manual/resume, rate limit, dan checkpoint tanpa memutus ingest realtime.
- Jangan hapus data atau mematikan collector yang diwajibkan tanpa persetujuan dan dampak yang jelas.

## 7. Webhook/TikTok LIVE/realtime

- Verifikasi asal & signature (bila didukung layanan), secret comparison aman, rate limit dan timestamp/replay window.
- Dedup `event_id` untuk like/gift/comment; handle event out of order dan multi-user simultan.
- Respon webhook cepat, gunakan queue/background pattern jika platform mendukung; jangan memblokir request sambil menjalankan video/AI panjang.
- Reconnect WebSocket dengan exponential backoff + jitter, heartbeat, timeout, circuit breaker; laporkan status konektor yang nyata.
- Pisahkan `connected`, `authenticated`, `room_verified`, `events_received`, dan `delivery_acked` dalam status agar tidak salah melaporkan sukses.
- Tidak semua endpoint TikTok/Eulerstream disediakan secara bebas; cek syarat paket/akses aktual sebelum menjanjikan integrasi.

## 8. AI orchestration dan trading

### Multi-provider
- Config per role untuk provider/model; validasi bahwa model ada dan endpoint kompatibel.
- Fallback bertingkat: hanya retry pada error retryable, ada timeout, batas biaya, logging aman, dan health provider.
- Structured output harus divalidasi schema, termasuk semantik: hanya vote BUY/SELL jika keputusan dua arah diwajibkan; reject nilai invalid.
- Jangan diam-diam mengganti prompt terkunci atau mengganti provider tanpa jejak.

### Market data
- Timestamp UTC di storage + WIB untuk presentasi; source of truth eksplisit.
- Bedakan latest tick, candle *open*, candle *closed*, incomplete history, stale feed.
- Hindari lookahead bias, future leakage, duplicate signal/execution; entry/SL/TP tetap divalidasi risiko.
- Data perdagangan asli dan order live adalah operasi berdampak finansial: default simulasi/read-only kecuali secara jelas diotorisasi.

## 9. Frontend/3D

- Responsive breakpoints dan layout mobile, safe-area insets, keyboard, portrait/landscape.
- Accessibility: label, focus state, navigasi keyboard, kontras, reduced motion.
- 3D: kualitas low/medium/high, LOD, pixelRatio cap, instancing, lazy loading, disposal resources, fallback canvas, animasi path non-teleport, hit target karakter.
- Uji visual sebelum/sesudah pada mobile kecil dan desktop; jangan fokus pada desktop saja.
- Saat halaman putih/hitam: prioritaskan error boundary dan diagnosis dibanding menyembunyikan error.

## 10. Security review mini threat model

**Assets:** secrets, data akun, admin actions, uang/kuota, API keys, webhook trust, data trading.

**Threats:** unauthorized admin, prompt injection lewat data repo/tool, server-side request forgery, SQL injection, XSS, leaked env keys, replay webhook, API abuse, supply-chain compromise, overly-permissive GitHub token.

**Controls:** authn/authz setiap privileged API, signed webhook + timestamp, schema validation, output encoding, rate limit, CORS sesuai kebutuhan, secrets manager, dependency pinning/scan, least permissions, audit logs redacted.

**Severity:** beri level kritis/tinggi/sedang/rendah dengan alasan, exploitability, dampak, dan remediasi. Jangan memberikan kepastian aman hanya karena satu tes lolos.

## 11. Template acceptance criteria

Untuk tiap perubahan, tetapkan:
- **Expected behavior:** perilaku yang harus terlihat.
- **Negative cases:** input invalid, timeout, API down, duplicate event.
- **Data contract:** API/schema tetap kompatibel atau migrasi jelas.
- **Nonfunctional:** batas latency, biaya/writes, logging dan akses.
- **Tests:** set minimal wajib dan hasilnya.
- **Rollout/rollback:** bagaimana mengaktifkan/menonaktifkan dengan aman.

Contoh untuk toggle backfill per symbol:
- Admin dapat ON/OFF per symbol dan status tersimpan.
- OFF menghentikan job backfill simbol itu, tidak menghentikan ingest candle close yang memang diwajibkan.
- Job yang sedang berjalan memperhitungkan perubahan toggle pada checkpoint yang tepat.
- Tidak terjadi duplicate D1 writes pada retry/race.
- Ada log ringkas dan tes untuk default, toggle OFF, restart, retry, concurrency.

## 12. Template laporan akhir (jangan klaim tanpa bukti)

### Temuan
- **Masalah:** ...
- **Akar penyebab:** ... (terverifikasi / hipotesis)
- **Dampak:** ...

### Implementasi
- **Repo / branch / file:** ...
- **Perubahan:** ...
- **PR/commit/deploy:** URL/ID hanya kalau diberikan tool.

### Verifikasi
- `...`: PASS / FAIL / NOT RUN, beserta alasan.
- Smoke / CI / logs: ...

### Risiko / pemulihan
- **Known limitations:** ...
- **Rollback:** ...
- **Next action:** ...

## 13. Prompt cepat untuk menggunakan proyek

1. `@GitHub repo byga_office, audit 5 run Actions terbaru yang gagal, temukan root cause, buat perbaikan terkecil + tes regresi dan PR bila memungkinkan.`
2. `@Cloudflare audit D1 writes untuk kantorbtc. Cocokkan dengan cron, upsert candle, retries, dan backfill per simbol; jangan mengubah prod dulu. Berikan estimasi penyebab dan patch aman.`
3. `Perbaiki black screen halaman 3D. Investigasi asset loading, WebGL, error boundary, dan binding API; pertahankan mobile medium default.`
4. `Rancang API webhook idempotent untuk TikTok LIVE comments, likes dan gifts. Sertakan schema, auth, retries dan test concurrency.`
5. `Review diff PR ini seperti Staff Engineer: cari correctness, security, race, quota, dan regresi. Prioritaskan temuan nyata, bukan preferensi gaya.`
6. `Buat fitur ini end-to-end sesuai conventions repo, termasuk tests, docs, migrasi bila perlu, dan ringkasan file berubah.`
7. `Perbaiki workflow agar PR lama dibatalkan saat commit baru, tetapi deployment produksi tidak terganggu dan E2E tak digandakan.`
8. `Buat PRD dan implementation plan bertahap. Sertakan API/data flow, risiko, acceptance criteria, deployment dan rollback.`

## 14. Anti-pattern yang harus ditolak

- “Fix” dengan menghapus tes atau men-disable error reporting tanpa investigasi.
- Menambah fallback yang mengembalikan dummy success dan menyembunyikan outage.
- Mengubah batas akses dan secrets hanya agar deployment lolos.
- Menyatakan berhasil deploy hanya karena `wrangler` tersedia atau commit telah dibuat.
- Mengubah banyak repo/branch di luar scope.
- Menghapus data/workflow/history produksi tanpa target dan izin eksplisit.
- Menggunakan query DB yang merusak atau full-table update tanpa safeguard.
- Menambahkan dependensi tanpa alasan jelas atau audit lisensi/keamanan.
- Berasumsi yang aman bagi development juga aman bagi production.
- Menjanjikan “99,9% akurasi” tanpa pengujian yang mendukung.

## 15. Pengaturan praktik terbaik di proyek pribadi

- Simpan **Master Instructions** sebagai instruksi proyek.
- Unggah **Playbook** ke sumber proyek sebagai dokumentasi tambahan.
- Unggah README/arsitektur/ADR dan daftar constraints dari masing-masing repo jika sering digunakan.
- Buat percakapan terpisah untuk setiap repo atau masalah agar konteks tidak tercampur.
- Pakai tool GitHub dan Cloudflare ketika memberi izin; tanpa koneksi, minta diffs/log yang diperlukan atau sediakan patch yang dapat dijalankan.
- Untuk deployment berisiko, pastikan target environment dan rencana rollback eksplisit.

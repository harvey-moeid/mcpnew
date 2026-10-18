# Playbook operasional: Debug, CI, Review, Build

## A. Debug berbasis bukti
1. Tentukan symptom, waktu, environment, expected/actual behavior.
2. Cari bukti error: stack trace, failing request, latest diff, status service, log. Jangan ekspos secrets.
3. Rumuskan maksimal 3 hipotesis dan tes untuk membedakannya.
4. Reproduce (unit/integration/runtime). Hindari memodifikasi production demi reproduksi.
5. Perbaiki root cause. Tambahkan regression test yang tepat.
6. Periksa negatif: invalid input, duplicate event, stale state, timeout, concurrent requests.
7. Konfirmasi resolution hanya jika bukti sesudah fix tersedia.

### Blank screen di app 3D
- Console exception, network 404/500, wrong asset base path, worker SPA fallback, CSP, environment config.
- Three.js/WebGL context, shader support, async loaders, animation loop, scene initialization/hydration, GPU and memory.
- Tampilkan graceful error state, fallback low-quality; jangan sembunyikan error.
- Test viewport ponsel+desktop, orientation, kualitas low/medium/high.

## B. GitHub Actions — failure dan penghematan
- Tetapkan repo / workflow / run / job / commit SHA; ambil log gagal yang spesifik.
- Periksa `on: push/pull_request/schedule/workflow_dispatch/workflow_call` dan efek run ganda.
- Lihat concurrency group & cancel-in-progress; **jangan** sembarang batalkan deploy produksi saat PR berubah.
- Periksa matrix, reuse workflow, Playwright suite dua kali, artifact retention, cache by lockfile, permissions, secrets pada fork PR, environment protections.
- Prioritaskan satu sumber truth untuk test per event; jika mau mematikan run, buktikan run penggantinya mencakup quality gate yang sama.
- Sebelum PR: YAML valid, lint/typecheck/test/build yang dapat dijalankan, diff scoped.
- Laporkan tes yang masih butuh runner GitHub sesungguhnya.

## C. Review PR
- Temuan severity: Critical (data loss/security), High (correctness/runtime), Medium (stability/perf), Low (maintainability).
- Temuan harus ada file/line (bila tersedia), cuplikan perilaku, scenario bug, impact, minimal fix, verification.
- Pisahkan blocker dari suggestion. Hindari kritik gaya kosmetik tanpa dampak.
- Bila tidak ada temuan, jelaskan cakupan review dan keterbatasan; jangan menjamin bebas bug.

## D. Implementasi fitur
- Selaraskan scope, acceptance, kontrak API/schema, backward compatibility.
- Ikuti package manager dan lockfile. Jangan memasukkan dependensi tanpa verifikasi.
- UI: responsive, aksesibilitas, error/empty/loading, safe area dan performa mobile.
- Backend: validasi, auth server, transaksi yang sesuai, observability, rate limit, timeouts.
- Uji happy path + satu edge/failure case; periksa diff sebelum menyerahkan.

## E. Paket hasil
Gunakan `assets/audit-report.md` untuk audit, `assets/pr-summary.md` untuk PR, `assets/deploy-preflight.md` sebelum release.

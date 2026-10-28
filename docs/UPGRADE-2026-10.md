# MCPNEW: audit, upgrade dan batas verifikasi

Audit dilakukan pada base `0792b2579e9cc9bdd20e23443a99f137a5976f6d` (28 Oktober 2026), pada branch `feat/secure-transfer-upgrade`. Tidak ada merge, deploy, rotasi credential, perubahan branch protection, atau perubahan resource production dalam pekerjaan ini.

## Arsitektur yang dipertahankan

`src/index.ts` memakai Workers OAuth Provider untuk `/mcp`, DCR `/register`, `/authorize`, `/token`, dan protected-resource metadata. `MyMCP` tetap Durable Object dengan SDK terpasang; tidak ada penggantian transport atau migrasi sesi MCP. Dashboard Hono, AES-GCM untuk sesi browser di KV, cookie HttpOnly/Secure/SameSite, state browser terikat, D1 audit, lima skill BYGA dan alias lama tetap ada. `public/` hanya berisi gambar merek. Workflow CI tetap memeriksa PR; workflow Deploy tetap hanya push ke main dengan environment production. PR upgrade tidak memicu deployment tersebut.

Audit meliputi seluruh modul `src`, gambar `public`, README/konfigurasi instalasi, dokumentasi, migrasi SQL, scripts, tes, Dependabot dan kedua workflow. Tidak ditemukan alasan mengganti arsitektur yang sudah berjalan. Env ambient lama tetap dipakai agar tipe secrets opsional tidak mengubah konfigurasi produksi secara tidak sengaja; binding API diperiksa terhadap tipe Workers terpasang dan tipe terbaru.

## Temuan dan implementasi

| Temuan | Dampak | Perbaikan |
| --- | --- | --- |
| Upload mempercayai ukuran header; belum memverifikasi objek setelah put | Sukses belum membuktikan ukuran/integritas tersimpan | Hitung byte aktual dengan batas, SHA-256 native R2, HEAD terpisah, metadata checksum dan MIME; binary round trip diuji |
| Tiket hanya di KV eventual-consistent dan tanpa cancel | Replay bersamaan dan cancellation sulit dikoordinasikan | Klaim/status atomik D1; revoke + tombstone akses; cleanup; tiket lama tetap diterima maksimal sisa 10 menit |
| Tidak ada import URL terkontrol | Client tanpa akses file lokal tidak punya jalur pengiriman alternatif | `upload_file.source_url`, HTTPS allowlist exact, tanpa credential/redirect, timeout header+body dan batas 25 MiB |
| R2 REST mengenkode `/` sebagai `%2F` | Nested object keys gagal pada API yang mensyaratkan slash literal | Encode setiap segmen, pertahankan slash, tolak dot-segment |
| Cursor R2 dibaca dari `result`, bukan `result_info` | Halaman berikutnya hilang | Baca `result_info.cursor/is_truncated`, termasuk halaman kosong setelah filter |
| GET R2 selalu menjadi teks | Binary rusak dan respons bisa tak terbatas | Mode `base64`, UTF-8 strict, batas inline 1 MiB |
| Create-only R2 bergantung header REST yang tidak dijamin spec | Risiko overwrite diam-diam | Binding R2 `onlyIf`; bucket tanpa binding wajib overwrite+konfirmasi eksplisit |
| Sebagian tool sesi lama tidak memeriksa ulang allowlist | Akses dapat berlanjut setelah pencabutan lokal | Seluruh tool memeriksa allowlist pada pemanggilan; prompt pembaca data juga diperiksa |
| Token Cloudflare bersifat authority bersama | Akun GitHub tambahan berpotensi memperoleh akses administratif | Allowlist admin opsional terpisah; jalur admin objek menolak prefix file privat |
| Octokit default dapat mengulang write; sebagian CF fetch tanpa timeout | Duplikasi/permintaan menggantung | Retry plugin dan throttle retry dimatikan; GET/HEAD 502/503/504 maksimal satu retry; write tidak diulang; timeout request 15 detik |
| Rename GitHub decode binary lalu reencode UTF-8 | Isi file binary berubah | Gunakan SHA blob asli pada snapshot commit, cegah overwrite destination, update ref tanpa force |
| Multi-file commit tidak membatasi fanout/total input | Tekanan API/memory | Maksimal 100 file dan 1 MiB total UTF-8, path unik/relatif; batch blob maksimal lima request |
| Skill eksternal mengikuti branch mutable dan Contents API dapat dereference symlink | Instruksi berubah setelah install atau keluar direktori skill | Import baru dipin commit SHA, tiap komponen diperiksa melalui Git tree, hanya blob reguler, byte/UTF-8/binary limits |
| Error provider dapat memantulkan secret | Data sensitif masuk respons | Redaksi token akun/secret yang diketahui pada hasil tool; error upload/OAuth aman; ringkasan audit tidak merekam body/token/URL sumber |
| Runner Node di lingkungan ini melaporkan hanya exit tiap file | Tes tampak lolos tanpa kasus berjalan | Runner menjalankan tiap modul `node:test` secara langsung dan meneruskan exit gagal; hasil akhir menghitung kasus nyata |

## Referensi yang dipelajari

Tidak ada kode dari repository referensi yang disalin. README, struktur, metadata lisensi dan entrypoint relevan dibaca melalui GitHub; versi referensi dapat berubah setelah tanggal audit.

| Referensi | Lisensi yang diamati | Keputusan desain |
| --- | --- | --- |
| [leelakanakala/github-mcp](https://github.com/leelakanakala/github-mcp) | README menyebut MIT; file LICENSE tidak ditemukan di root, metadata lisensi null | Pelajari OAuth + Durable Object, jangan ambil kode tanpa grant lisensi yang jelas |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) | MIT | Tambah operasi GitHub terarah, pagination dan metadata izin; tidak menduplikasi seluruh katalog upstream |
| [cloudflare/mcp](https://github.com/cloudflare/mcp) | Apache-2.0 | Boundary Host/Origin dan hasil terbatas; Code Mode belum diadopsi karena eksekusi kode/scope perlu desain terpisah |
| [cloudflare-r2-remote-mcp-worker](https://github.com/XxYouDeaDPunKxX/cloudflare-r2-remote-mcp-worker) | MIT | Pisahkan binding upload, akses file privat, transfer binary dan kemampuan admin |
| [bytask/github-mcp-worker](https://github.com/bytask/github-mcp-worker) | MIT | Respons GitHub ringkas, job log terikat ukuran, credential tidak diteruskan ke storage log |

Rujukan API: [R2 Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [Cloudflare OpenAPI](https://github.com/cloudflare/api-schemas), [presigned URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). OpenAPI yang diakses melalui Cloudflare MCP menegaskan slash literal dan `result_info`; schema management PUT tidak menjanjikan conditional write.

## Tool baru

`cancel_file_upload`, `get_connection_status`, `search_repositories`, `get_commit_status`, `get_workflow_jobs`, `get_workflow_job_logs`, `create_pull_request_review`, `get_repository_security`, `list_releases`, `create_release`, `list_deployments`, `get_deployment_statuses`.

Semua 91 nama tool lama dipertahankan. Jumlah saat upgrade: 103. Review PR memerlukan SHA head dan konfirmasi target; release memerlukan SHA commit dan konfirmasi `owner/repo:tag`, termasuk draft. Endpoint Actions log tidak meneruskan Authorization ke storage HTTPS yang diizinkan. Security metadata yang tidak tersedia ditampilkan sebagai unavailable/null, bukan aman. Pagination baru memakai `next_page`; array penuh tidak diambil otomatis.

Dashboard mempertahankan visual, tema, navigasi mobile, Actions, audit, label, trash, shares, dan usage. Tambahan: drop zone yang dapat diakses keyboard, progress native, status verifikasi, cancel server, dan tombol health read-only saat diminta. Tidak ada interval polling tambahan. Filter file/proyek dan cursor lama tetap berlaku.

## Model otorisasi dan batas

- `GITHUB_ALLOWED_USERS` sekarang wajib untuk seluruh tool, termasuk sesi lama. Konfigurasi production yang diaudit sudah berisi owner. Empty allowlist menolak akses.
- `CLOUDFLARE_ALLOWED_USERS` opsional membatasi tool admin Cloudflare; jika tidak diisi, mengikuti allowlist lama. Ini instance pribadi, bukan tenant isolation untuk pengguna Cloudflare yang saling tidak dipercaya. Admin yang memperoleh izin D1/KV/delete bucket tetap memiliki authority luas sesuai token. Jangan memberi admin kepada akun tamu.
- Dashboard health menguji read GitHub, D1, R2 dan validitas token Cloudflare; tidak membuktikan seluruh izin API atau kesehatan setiap tool. Gunakan token user-scoped untuk probe token; token account-scoped dapat membutuhkan tool `cloudflare_token_verify(token_type="account")`.
- Audit best effort dipertahankan. Ini bukan pencatatan transaksi yang tidak dapat hilang. Kegagalan audit tidak membatalkan operasi yang sudah selesai.
- Transfer mem-buffer maksimal 25 MiB dalam satu buffer agar bisa menghitung checksum sebelum atomic put; dashboard menjalankan file berurutan. Download tetap stream. Tidak ada kenaikan batas, multipart/resume, atau klaim uji beban multi-user. Banyak upload paralel memerlukan desain streaming/limit concurrency terpisah.
- Allowlist URL berisi hostname publik yang dipercaya administrator; bukan layanan proxy URL bebas. Jangan memasukkan domain yang DNS/subdomainnya dikelola pihak tidak dipercaya atau menunjuk private origin. IP literal, local name, custom port, credential dan redirect ditolak. Tidak ada klaim DNS pinning atau uji jaringan private live.
- Worker binding tidak menyediakan signer S3. Konfigurasi ini tidak memiliki S3 access key/secret; presigned PUT tidak diimplementasikan. Alternatif yang bekerja adalah tiket POST terautentikasi, cancellable, maksimal 10 menit. Share download adalah random bearer capability berhash dan dapat dicabut, bukan AWS SigV4.
- Error setelah R2 put/HEAD atau finalisasi D1 dapat meninggalkan hasil yang belum pasti. Periksa status dan file list sebelum tiket baru; jangan replay write otomatis. Cancel tidak menghapus file yang sudah berstatus completed; gunakan trash dengan target eksplisit.
- Built-in BYGA masih membaca ref instalasi seperti sebelumnya. Import baru dipin SHA; import lama tidak diubah otomatis. Install ulang import lama bila ingin pinning. Skill tetap lower-trust text; registry tidak mengeksekusi script.
- Origin MCP browser tambahan harus diizinkan secara exact; client server-to-server tanpa Origin tetap berjalan. `installation.publicOrigin` adalah Host resmi. Preview/domain baru harus mengatur origin instalasi yang sesuai. CIMD tidak diaktifkan; DCR tetap digunakan.

## Bukti dan keterbatasan verifikasi

Lihat [hasil verifikasi](VALIDATION-2026-10.md) untuk status perintah. Integration test menjalankan bundle Wrangler asli pada workerd/Miniflare dengan binding KV, D1, R2, dan Durable Object lokal. GitHub OAuth upstream dimock dan semua network lain ditolak oleh outbound test handler. DCR, consent, PKCE, refresh, initialize, tool discovery dan schema rejection menjalankan provider/SDK asli.

Pengujian tidak membuktikan login GitHub production, permission Cloudflare live, rate limit akun nyata, CI GitHub setelah PR, browser Android, atau koneksi UI ChatGPT/Claude/Codex/Inspector. Tidak ada klaim sertifikasi kompatibilitas client. Tidak ada visual/device test otomatis dalam lingkungan ini. GitHub operations dan kegagalan permission diuji dengan mock; integration MCP storage memakai binding lokal nyata.

## Inventaris 91 tool sebelum upgrade

### GitHub, Cloudflare, memory, web dan skills (82)

`set_note`, `get_note`, `list_notes`, `search_notes`, `delete_note`, `set_default_repo`, `get_default_repo`, `whoami`, `list_repositories`, `get_file_contents`, `list_commits`, `list_issues`, `list_pull_requests`, `get_pull_request`, `search_code`, `repo_summary`, `get_audit_log`, `list_branches`, `delete_branch`, `create_repository`, `create_branch`, `push_files`, `create_pull_request`, `create_issue`, `delete_file`, `merge_pull_request`, `rename_file`, `scaffold_repository`, `trigger_workflow`, `get_workflow_runs`, `wait_for_workflow`, `deploy_and_push`, `get_worker_deployment_status`, `list_r2_objects`, `get_r2_object`, `put_r2_object`, `delete_r2_object`, `smoke_test`, `get_pr_preview_url`, `rerun_workflow`, `fetch_url`, `web_search`, `kv_namespace_create`, `kv_namespace_list`, `kv_namespace_delete`, `kv_put`, `kv_get`, `kv_delete`, `kv_list_keys`, `d1_database_create`, `d1_database_list`, `d1_database_delete`, `d1_query`, `d1_export`, `worker_list`, `cloudflare_token_verify`, `worker_rollback`, `worker_delete`, `worker_secret_put`, `worker_secret_list`, `worker_secret_delete`, `worker_subdomain_get`, `r2_bucket_create`, `r2_bucket_list`, `r2_bucket_delete`, `pages_project_list`, `pages_project_get`, `pages_deployment_list`, `pages_deployment_trigger`, `zone_list`, `dns_record_list`, `dns_record_create`, `dns_record_update`, `dns_record_delete`, `worker_analytics`, `pages_analytics`, `list_skills`, `get_skill_instructions`, `read_skill_file`, `install_skill_from_github`, `set_skill_enabled`, `uninstall_skill`.

### File manager (9)

`upload_file`, `create_file_upload`, `list_files`, `get_file_download`, `manage_file`, `create_file_share`, `list_file_shares`, `revoke_file_share`, `get_file_storage`.

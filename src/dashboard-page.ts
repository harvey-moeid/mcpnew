import installation from '../installation.json' with { type: 'json' }

export const dashboardHtml = String.raw`<!doctype html>
<html lang="id" data-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>GitHub Ops — Control Room</title><meta name="description" content="Dashboard pribadi untuk repositori, pull request, deployment, dan aktivitas GitHub Ops."><link rel="icon" href="data:,"><link rel="stylesheet" href="/dashboard/style.css"><script src="/dashboard/app.js" defer></script></head>
<body>
<div id="app" class="shell">
<aside class="sidebar" id="sidebar"><a href="/dashboard" class="brand" aria-label="GitHub Ops"><span class="brand-mark">G<span>↗</span></span><span>GitHub <strong>Ops</strong><small>PERSONAL CONTROL ROOM</small></span></a><div class="workspace-label">WORKSPACE <span class="live-dot"></span></div>
<nav aria-label="Navigasi utama"><button data-view="overview" class="nav-item active"><span class="nav-icon">◫</span>Ringkasan</button><button data-view="repositories" class="nav-item"><span class="nav-icon">▤</span>Repositori<span id="repo-badge" class="nav-count">—</span></button><button data-view="pulls" class="nav-item"><span class="nav-icon">⑂</span>Pull requests<span id="pr-badge" class="nav-count">—</span></button><button data-view="deployments" class="nav-item"><span class="nav-icon">↗</span>Deployment</button><button data-view="files" class="nav-item"><span class="nav-icon">▤</span>File R2</button><button data-view="activity" class="nav-item"><span class="nav-icon">≋</span>Aktivitas</button><div class="nav-divider"></div><button data-view="settings" class="nav-item"><span class="nav-icon">⚙</span>Koneksi & akses</button></nav>
<div class="sidebar-bottom"><div class="endpoint-card"><span class="eyebrow">MCP ENDPOINT</span><span class="endpoint-host">${new URL(installation.publicOrigin).host}</span><button id="copy-sidebar" class="text-button">Salin endpoint <span>↗</span></button></div><div class="profile"><div id="profile-avatar" class="avatar">G</div><div><strong id="profile-name">Workspace pribadi</strong><small id="profile-sub">Masuk untuk melanjutkan</small></div><button id="logout" class="icon-button hidden" aria-label="Keluar dari dashboard">↪</button></div></div></aside>
<div class="main-wrap"><header class="topbar"><button id="menu-toggle" class="icon-button mobile-only" aria-label="Buka navigasi" aria-expanded="false">☰</button><div class="breadcrumb">Workspace <span>/</span> <strong id="breadcrumb-current">Ringkasan</strong></div><div class="top-actions"><span class="top-chip"><i class="live-dot"></i>GitHub Ops</span><button id="theme-toggle" class="icon-button" aria-label="Ganti tema">◐</button><a href="https://github.com/${installation.githubOwner}/${installation.githubRepo}" target="_blank" rel="noopener noreferrer" class="icon-button" aria-label="Buka source repo">↗</a></div></header>
<main id="main"><section id="login-view" class="login-view"><div class="login-intro"><span class="eyebrow accent">YOUR WORKSPACE, IN FOCUS</span><h1>Satu tempat.<br>Semua <span>terpantau.</span></h1><p>Pantau repositori, pemeriksaan PR, deployment, dan aktivitas MCP dari satu dashboard pribadi.</p><a href="/dashboard/login" class="button primary">Masuk dengan GitHub <span>↗</span></a><div class="login-note"><span class="live-dot"></span>Hanya akun yang diizinkan · Data tetap privat</div><div class="login-features"><span>⑂ Pemeriksaan PR</span><span>↗ Cloudflare Workers</span><span>≋ Audit aktivitas</span></div></div><div class="login-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-grid"></div><div class="art-center">G<span>↗</span></div><div class="art-label label-one">REPOSITORIES <span>▤</span></div><div class="art-label label-two"><i class="live-dot"></i> YOUR CONTROL ROOM</div><div class="art-label label-three">DEPLOYMENTS <span>↗</span></div></div><div class="login-footer"><span>GITHUB OPS / CONTROL ROOM</span><a href="${installation.publicOrigin}/mcp">Endpoint MCP ↗</a></div></section>
<div id="authenticated" class="hidden"><div class="page-heading"><div><div class="eyebrow" id="page-eyebrow">WORKSPACE OVERVIEW</div><h1 id="page-title">Ringkasan workspace<span class="accent">.</span></h1><p id="page-description">Lihat yang perlu perhatian, lalu lanjutkan pekerjaanmu.</p></div><div class="heading-actions"><span id="last-updated" class="muted small"></span><button id="refresh" class="button secondary"><span>↻</span> Perbarui</button></div></div><div id="notice" class="notice hidden" role="status"></div>
<div class="context-bar"><label for="repo-select">REPO AKTIF</label><select id="repo-select" aria-label="Pilih repositori"><option>Memuat repositori…</option></select><a id="repo-link" href="https://github.com" target="_blank" rel="noopener noreferrer" class="text-button">Buka di GitHub ↗</a><span id="repo-scope" class="small muted">Data PR dan Actions mengikuti repo ini.</span></div>
<section id="view-overview" class="view"><div id="stats" class="stats-grid"></div><div class="overview-grid"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">REQUIRES ATTENTION</span><h2>Pull request & pemeriksaan</h2></div><button class="text-button" data-go="pulls">Lihat semua ↗</button></div><div id="overview-pulls" class="panel-body"></div></article><article class="panel deployment-preview"><div class="panel-heading"><div><span class="eyebrow">CLOUDFLARE WORKERS</span><h2>Deployment terkini</h2></div><span class="pill neutral">PRODUCTION</span></div><div id="overview-deployment" class="panel-body"></div></article></div><div class="overview-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">RECENT AUTOMATION</span><h2>GitHub Actions</h2></div><span class="small muted">12 run terbaru</span></div><div id="overview-runs"></div></article><article class="panel"><div class="panel-heading"><div><span class="eyebrow">AUDIT TRAIL</span><h2>Aktivitas terbaru</h2></div><button class="text-button" data-go="activity">Lihat log ↗</button></div><div id="overview-activity" class="panel-body"></div></article></div></section>
<section id="view-repositories" class="view hidden"><div class="section-toolbar"><div class="search-field"><span>⌕</span><input id="repo-search" type="search" placeholder="Cari repo, deskripsi, atau bahasa…" aria-label="Cari repositori"><kbd>/</kbd></div><select id="repo-filter" aria-label="Filter repositori"><option value="all">Semua repositori</option><option value="private">Privat</option><option value="public">Publik</option><option value="archived">Diarsipkan</option></select></div><div id="repositories-grid" class="repository-grid"></div><div class="load-more-wrap"><button id="load-repos" class="button secondary hidden">Muat repo lainnya</button></div></section>
<section id="view-pulls" class="view hidden"><div class="section-toolbar"><h2>PR terbuka <span class="small muted">· hingga 30 PR terbaru</span></h2><select id="pr-filter" aria-label="Filter pull request"><option value="all">Semua status</option><option value="failure">Pemeriksaan gagal</option><option value="pending">Berjalan</option><option value="success">Lolos</option><option value="draft">Draft</option></select></div><div class="panel" id="pulls-list"></div></section>
<section id="view-deployments" class="view hidden"><div class="deployment-header"><div><span class="eyebrow accent">LIVE ENVIRONMENT</span><h2>${installation.workerName}</h2><p class="muted">Riwayat versi dan persentase rollout dari Cloudflare.</p></div><a href="${installation.publicOrigin}/" target="_blank" rel="noopener noreferrer" class="button secondary">Buka layanan ↗</a></div><div id="deployments-list" class="panel"></div></section>
<section id="view-activity" class="view hidden"><div class="section-toolbar"><div><h2>Audit aktivitas</h2><p class="small muted">Aksi MCP milik akunmu. Log bersifat best-effort.</p></div><label class="checkbox"><input id="audit-errors" type="checkbox"> Hanya error</label></div><div class="panel table-scroll"><table><thead><tr><th>Aktivitas</th><th>Ringkasan</th><th>Status</th><th>Waktu</th></tr></thead><tbody id="audit-table"></tbody></table></div><div class="load-more-wrap"><button id="load-audit" class="button secondary hidden">Muat aktivitas sebelumnya</button></div></section>
<section id="view-files" class="view hidden"><article class="panel" style="padding:24px"><h2>File R2</h2><p class="muted">Privat secara default. File di tempat sampah bisa dipulihkan selama 7 hari.</p><div id="file-usage" role="status" style="margin:16px 0">Menghitung penyimpanan…</div><button id="continue-usage" class="button secondary hidden">Lanjutkan perhitungan</button><form id="upload-form" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:20px 0"><label for="file-input">Pilih file (maks. 25 MiB)</label><input id="file-input" type="file" multiple required><button id="upload-files" class="button" type="submit" disabled>Upload file</button></form><div style="display:flex;gap:12px;flex-wrap:wrap;margin:20px 0"><label for="file-mode">Tampilkan</label><select id="file-mode"><option value="active">File aktif</option><option value="trash">Tempat sampah</option></select><label for="file-project-filter">Label proyek</label><input id="file-project-filter" maxlength="80" placeholder="Semua proyek"><button id="filter-files" class="button secondary">Terapkan filter</button></div><p id="file-status" role="status" aria-live="polite"></p><div class="table-scroll"><table><thead><tr><th>Nama file</th><th>Proyek</th><th>Ukuran</th><th>Waktu</th><th>Aksi</th></tr></thead><tbody id="files-table"></tbody></table></div><button id="load-files" class="button secondary hidden" style="margin-top:16px">Muat file berikutnya</button></article>
<dialog id="file-dialog" style="max-width:600px;width:90%;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:24px"><button id="close-file-dialog" class="button secondary" style="float:right">Tutup</button><h2 id="file-dialog-title">Kelola file</h2><div id="file-dialog-body"></div><p id="file-dialog-status" role="status" aria-live="polite"></p></dialog></section>
<section id="view-settings" class="view hidden"><div id="settings-grid" class="settings-grid"></div></section>
<footer class="app-footer"><span>GITHUB OPS <span class="muted">/ CONTROL ROOM</span></span><span>Data langsung dari GitHub & Cloudflare <i class="live-dot"></i></span></footer></div>
</main></div></div><div id="toast" class="toast hidden" role="status"></div>
</body></html>
`

export const dashboardStyles = String.raw`:root{--bg:#0e1116;--sidebar:#10141a;--panel:#151a22;--panel-hover:#1b222d;--text:#ecf0f5;--muted:#929daa;--line:#272f3b;--accent:#93efb5;--accent-dim:#1d362b;--red:#ff9298;--yellow:#efc77c;--blue:#9abfff;--shadow:0 18px 60px #0002;color-scheme:dark}html[data-theme=light]{--bg:#f3f5f6;--sidebar:#fff;--panel:#fff;--panel-hover:#f4f7f6;--text:#18232b;--muted:#62717e;--line:#dce4e6;--accent:#16794c;--accent-dim:#e0f3e9;--red:#b53043;--yellow:#986920;--blue:#315faf;color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:var(--text);background:var(--bg)}button,input,select{font:inherit}button,a,select,input{-webkit-tap-highlight-color:transparent}button,a{touch-action:manipulation}button{cursor:pointer}a{color:inherit;text-decoration:none}button{color:inherit}button:disabled{cursor:wait;opacity:.6}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:4px}h1,h2,h3,p{margin:0}h2{font-size:17px;letter-spacing:-.4px}h3{font-size:16px}p{line-height:1.65}.shell{min-height:100vh;display:flex}.sidebar{width:246px;background:var(--sidebar);border-right:1px solid var(--line);position:fixed;inset:0 auto 0 0;display:flex;flex-direction:column;z-index:20;padding:32px 20px 0}.brand{display:flex;align-items:center;gap:12px;font-size:21px;letter-spacing:-1px;padding:0 7px}.brand strong{font-weight:500;color:var(--accent)}.brand small{display:block;margin-top:7px;font-size:8px;letter-spacing:1.9px;color:var(--muted)}.brand-mark{width:41px;height:41px;display:grid;place-items:center;background:var(--accent);color:#0e2117;border-radius:12px;font-size:26px;font-weight:800;position:relative}.brand-mark span{position:absolute;right:5px;top:1px;font-size:16px}.workspace-label{font-size:10px;font-weight:600;color:var(--muted);letter-spacing:1.8px;margin:44px 13px 15px;display:flex;align-items:center;justify-content:space-between}.live-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block;flex-shrink:0}.nav-item{width:100%;display:flex;align-items:center;gap:12px;border:0;border-radius:7px;background:transparent;padding:13px;color:var(--muted);text-align:left;margin-bottom:5px;font-size:13px;transition:background .15s,color .15s}.nav-item:hover{background:var(--panel);color:var(--text)}.nav-item.active{color:var(--accent);background:var(--accent-dim)}.nav-icon{font-size:19px;line-height:1;width:21px;text-align:center}.nav-count{margin-left:auto;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:2px 5px;font-size:10px;color:var(--muted)}.nav-divider{height:1px;background:var(--line);margin:22px 10px}.sidebar-bottom{margin-top:auto}.endpoint-card{border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:22px;background:var(--bg)}.endpoint-host{display:block;font-size:11px;margin-top:10px;margin-bottom:15px;color:var(--muted)}.endpoint-card .text-button{width:100%;justify-content:space-between}.eyebrow{font-size:9px;font-weight:650;letter-spacing:1.7px;color:var(--muted)}.accent{color:var(--accent)}.profile{display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);padding:20px 0}.profile strong{font-size:11px}.profile small{display:block;color:var(--muted);font-size:10px;margin-top:5px}.avatar{width:33px;height:33px;flex-shrink:0;border-radius:9px;background:var(--panel-hover);display:grid;place-items:center;color:var(--accent);font-weight:600;overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}.profile .icon-button{margin-left:auto;font-size:19px}.main-wrap{margin-left:246px;width:calc(100% - 246px)}.topbar{height:76px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 40px}.breadcrumb{font-size:11px;color:var(--muted)}.breadcrumb span{margin:0 13px;color:var(--line)}.breadcrumb strong{font-weight:500;color:var(--text)}.top-actions{display:flex;align-items:center;gap:15px}.top-chip{font-size:10px;border:1px solid var(--line);border-radius:20px;padding:6px 10px;display:flex;gap:7px;align-items:center;color:var(--muted)}.icon-button{background:transparent;border:0;width:29px;height:29px;display:inline-grid;place-items:center;color:var(--muted);font-size:18px}.icon-button:hover{color:var(--accent)}main{padding:40px;max-width:1580px;margin:auto}.page-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.page-heading .eyebrow{margin-bottom:12px}.page-heading h1{font-size:30px;line-height:1.2;letter-spacing:-1.3px;font-weight:550}.page-heading p{font-size:12px;color:var(--muted);margin-top:11px}.heading-actions{display:flex;align-items:center;gap:15px}.muted{color:var(--muted)}.small{font-size:11px}.button{display:inline-flex;align-items:center;justify-content:center;gap:14px;border-radius:6px;padding:10px 15px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid var(--line);transition:transform .15s,background .15s}.button:hover{transform:translateY(-1px)}.primary{background:var(--accent);color:#0f2519;border-color:var(--accent)}html[data-theme=light] .primary{color:white}.secondary{background:var(--panel);color:var(--text)}.text-button{border:0;background:none;display:inline-flex;align-items:center;gap:6px;color:var(--accent);padding:0;font-size:11px}.text-button:hover{text-decoration:underline}.context-bar{border:1px solid var(--line);border-radius:8px;display:flex;gap:18px;align-items:center;padding:14px 18px;margin-bottom:25px;background:var(--panel)}.context-bar label{font-size:9px;letter-spacing:1.5px;color:var(--muted)}select{border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);padding:8px 28px 8px 10px;font-size:12px;max-width:100%}.context-bar #repo-select{min-width:220px}.context-bar .small{margin-left:auto}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}.stat{border:1px solid var(--line);border-radius:9px;padding:21px;background:var(--panel);position:relative;overflow:hidden}.stat-top{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted)}.stat-icon{border:1px solid var(--line);border-radius:6px;width:27px;height:27px;display:grid;place-items:center;font-size:17px}.stat-value{font-size:34px;font-weight:500;letter-spacing:-1px;margin:20px 0 12px;line-height:1}.stat-bottom{font-size:10px;color:var(--muted);display:flex;align-items:center;gap:7px}.stat .stat-watermark{position:absolute;bottom:23px;right:20px;font-size:60px;opacity:.04}.stat.attention{border-color:#654039}.stat.attention .stat-value{color:var(--red)}.overview-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:24px;margin-bottom:24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:9px;overflow:hidden}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 23px;border-bottom:1px solid var(--line)}.panel-heading h2{margin-top:9px}.panel-body{padding:8px 23px}.pill{display:inline-flex;align-items:center;gap:5px;font-size:9px;line-height:1.3;border-radius:4px;padding:4px 7px;white-space:nowrap;font-weight:600;letter-spacing:.3px}.pill.success{color:var(--accent);background:var(--accent-dim)}.pill.failure{color:var(--red);background:#fa63781a}.pill.pending{color:var(--yellow);background:#c9a04c18}.pill.neutral,.pill.cancelled,.pill.none,.pill.unknown{color:var(--muted);background:var(--panel-hover);border:1px solid var(--line)}.pr-row,.activity-row{padding:18px 0;border-bottom:1px solid var(--line);display:flex;gap:13px;align-items:flex-start}.pr-row:last-child,.activity-row:last-child{border-bottom:0}.row-icon{font-size:20px;color:var(--accent);width:24px;flex-shrink:0}.row-icon.failure{color:var(--red)}.row-icon.pending{color:var(--yellow)}.row-main{min-width:0;flex:1}.row-title{font-size:12px;font-weight:500;line-height:1.55;display:block;overflow-wrap:anywhere}.row-title:hover{color:var(--accent)}.row-meta{font-size:10px;color:var(--muted);margin-top:6px;line-height:1.6;overflow-wrap:anywhere}.row-meta span{margin-right:9px}.row-end{flex-shrink:0}.empty{padding:37px 20px;text-align:center}.empty-icon{font-size:28px;color:var(--muted);margin-bottom:13px}.empty h3{font-size:13px;font-weight:500}.empty p{margin:8px auto 0;max-width:320px;font-size:11px;color:var(--muted)}.empty .button{margin-top:18px}.deploy-body{padding:24px 0}.deploy-mark{height:38px;width:38px;border:1px solid var(--line);border-radius:9px;color:var(--accent);display:grid;place-items:center;font-size:24px;margin-bottom:19px}.deploy-title{font-size:16px;letter-spacing:-.5px;margin-bottom:8px}.deploy-id{font:10px ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere;color:var(--muted)}.deploy-details{margin-top:24px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:11px}.rollout{margin-top:17px}.rollout-track{height:5px;border-radius:5px;background:var(--line);overflow:hidden;display:flex}.rollout-track span{display:block;height:100%;background:var(--accent)}.rollout-label{display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--muted)}.run-row{display:flex;align-items:center;gap:12px;padding:16px 23px;border-bottom:1px solid var(--line);font-size:11px}.run-row:last-child{border-bottom:0}.run-row:hover{background:var(--panel-hover)}.run-marker{height:7px;width:7px;border-radius:50%;background:var(--muted)}.run-marker.success{background:var(--accent)}.run-marker.failure{background:var(--red)}.run-marker.pending{background:var(--yellow)}.run-title{flex:1;min-width:0}.run-title small{font-size:9px;color:var(--muted);display:block;margin-top:5px}.run-time{font-size:9px;color:var(--muted)}.section-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:5px 0 20px}.search-field{display:flex;align-items:center;gap:10px;max-width:450px;width:100%;border:1px solid var(--line);border-radius:7px;background:var(--panel);padding:0 13px;color:var(--muted)}.search-field input{width:100%;border:0;padding:12px 0;background:transparent;color:var(--text);font-size:12px;outline:none}.search-field span{font-size:24px}.search-field kbd{font-size:10px;border:1px solid var(--line);padding:2px 5px;border-radius:3px}.repository-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.repo-card{padding:22px;border:1px solid var(--line);border-radius:9px;background:var(--panel);display:flex;flex-direction:column;min-height:220px}.repo-card:hover{border-color:var(--muted)}.repo-card-top{display:flex;align-items:center;gap:10px;margin-bottom:20px}.repo-card-top .pill{margin-left:auto}.repo-card h3{overflow-wrap:anywhere;line-height:1.5}.repo-owner{font-size:10px;color:var(--muted);margin:5px 0 14px}.repo-description{font-size:11px;color:var(--muted);flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}.repo-card-footer{border-top:1px solid var(--line);padding-top:16px;margin-top:19px;display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}.language-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--blue);margin-right:6px}.repo-card .text-button{margin-top:17px}.full-pr{padding:21px 24px;border-bottom:1px solid var(--line)}.full-pr:last-child{border-bottom:0}.check-tags{display:flex;gap:6px;flex-wrap:wrap;margin:13px 0 0 37px}.check-tags .pill{font-size:9px;font-weight:400}.deployment-header{padding:9px 0 28px;display:flex;align-items:center;justify-content:space-between;gap:15px}.deployment-header h2{font-size:26px;margin-top:10px}.deployment-header p{font-size:12px;margin-top:6px}.deployment-row{padding:22px 24px;display:flex;gap:19px;border-bottom:1px solid var(--line)}.deployment-row:last-child{border-bottom:0}.deployment-row .deploy-mark{flex-shrink:0;margin:0}.deployment-row .deploy-body{padding:0;flex:1;min-width:0}.deployment-row .deploy-details{margin-top:14px;padding-top:12px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);font-weight:500;padding:17px 22px;border-bottom:1px solid var(--line);background:var(--bg)}td{padding:19px 22px;font-size:11px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.6}td.summary{max-width:450px;overflow-wrap:anywhere;color:var(--muted)}td.nowrap{white-space:nowrap}tr:last-child td{border-bottom:0}.checkbox{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:8px}.checkbox input{accent-color:var(--accent)}.load-more-wrap{display:flex;justify-content:center;margin:24px}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.setting-card{padding:24px}.setting-card .setting-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.setting-card p{font-size:12px;color:var(--muted)}.setting-row{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line);font-size:11px}.setting-row:last-child{border-bottom:0}.setting-row .value{overflow-wrap:anywhere;text-align:right}.endpoint-box{padding:14px;background:var(--bg);border:1px solid var(--line);border-radius:6px;font-size:11px;font-family:ui-monospace,monospace;margin:17px 0;overflow-wrap:anywhere}.notice{padding:13px 16px;border:1px solid #705e36;background:#bb902514;color:var(--yellow);border-radius:7px;font-size:12px;line-height:1.6;margin-bottom:20px}.app-footer{border-top:1px solid var(--line);padding-top:24px;margin-top:36px;display:flex;justify-content:space-between;font-size:9px;letter-spacing:1px;color:var(--muted)}.app-footer .live-dot{margin-left:8px}.login-view{position:relative;min-height:calc(100vh - 156px);display:grid;grid-template-columns:1.1fr 1fr;align-items:center;gap:30px;padding:40px 16px 100px}.login-intro h1{font-size:clamp(40px,4.7vw,70px);font-weight:520;line-height:1.1;letter-spacing:-3px;margin:25px 0}.login-intro h1 span{color:var(--accent)}.login-intro p{max-width:370px;font-size:14px;color:var(--muted);line-height:1.8;margin-bottom:30px}.login-intro .button{padding:14px 21px;font-size:13px}.login-note{font-size:10px;color:var(--muted);display:flex;gap:8px;align-items:center;margin-top:18px}.login-features{display:flex;gap:18px;flex-wrap:wrap;font-size:10px;color:var(--muted);margin-top:45px}.login-art{height:420px;position:relative;display:grid;place-items:center;isolation:isolate}.art-grid{position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:33px 33px;opacity:.2;mask-image:radial-gradient(ellipse,#000,transparent 72%);z-index:-1}.art-center{width:100px;height:100px;display:grid;place-items:center;background:var(--accent);color:#15261d;font-size:68px;letter-spacing:-7px;font-weight:700;border-radius:26px;box-shadow:0 0 100px #77d69d19;transform:rotate(-8deg);position:relative}.art-center span{position:absolute;font-size:32px;right:10px;top:7px}.orbit{border:1px solid var(--line);border-radius:50%;position:absolute;width:300px;height:300px;transform:rotate(-22deg)}.orbit-two{width:420px;height:230px;transform:rotate(40deg);border-style:dashed}.art-label{position:absolute;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:13px 16px;font-size:8px;letter-spacing:1.4px;box-shadow:var(--shadow);display:flex;align-items:center;gap:15px;color:var(--muted)}.art-label span{font-size:16px;color:var(--accent)}.label-one{top:63px;left:20px}.label-two{bottom:82px;left:0}.label-three{right:0;top:220px}.login-footer{position:absolute;bottom:8px;left:16px;right:16px;display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:25px;font-size:9px;letter-spacing:1.4px;color:var(--muted)}.toast{position:fixed;bottom:25px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:7px;font-size:12px;z-index:50;box-shadow:var(--shadow);max-width:90vw}.hidden{display:none!important}.mobile-only{display:none}.skeleton{height:18px;background:var(--panel-hover);border-radius:5px;animation:pulse 1.4s infinite}.skeleton.block{height:90px;margin:20px 0}.loading-text{padding:28px;color:var(--muted);font-size:12px;display:flex;align-items:center;gap:10px}.spinner{height:13px;width:13px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.4}}@media(min-width:1600px){main{padding:48px 50px}}@media(max-width:1200px){.sidebar{width:218px;padding:29px 15px 0}.main-wrap{margin-left:218px;width:calc(100% - 218px)}main{padding:30px}.topbar{padding:0 30px}.context-bar .small{display:none}.repository-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.heading-actions #last-updated{display:none}.stats-grid{gap:12px}.stat{padding:17px}.login-art{transform:scale(.8)}.login-view{gap:0;padding:20px 0 100px}.login-intro h1{font-size:52px}}@media(max-width:900px){.overview-grid{grid-template-columns:1fr}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.settings-grid{grid-template-columns:1fr}.login-view{grid-template-columns:1fr;align-content:center}.login-art{display:none}.login-intro h1{font-size:58px}.page-heading h1{font-size:25px}.context-bar{gap:12px;flex-wrap:wrap}.context-bar label{width:100%}.context-bar select{flex:1}}@media(max-width:700px){.sidebar{transform:translateX(-100%);transition:transform .2s;width:246px;box-shadow:var(--shadow)}.sidebar.open{transform:translateX(0)}.main-wrap{margin-left:0;width:100%}.mobile-only{display:inline-grid}.topbar{padding:0 20px;height:65px;gap:12px}.breadcrumb{margin-right:auto}.top-chip{display:none}main{padding:25px 20px}.page-heading{align-items:flex-start;gap:10px}.page-heading h1{font-size:24px}.page-heading p{font-size:11px;max-width:220px}.heading-actions .button{padding:8px;font-size:0;gap:0}.heading-actions .button span{font-size:18px}.context-bar{padding:13px}.context-bar #repo-select{min-width:0}.stat-value{font-size:30px}.stat-top{font-size:10px}.stat-bottom{font-size:9px}.stats-grid{gap:10px}.stat{padding:15px}.panel-heading{padding:18px}.panel-body{padding:4px 18px}.panel-heading h2{font-size:15px}.panel-heading .eyebrow{font-size:8px}.repository-grid{grid-template-columns:1fr}.section-toolbar{flex-wrap:wrap}.search-field{max-width:none}.repo-card{min-height:205px}.full-pr{padding:16px}.pr-row .pill{font-size:8px}.pr-row{gap:9px}.row-title{font-size:11px}.row-meta{font-size:9px}.run-row{padding:16px 18px}.deployment-header{align-items:flex-start;flex-direction:column}.app-footer{font-size:8px;letter-spacing:.5px;gap:15px;line-height:1.7}.login-view{min-height:calc(100vh - 115px);padding:35px 0 110px}.login-intro h1{font-size:56px}.login-intro p{font-size:13px}.login-features{gap:14px}.login-footer{left:0;right:0;gap:12px;font-size:8px;line-height:1.7}.deployment-row{padding:20px 16px;gap:12px}.top-actions{gap:8px}th,td{padding:15px}.login-note{font-size:9px}.repo-card-footer{gap:8px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}

.svg-icon{width:1em;height:1em;display:inline-block;vertical-align:-.15em;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.nav-icon .svg-icon,.icon-button .svg-icon,.row-icon .svg-icon,.stat-icon .svg-icon{width:100%;height:100%}.brand-mark .svg-icon{stroke-width:2.6}.topbar .icon-button .svg-icon{width:18px;height:18px}.stat-watermark .svg-icon{width:1em;height:1em}@media(max-width:700px){.sidebar{visibility:hidden;pointer-events:none}.sidebar.open{visibility:visible;pointer-events:auto}}
`

export const dashboardScript = String.raw`'use strict';
const installation = ${JSON.stringify(installation).replace(/</g, "\\u003c")};
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const state = { session: null, files: [], filesCursor: null, filesConfigured: false, filesBusy: false, filesLoading: false, fileGeneration: 0, usage: null, usageCursor: null, usageBusy: false, repositories: [], repo: '', details: null, deployments: null, audit: [], auditMore: false, repoMore: false, repoPage: 1, view: 'overview', generation: 0, errors: {} };
  const views = {
    overview: ['WORKSPACE OVERVIEW', 'Ringkasan workspace', 'Lihat yang perlu perhatian, lalu lanjutkan pekerjaanmu.', 'Ringkasan'],
    repositories: ['YOUR REPOSITORIES', 'Repositori', 'Semua repo yang bisa diakses akun GitHub-mu.', 'Repositori'],
    pulls: ['CODE REVIEW', 'Pull requests', 'Temukan PR yang siap direview atau membutuhkan perbaikan.', 'Pull requests'],
    deployments: ['DELIVERY & RELEASES', 'Deployment', 'Versi Worker dan rollout production dalam satu tampilan.', 'Deployment'],
    files: ['PRIVATE STORAGE', 'File R2', 'Upload, lihat daftar, dan download file milik akunmu.', 'File R2'],
    activity: ['WORKSPACE AUDIT', 'Aktivitas', 'Jejak aksi MCP milik akunmu, dari yang terbaru.', 'Aktivitas'],
    settings: ['ACCOUNT & CONNECTIONS', 'Koneksi & akses', 'Kelola sesi, endpoint MCP, dan lihat konfigurasi akses.', 'Koneksi & akses']
  };
  const labels = { success: 'Lolos', failure: 'Gagal', pending: 'Berjalan', cancelled: 'Dibatalkan', none: 'Tanpa pemeriksaan', unknown: 'Belum diketahui' };
  function e(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]; }); }
  function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname === 'avatars.githubusercontent.com' || url.origin === installation.publicOrigin) ? url.href : '#'; } catch (_) { return '#'; } }
  function shortDate(value) { if (!value) return 'Waktu belum tersedia'; const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'); return Number.isNaN(date.getTime()) ? 'Waktu belum tersedia' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date); }
  function timeAgo(value) { if (!value) return '—'; const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'); if (Number.isNaN(date.getTime())) return '—'; const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000)); if (minutes < 1) return 'Baru saja'; if (minutes < 60) return minutes + ' menit lalu'; if (minutes < 1440) return Math.floor(minutes / 60) + ' jam lalu'; return Math.floor(minutes / 1440) + ' hari lalu'; }
  function pill(status, label) { return '<span class="pill ' + e(status) + '">' + e(label || labels[status] || status) + '</span>'; }
  function empty(title, description, icon) { return '<div class="empty"><div class="empty-icon">' + e(icon || '◫') + '</div><h3>' + e(title) + '</h3><p>' + e(description) + '</p></div>'; }
  function loading() { return '<div class="loading-text"><span class="spinner"></span>Memuat data langsung…</div>'; }
  function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(function () { $('toast').classList.add('hidden'); }, 3500); }
  async function api(path, options) {
    const response = await fetch('/dashboard/api/' + path, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, options || {}));
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) { const error = new Error(data.error || 'Data belum dapat dimuat. Coba lagi.'); error.status = response.status; throw error; }
    return data;
  }
  function setView(view) {
    if (!views[view]) return;
    state.view = view;
    document.querySelectorAll('.view').forEach(function (node) { node.classList.toggle('hidden', node.id !== 'view-' + view); });
    document.querySelectorAll('[data-view]').forEach(function (node) { const active = node.dataset.view === view; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
    $('page-eyebrow').textContent = views[view][0]; $('page-title').innerHTML = e(views[view][1]) + '<span class="accent">.</span>';
    $('page-description').textContent = views[view][2]; $('breadcrumb-current').textContent = views[view][3];
    $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false');
    document.querySelector('.context-bar').classList.toggle('hidden', !['overview', 'pulls'].includes(view));
    history.replaceState(null, '', '/dashboard#' + view);
    if (view === 'files') { void loadFiles(false); void loadUsage(false); }
    if (view === 'repositories') renderRepos();
    if (view === 'pulls') renderPulls();
  }
  function setNotice() { const errors = Object.values(state.errors).filter(Boolean); $('notice').textContent = errors.join(' '); $('notice').classList.toggle('hidden', !errors.length); }
  function showLogin(message) {
    if ($('file-dialog').open) closeFileDialog();
    state.session = null; $('authenticated').classList.add('hidden'); $('login-view').classList.remove('hidden'); $('logout').classList.add('hidden');
    $('profile-name').textContent = 'Workspace pribadi'; $('profile-sub').textContent = 'Masuk untuk melanjutkan'; $('profile-avatar').textContent = 'G';
    if (message) document.querySelector('.login-intro p').textContent = message;
  }
  async function loadRepos(append) {
    const page = append ? state.repoPage + 1 : 1;
    const data = await api('repositories?page=' + page);
    state.repositories = append ? state.repositories.concat(data.repositories) : data.repositories;
    state.repoPage = page; state.repoMore = data.hasMore;
    if (!state.repo || !state.repositories.some(function (repo) { return repo.fullName === state.repo; })) {
      let previous; try { previous = localStorage.getItem('ops-repo'); } catch (_) {}
      const preferred = state.repositories.find(function (repo) { return repo.fullName === previous; }) || state.repositories.find(function (repo) { return repo.fullName === installation.githubOwner + '/' + installation.githubRepo; }) || state.repositories[0];
      state.repo = preferred ? preferred.fullName : '';
    }
    $('repo-select').innerHTML = state.repositories.length ? state.repositories.map(function (repo) { return '<option value="' + e(repo.fullName) + '">' + e(repo.fullName) + '</option>'; }).join('') : '<option value="">Tidak ada repo</option>';
    $('repo-select').value = state.repo; $('repo-select').disabled = !state.repositories.length;
    $('repo-link').href = state.repo ? 'https://github.com/' + state.repo : 'https://github.com';
    $('repo-badge').textContent = state.repositories.length + (state.repoMore ? '+' : '');
    $('load-repos').classList.toggle('hidden', !state.repoMore); renderRepos(); renderStats();
  }
  async function loadDetails() {
    const generation = ++state.generation; const repo = state.repo;
    if (!repo) { state.details = { pullRequests: [], runs: [] }; renderDetails(); return; }
    state.details = null; $('overview-pulls').innerHTML = loading(); $('overview-runs').innerHTML = loading(); $('pulls-list').innerHTML = loading(); renderStats();
    try { const data = await api('repository?repo=' + encodeURIComponent(repo)); if (generation !== state.generation) return; state.details = data; delete state.errors.repository; }
    catch (error) { if (generation !== state.generation) return; state.errors.repository = error.message; state.details = { pullRequests: [], runs: [], error: error.message }; if (error.status === 401) { showLogin(error.message); return; } }
    renderDetails(); setNotice();
  }
  async function loadDeployments() {
    try { state.deployments = await api('deployments'); delete state.errors.deployments; }
    catch (error) { state.deployments = { error: error.message }; state.errors.deployments = error.message; }
    renderDeployments(); renderStats(); setNotice();
  }
  function formatBytes(size) {
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KiB';
    return (size / (1024 * 1024)).toFixed(1) + ' MiB';
  }
  function renderFiles() {
    $('upload-files').disabled = !state.filesConfigured || state.filesBusy;
    $('file-input').disabled = !state.filesConfigured || state.filesBusy;
    $('load-files').classList.toggle('hidden', !state.filesCursor);
    const trash = $('file-mode').value === 'trash';
    $('files-table').innerHTML = state.files.length ? state.files.map(function (file) {
      const key = e(file.key);
      const actions = trash ? '<button class="button secondary" data-file-action="restore" data-key="' + key + '" ' + (Date.now() >= file.restoreUntil ? 'disabled' : '') + '>Pulihkan</button>' :
        '<a class="button secondary" href="/dashboard/api/files/download?key=' + e(encodeURIComponent(file.key)) + '" download>Download</a> <button class="button secondary" data-file-action="project" data-key="' + key + '">Label</button> <button class="button secondary" data-file-action="share" data-key="' + key + '">Bagikan</button> <button class="button secondary" data-file-action="trash" data-key="' + key + '">Hapus</button>';
      return '<tr><td class="summary">' + e(file.name) + '</td><td>' + e(file.project || '—') + '</td><td class="nowrap">' + e(formatBytes(file.size)) + '</td><td>' + e(shortDate(file.uploadedAt)) + (trash ? '<br><small>Pulihkan sebelum ' + e(shortDate(new Date(file.restoreUntil).toISOString())) + '</small>' : '') + '</td><td><div style="display:flex;gap:8px;flex-wrap:wrap">' + actions + '</div></td></tr>';
    }).join('') : '<tr><td colspan="5">' + empty(state.filesConfigured ? 'Tidak ada file pada halaman ini' : 'Penyimpanan belum dikonfigurasi', state.filesConfigured ? (state.filesCursor ? 'Muat halaman berikutnya atau ubah filter.' : 'Upload file baru atau ubah filter.') : 'Hubungkan bucket R2 untuk mulai menyimpan file.', '▤') + '</td></tr>';
  }
  async function loadFiles(append) {
    if (append && state.filesLoading) return;
    const generation = ++state.fileGeneration;
    state.filesLoading = true; $('load-files').disabled = true;
    const query = new URLSearchParams({ trash: String($('file-mode').value === 'trash'), project: $('file-project-filter').value.trim() });
    if (append && state.filesCursor) query.set('cursor', state.filesCursor);
    try {
      const data = await api('files?' + query);
      if (generation !== state.fileGeneration) return;
      state.files = append ? state.files.concat(data.files) : data.files;
      state.filesCursor = data.cursor; state.filesConfigured = data.configured;
      renderFiles();
    } catch (error) {
      if (generation !== state.fileGeneration) return;
      if (error.status === 401) { showLogin(error.message); return; }
      $('file-status').textContent = error.message;
    } finally { if (generation === state.fileGeneration) { state.filesLoading = false; $('load-files').disabled = false; } }
  }
  async function loadUsage(append) {
    if (state.usageBusy) return;
    state.usageBusy = true; $('continue-usage').disabled = true;
    if (!append) { state.usage = { activeCount: 0, activeBytes: 0, trashCount: 0, trashBytes: 0 }; state.usageCursor = null; }
    try {
      for (let page = 0; page < 10; page++) {
        const data = await api('files/usage' + (state.usageCursor ? '?cursor=' + encodeURIComponent(state.usageCursor) : ''));
        Object.keys(state.usage).forEach(function (key) { state.usage[key] += data[key]; });
        state.usageCursor = data.cursor;
        if (!data.cursor) break;
      }
      const total = state.usage;
      $('file-usage').textContent = 'File aktif: ' + total.activeCount + ' · ' + formatBytes(total.activeBytes) + ' | Tempat sampah: ' + total.trashCount + ' · ' + formatBytes(total.trashBytes) + ' | Total: ' + formatBytes(total.activeBytes + total.trashBytes) + (state.usageCursor ? ' (perhitungan sebagian)' : '');
      $('continue-usage').classList.toggle('hidden', !state.usageCursor);
    } catch (error) { $('file-usage').textContent = 'Penggunaan belum dapat dihitung: ' + error.message; }
    finally { state.usageBusy = false; $('continue-usage').disabled = false; }
  }
  async function fileMutation(action, body) {
    return api('files/manage/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  let dialogKey = null;
  function closeFileDialog() { $('file-dialog').close(); $('file-dialog-body').replaceChildren(); dialogKey = null; }
  $('close-file-dialog').addEventListener('click', closeFileDialog);
  $('file-dialog').addEventListener('cancel', closeFileDialog);
  async function showShares(key) {
    const data = await api('files/manage/shares?key=' + encodeURIComponent(key));
    if (dialogKey !== key) return;
    $('active-file-shares').innerHTML = data.shares.length ? data.shares.map(function (share) { return '<p>' + e(shortDate(new Date(share.expiresAt).toISOString())) + ' <button class="button secondary" data-revoke-share="' + e(share.id) + '">Cabut akses</button></p>'; }).join('') : '<p class="muted">Tidak ada link aktif.</p>';
  }
  $('files-table').addEventListener('click', async function (event) {
    const button = event.target.closest('[data-file-action]'); if (!button) return;
    const key = button.dataset.key, action = button.dataset.fileAction;
    const file = state.files.find(function (item) { return item.key === key; }); if (!file) return;
    try {
      if (action === 'trash' || action === 'restore') {
        if (action === 'trash' && !confirm('Pindahkan "' + file.name + '" ke tempat sampah? Semua link berbagi akan dicabut. File bisa dipulihkan selama 7 hari.')) return;
        button.disabled = true; await fileMutation(action, { key });
        $('file-status').textContent = action === 'trash' ? 'File dipindahkan ke tempat sampah.' : 'File dipulihkan. Link berbagi lama tetap nonaktif.';
        await Promise.all([loadFiles(false), loadUsage(false)]); return;
      }
      dialogKey = key; $('file-dialog-status').textContent = '';
      $('file-dialog-title').textContent = file.name;
      if (action === 'project') {
        $('file-dialog-body').innerHTML = '<form id="file-project-form"><label for="file-project">Label proyek (kosongkan untuk menghapus label)</label><input id="file-project" maxlength="80" value="' + e(file.project || '') + '"><button class="button" type="submit">Simpan label</button></form>';
      } else {
        $('file-dialog-body').innerHTML = '<p>Siapa pun yang memegang link sementara bisa mengunduh file ini tanpa login hingga link kedaluwarsa atau dicabut.</p><form id="file-share-form"><label for="file-share-hours">Masa berlaku</label><select id="file-share-hours"><option value="1">1 jam</option><option value="24">24 jam</option><option value="168">7 hari</option></select><button class="button" type="submit">Buat link berbagi</button></form><div id="new-file-share" role="status"></div><h3>Link aktif (maks. 100 terbaru)</h3><div id="active-file-shares"></div>';
      }
      $('file-dialog').showModal();
      if (action === 'share') await showShares(key);
    } catch (error) { $('file-status').textContent = error.message; $('file-dialog-status').textContent = error.message; }
    finally { if (button.isConnected) button.disabled = false; }
  });
  $('file-dialog').addEventListener('submit', async function (event) {
    event.preventDefault(); const key = dialogKey; if (!key) return;
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      if (event.target.id === 'file-project-form') {
        await fileMutation('project', { key, project: $('file-project').value });
        if (dialogKey === key) closeFileDialog(); await loadFiles(false);
      } else {
        const data = await fileMutation('share', { key, hours: Number($('file-share-hours').value) });
        if (dialogKey !== key) return;
        const input = document.createElement('input'); input.readOnly = true; input.value = data.url; input.style.width = '100%'; input.setAttribute('aria-label', 'Link berbagi sementara');
        const text = document.createElement('p'); text.textContent = 'Berlaku sampai ' + shortDate(new Date(data.expiresAt).toISOString()) + '. Salin link ini sekarang; link tidak disimpan di browser.';
        const copy = document.createElement('button'); copy.className = 'button secondary'; copy.type = 'button'; copy.textContent = 'Salin link'; copy.addEventListener('click', async function () { try { await navigator.clipboard.writeText(data.url); toast('Link berbagi disalin'); } catch (_) { input.select(); } });
        $('new-file-share').replaceChildren(text, input, copy); await showShares(key);
      }
    } catch (error) { if (dialogKey === key) $('file-dialog-status').textContent = error.message; }
    finally { if (button.isConnected) button.disabled = false; }
  });
  $('file-dialog').addEventListener('click', async function (event) {
    const button = event.target.closest('[data-revoke-share]'); if (!button || !dialogKey) return;
    const key = dialogKey; button.disabled = true;
    try { await fileMutation('revoke', { id: button.dataset.revokeShare }); if (dialogKey === key) { $('new-file-share').replaceChildren(); await showShares(key); $('file-dialog-status').textContent = 'Akses link dicabut.'; } }
    catch (error) { $('file-dialog-status').textContent = error.message; }
    finally { if (button.isConnected) button.disabled = false; }
  });
  $('file-mode').addEventListener('change', function () { void loadFiles(false); });
  $('filter-files').addEventListener('click', function () { void loadFiles(false); });
  $('file-project-filter').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); void loadFiles(false); } });
  $('continue-usage').addEventListener('click', function () { void loadUsage(true); });
  function uploadFile(file, index, total) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/dashboard/api/files?name=' + encodeURIComponent(file.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.timeout = 300000;
      xhr.upload.onprogress = function (event) {
        $('file-status').textContent = 'Mengunggah ' + index + '/' + total + ': ' + file.name + (event.lengthComputable ? ' · ' + Math.round(event.loaded / event.total * 100) + '%' : '');
      };
      xhr.onload = function () {
        let data = {}; try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else { const error = new Error(data.error || 'Upload gagal. Coba lagi.'); error.status = xhr.status; reject(error); }
      };
      xhr.onerror = function () { reject(new Error('Koneksi terputus. Periksa daftar file sebelum mencoba upload lagi.')); };
      xhr.ontimeout = function () { reject(new Error('Upload terlalu lama. Periksa daftar file sebelum mencoba lagi.')); };
      xhr.send(file);
    });
  }
  $('upload-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (state.filesBusy) return;
    const files = Array.from($('file-input').files);
    if (!files.length) return;
    const invalid = files.find(function (file) { return file.size > 25 * 1024 * 1024; });
    if (invalid) { $('file-status').textContent = invalid.name + ': ukuran maksimal 25 MiB per file.'; return; }
    state.filesBusy = true; renderFiles(); let completed = 0;
    try {
      for (const file of files) { await uploadFile(file, completed + 1, files.length); completed++; }
      $('file-status').textContent = completed + ' file berhasil disimpan di R2.'; $('file-input').value = '';
    } catch (error) {
      $('file-status').textContent = completed + ' file berhasil. ' + error.message;
      if (error.status === 401) showLogin(error.message);
    } finally { state.filesBusy = false; await Promise.all([loadFiles(false), loadUsage(false)]); renderFiles(); }
  });
  $('load-files').addEventListener('click', function () { void loadFiles(true); });
  async function loadAudit(append) {
    const errorsOnly = $('audit-errors').checked;
    const before = append && state.audit.length ? '&before=' + state.audit[state.audit.length - 1].id : '';
    try { const data = await api('audit?errors=' + errorsOnly + before); state.audit = append ? state.audit.concat(data.entries) : data.entries; state.auditMore = data.hasMore; delete state.errors.audit; }
    catch (error) { state.errors.audit = error.message; if (!append) state.audit = []; state.auditMore = false; }
    renderAudit(); setNotice();
  }
  function renderStats() {
    const details = state.details; const prs = details && !details.error ? details.pullRequests : null;
    const failures = prs ? prs.filter(function (pr) { return pr.status === 'failure'; }).length : null;
    const config = state.session && state.session.configuration;
    const deployments = state.deployments && state.deployments.deployments;
    const stats = [
      ['Repositori', String(state.repositories.length) + (state.repoMore ? '+' : ''), 'Dapat diakses akunmu', '▤', false],
      ['PR terbuka', prs ? String(prs.length) + (details.hasMorePullRequests ? '+' : '') : '—', 'Pada repo yang dipilih', '⑂', false],
      ['Pemeriksaan gagal', failures === null ? '—' : String(failures), failures ? 'Perlu ditinjau di GitHub' : prs ? 'Tidak ada kegagalan terdeteksi' : 'Menunggu data pemeriksaan', '!', Boolean(failures)],
      ['Deployment', deployments && deployments.length ? String(deployments.length) : '—', state.deployments && state.deployments.error ? 'Data belum tersedia' : config && config.cloudflare ? 'Versi dalam riwayat Cloudflare' : 'Koneksi belum tersedia', '↗', false]
    ];
    $('stats').innerHTML = stats.map(function (stat) { return '<article class="stat' + (stat[4] ? ' attention' : '') + '"><div class="stat-top">' + e(stat[0]) + '<span class="stat-icon">' + e(stat[3]) + '</span></div><div class="stat-value">' + e(stat[1]) + '</div><div class="stat-bottom">' + (stat[4] ? pill('failure', 'ATTENTION') : '') + e(stat[2]) + '</div><span class="stat-watermark" aria-hidden="true">' + e(stat[3]) + '</span></article>'; }).join('');
  }
  function prRow(pr, full) {
    return '<div class="' + (full ? 'full-pr' : '') + '"><div class="pr-row"><span class="row-icon ' + e(pr.status) + '">⑂</span><div class="row-main"><a class="row-title" href="' + e(safeUrl(pr.url)) + '" target="_blank" rel="noopener noreferrer">' + e(pr.title) + '</a><div class="row-meta"><span>#' + e(pr.number) + ' · ' + e(pr.author) + '</span><span>' + e(pr.branch) + ' → ' + e(pr.base) + '</span></div></div><div class="row-end">' + pill(pr.status) + (pr.draft ? '<div style="margin-top:6px">' + pill('neutral', 'Draft') + '</div>' : '') + '</div></div>' + (full && pr.checks.length ? '<div class="check-tags">' + pr.checks.map(function (check) { const status = check.status !== 'completed' ? 'pending' : ['failure', 'timed_out', 'action_required'].includes(check.conclusion) ? 'failure' : check.conclusion === 'cancelled' ? 'cancelled' : 'success'; return pill(status, check.name + ' · ' + (labels[status] || status)); }).join('') + '</div>' : '') + '</div>';
  }
  function renderDetails() {
    renderStats(); renderPulls();
    if (state.details.error) { $('overview-pulls').innerHTML = empty('PR belum dapat dimuat', state.details.error); $('overview-runs').innerHTML = empty('Actions belum dapat dimuat', state.details.error); return; }
    const prioritized = state.details.pullRequests.slice().sort(function (a, b) { return Number(b.status === 'failure') - Number(a.status === 'failure'); }).slice(0, 4);
    $('overview-pulls').innerHTML = prioritized.length ? prioritized.map(function (pr) { return prRow(pr, false); }).join('') : empty('Tidak ada PR terbuka', state.repo ? 'Repo ini sedang bersih dari antrean review.' : 'Pilih atau buat repositori di GitHub.', '✓');
    const runs = state.details.runs.slice(0, 6);
    $('overview-runs').innerHTML = runs.length ? runs.map(function (run) { const status = run.status !== 'completed' ? 'pending' : run.conclusion || 'none'; return '<a class="run-row" href="' + e(safeUrl(run.url)) + '" target="_blank" rel="noopener noreferrer"><span class="run-marker ' + e(status) + '"></span><div class="run-title">' + e(run.name) + '<small>' + e(run.branch) + ' · ' + e(run.sha) + ' · #' + e(run.number) + '</small></div>' + pill(status) + '<span class="run-time">' + e(timeAgo(run.createdAt)) + '</span></a>'; }).join('') : empty('Belum ada run Actions', state.details.runsError || 'Riwayat workflow akan tampil setelah dijalankan.', '↻');
    $('pr-badge').textContent = state.details.pullRequests.length + (state.details.hasMorePullRequests ? '+' : '');
    $('last-updated').textContent = 'Diperbarui ' + new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  }
  function renderPulls() {
    if (!state.details) { $('pulls-list').innerHTML = loading(); return; }
    if (state.details.error) { $('pulls-list').innerHTML = empty('Data belum tersedia', state.details.error); return; }
    const filter = $('pr-filter').value;
    const prs = state.details.pullRequests.filter(function (pr) { return filter === 'all' || (filter === 'draft' ? pr.draft : pr.status === filter); });
    $('pulls-list').innerHTML = prs.length ? prs.map(function (pr) { return prRow(pr, true); }).join('') : empty('Tidak ada PR pada filter ini', 'Ganti filter atau pilih repo lain untuk melihat pull request.', '✓');
  }
  function renderRepos() {
    const query = $('repo-search').value.toLowerCase().trim(); const filter = $('repo-filter').value;
    const repos = state.repositories.filter(function (repo) { return (!query || [repo.fullName, repo.description, repo.language].join(' ').toLowerCase().includes(query)) && (filter === 'all' || filter === 'private' && repo.private || filter === 'public' && !repo.private || filter === 'archived' && repo.archived); });
    $('repositories-grid').innerHTML = repos.length ? repos.map(function (repo) { return '<article class="repo-card"><div class="repo-card-top"><span class="row-icon">▤</span>' + pill('neutral', repo.private ? 'Privat' : 'Publik') + '</div><h3><a href="' + e(safeUrl(repo.url)) + '" target="_blank" rel="noopener noreferrer">' + e(repo.name) + '</a></h3><div class="repo-owner">' + e(repo.fullName.split('/')[0]) + (repo.archived ? ' · Diarsipkan' : '') + '</div><p class="repo-description">' + e(repo.description || 'Belum ada deskripsi untuk repositori ini.') + '</p><div class="repo-card-footer"><span><i class="language-dot"></i>' + e(repo.language || 'Tanpa bahasa') + '</span><span>' + e(timeAgo(repo.updatedAt)) + '</span></div><button class="text-button" data-select-repo="' + e(repo.fullName) + '">Lihat PR & Actions ↗</button></article>'; }).join('') : empty('Tidak ada repo yang cocok', 'Ganti pencarian atau filter repositori.', '▤');
  }
  function renderDeployments() {
    const data = state.deployments;
    if (!data) { $('overview-deployment').innerHTML = loading(); $('deployments-list').innerHTML = loading(); return; }
    if (data.error || !data.configured || !data.deployments.length) {
      const title = data.error ? 'Deployment belum dapat dimuat' : !data.configured ? 'Cloudflare belum terhubung' : 'Belum ada deployment';
      const description = data.error || (!data.configured ? 'Koneksi Cloudflare diperlukan untuk menampilkan riwayat Worker.' : 'Riwayat akan muncul setelah Worker dipublikasikan.');
      $('overview-deployment').innerHTML = empty(title, description, '↗'); $('deployments-list').innerHTML = empty(title, description, '↗'); return;
    }
    function body(deploy, latest) {
      const versions = deploy.versions || []; const total = versions.reduce(function (sum, version) { return sum + (Number(version.percentage) || 0); }, 0);
      return '<div class="deploy-body"><h3 class="deploy-title">' + (latest ? e(installation.workerName) : 'Deployment') + '</h3><div class="deploy-id">' + e(deploy.id) + '</div><div class="deploy-details"><span class="muted">Dipublikasikan</span><span>' + e(shortDate(deploy.createdAt)) + '</span></div>' + (versions.length ? '<div class="rollout"><div class="rollout-track">' + versions.map(function (version) { const percentage = Math.min(100, Math.max(0, Number(version.percentage) || 0)); return '<span style="width:' + percentage + '%"></span>'; }).join('') + '</div><div class="rollout-label"><span>' + e(deploy.strategy || 'Rollout') + '</span><span>' + e(total) + '% traffic</span></div></div><div class="row-meta">' + versions.map(function (version) { return '<span>' + e(version.id.slice(0, 8)) + ' · ' + e(version.percentage == null ? '—' : version.percentage + '%') + '</span>'; }).join('') + '</div>' : '<p class="row-meta">Detail versi belum tersedia.</p>') + '</div>';
    }
    $('overview-deployment').innerHTML = '<div class="deploy-mark" style="margin-top:20px">↗</div>' + body(data.deployments[0], true);
    $('deployments-list').innerHTML = data.deployments.map(function (deploy, index) { return '<article class="deployment-row"><div class="deploy-mark">↗</div>' + body(deploy, index === 0) + (index === 0 ? '<div>' + pill('success', 'Terbaru') + '</div>' : '') + '</article>'; }).join('');
  }
  function renderAudit() {
    $('load-audit').classList.toggle('hidden', !state.auditMore);
    $('audit-table').innerHTML = state.audit.length ? state.audit.map(function (entry) { return '<tr><td><strong>' + e(entry.tool) + '</strong><div class="muted small">#' + e(entry.id) + '</div></td><td class="summary">' + e(entry.summary) + '</td><td>' + pill(entry.is_error ? 'failure' : 'success', entry.is_error ? 'Error' : 'Berhasil') + '</td><td class="nowrap muted">' + e(shortDate(entry.created_at)) + '</td></tr>'; }).join('') : '<tr><td colspan="4">' + empty(state.errors.audit ? 'Audit belum dapat dimuat' : 'Belum ada aktivitas', state.errors.audit || 'Aksi MCP yang tercatat akan muncul di sini.', '≋') + '</td></tr>';
    $('overview-activity').innerHTML = state.audit.length ? state.audit.slice(0, 4).map(function (entry) { return '<div class="activity-row"><span class="row-icon ' + (entry.is_error ? 'failure' : '') + '">' + (entry.is_error ? '!' : '↗') + '</span><div class="row-main"><span class="row-title">' + e(entry.tool) + '</span><p class="row-meta">' + e(entry.summary) + '</p><span class="row-meta">' + e(timeAgo(entry.created_at)) + '</span></div></div>'; }).join('') : empty('Belum ada aktivitas', state.errors.audit || 'Riwayat aksi MCP akan tampil setelah digunakan.', '≋');
  }
  function renderSettings() {
    const config = state.session.configuration; const user = state.session.user;
    $('settings-grid').innerHTML = '<article class="panel setting-card"><div class="setting-top"><h2>Akun GitHub</h2>' + pill('success', 'Terhubung') + '</div><p>Sesi dashboard berlaku hingga ' + e(shortDate(new Date(state.session.expiresAt).toISOString())) + '. Akses data memakai izin akun ini.</p><div class="setting-row"><span class="muted">Username</span><strong>' + e(user.login) + '</strong></div><div class="setting-row"><span class="muted">Nama</span><span class="value">' + e(user.name) + '</span></div><div class="setting-row"><span class="muted">Akses dashboard</span><span>Akun dalam allowlist</span></div><button class="button secondary" data-logout style="margin-top:18px">Keluar dari dashboard ↪</button></article>' +
      '<article class="panel setting-card"><div class="setting-top"><h2>Endpoint MCP</h2>' + pill('neutral', 'REMOTE') + '</div><p>Gunakan URL ini saat menambahkan konektor MCP. Login dashboard dan sesi konektor dikelola terpisah.</p><div class="endpoint-box">' + e(config.endpoint) + '</div><button class="button secondary" data-copy>Salin endpoint ↗</button></article>' +
      '<article class="panel setting-card"><div class="setting-top"><h2>Cloudflare & audit</h2>' + pill(config.cloudflare ? 'success' : 'neutral', config.cloudflare ? 'Dikonfigurasi' : 'Belum dikonfigurasi') + '</div><div class="setting-row"><span class="muted">Worker</span><span>' + e(config.worker) + '</span></div><div class="setting-row"><span class="muted">Audit D1</span><span>' + (config.audit ? 'Binding tersedia' : 'Belum tersedia') + '</span></div><p style="margin-top:15px">Status konfigurasi tidak menjamin koneksi sehat. Riwayat deployment dan aktivitas menunjukkan hasil permintaan terbaru.</p></article>' +
      '<article class="panel setting-card"><div class="setting-top"><h2>Proteksi akses</h2>' + pill(config.directPushAllowed ? 'pending' : 'success', config.directPushAllowed ? 'Direct push aktif' : 'Branch dilindungi') + '</div><div class="setting-row"><span class="muted">Branch terdaftar</span><span class="value">' + e(config.protectedBranches) + '</span></div><div class="setting-row"><span class="muted">Aksi dari dashboard</span><span>Pantau & buka GitHub</span></div><p style="margin-top:15px">' + (config.directPushAllowed ? 'Tool MCP diizinkan menulis langsung ke branch tersebut sesuai konfigurasi workspace.' : 'Tool MCP harus menggunakan branch baru dan pull request untuk branch yang dilindungi.') + '</p></article>';
  }
  async function refresh() {
    if (!state.session) return;
    $('refresh').disabled = true;
    try { await loadRepos(false); delete state.errors.repositories; }
    catch (error) { state.errors.repositories = error.message; if (error.status === 401) { showLogin(error.message); $('refresh').disabled = false; return; } }
    await Promise.allSettled([loadDetails(), loadDeployments(), loadAudit(false), ...(state.view === 'files' ? [loadFiles(false), loadUsage(false)] : [])]);
    setNotice(); $('refresh').disabled = false;
  }
  async function logout() { try { await api('logout', { method: 'POST' }); showLogin(); location.assign('/dashboard'); } catch (error) { if (error.status === 401) { location.assign('/dashboard'); return; } toast(error.message); } }
  async function copyEndpoint() { const value = state.session ? state.session.configuration.endpoint : location.origin + '/mcp'; try { await navigator.clipboard.writeText(value); toast('Endpoint MCP disalin'); } catch (_) { toast('Salin endpoint: ' + value); } }
  document.addEventListener('click', function (event) {
    const viewButton = event.target.closest('[data-view], [data-go]'); if (viewButton && state.session) setView(viewButton.dataset.view || viewButton.dataset.go);
    const repoButton = event.target.closest('[data-select-repo]'); if (repoButton) { state.repo = repoButton.dataset.selectRepo; $('repo-select').value = state.repo; $('repo-link').href = 'https://github.com/' + state.repo; try { localStorage.setItem('ops-repo', state.repo); } catch (_) {} setView('pulls'); void loadDetails(); }
    if (event.target.closest('[data-copy]')) void copyEndpoint();
    if (event.target.closest('[data-logout]')) void logout();
    if (event.target.closest('main') && $('sidebar').classList.contains('open')) { $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); }
  });
  $('repo-select').addEventListener('change', function () { state.repo = this.value; $('repo-link').href = 'https://github.com/' + state.repo; try { localStorage.setItem('ops-repo', state.repo); } catch (_) {} void loadDetails(); });
  $('repo-search').addEventListener('input', renderRepos); $('repo-filter').addEventListener('change', renderRepos); $('pr-filter').addEventListener('change', renderPulls);
  $('audit-errors').addEventListener('change', function () { void loadAudit(false); });
  $('load-repos').addEventListener('click', async function () { this.disabled = true; try { await loadRepos(true); } catch (error) { toast(error.message); } finally { this.disabled = false; } });
  $('load-audit').addEventListener('click', async function () { this.disabled = true; try { await loadAudit(true); } finally { this.disabled = false; } });
  $('refresh').addEventListener('click', function () { void refresh(); }); $('logout').addEventListener('click', function () { void logout(); }); $('copy-sidebar').addEventListener('click', function () { void copyEndpoint(); });
  $('menu-toggle').addEventListener('click', function () { const open = $('sidebar').classList.toggle('open'); this.setAttribute('aria-expanded', String(open)); });
  $('theme-toggle').addEventListener('click', function () { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('ops-theme', theme); } catch (_) {} });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); } if (event.key === '/' && state.session && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); setView('repositories'); $('repo-search').focus(); } });
  try { document.documentElement.dataset.theme = localStorage.getItem('ops-theme') === 'light' ? 'light' : 'dark'; } catch (_) {}
  async function start() {
    try {
      state.session = await api('session'); $('login-view').classList.add('hidden'); $('authenticated').classList.remove('hidden'); $('logout').classList.remove('hidden');
      $('profile-name').textContent = state.session.user.name; $('profile-sub').textContent = '@' + state.session.user.login;
      const avatar = document.createElement('img'); avatar.src = safeUrl(state.session.user.avatarUrl); avatar.alt = ''; avatar.addEventListener('error', function () { $('profile-avatar').textContent = state.session.user.login.slice(0, 1).toUpperCase(); }); $('profile-avatar').replaceChildren(avatar);
      renderSettings(); setView(location.hash.slice(1) || 'overview'); renderStats(); $('repositories-grid').innerHTML = loading(); $('overview-activity').innerHTML = loading(); renderDeployments();
      await refresh();
    } catch (error) { if (error.status !== 401) showLogin(error.message); }
  }
  // Inline SVG keeps navigation and actions legible on systems without symbol fonts.
  const iconPaths = {
    '↗': '<path d="M7 17 17 7M7 7h10v10"/>',
    '▤': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h6"/>',
    '◫': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10 3v18M10 10h11"/>',
    '⑂': '<circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="5" r="2"/><path d="M7 7v10M17 7v3a4 4 0 0 1-4 4H7"/>',
    '≋': '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    '⚙': '<circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z"/>',
    '↪': '<path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/>',
    '◐': '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
    '☰': '<path d="M4 6h16M4 12h16M4 18h16"/>',
    '⌕': '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    '↻': '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M19 16a8 8 0 0 1-13 3l-2-3"/>'
  };
  function renderIcons(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && !['SCRIPT', 'STYLE', 'OPTION', 'TEXTAREA'].includes(node.parentElement.tagName) && /[↗▤◫⑂≋⚙↪◐☰⌕↻]/.test(node.nodeValue)) nodes.push(node);
    }
    nodes.forEach(function (text) {
      const fragment = document.createDocumentFragment();
      text.nodeValue.split(/([↗▤◫⑂≋⚙↪◐☰⌕↻])/).forEach(function (part) {
        if (!iconPaths[part]) { fragment.append(document.createTextNode(part)); return; }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'svg-icon'); svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = iconPaths[part]; fragment.append(svg);
      });
      text.replaceWith(fragment);
    });
  }
  renderIcons(document.body);
  const iconObserver = new MutationObserver(function (records) {
    const roots = new Set();
    records.forEach(function (record) { if (record.target instanceof Element && !record.target.closest('svg')) roots.add(record.target); });
    roots.forEach(renderIcons);
  });
  iconObserver.observe(document.body, { childList: true, subtree: true });
  void start();
})();
`

# BYGA Konten — Agent Skill v2.0

A portable **Agent Skills** package for TikTok: carousel, text-to-image, text-to-video, UGC / affiliate, trend-led creative work, episodic drama. Optimized for Indonesian content creation and brand-specific workflows. By default, @jalurtarot Mystic Purple/Gold applies **only** when that account is explicitly requested.

## Contents
- `SKILL.md`: lightweight routing and core operating contract.
- `references/`: deep specialized workflows, consistency system, QC, model adaptation, original BYGA master prompt and playbook.
- `assets/`: reuse-ready creative brief, storyboard, carousel sheet, UGC shot list, brand and character bible, CSV continuity ledger.
- `scripts/`: optional offline JSON QC and package metadata checks (Python standard library).
- `examples/`: valid carousel and video demonstration packages and sample prompts.

## Install or use
**ChatGPT Skills (eligible Business/Enterprise/Healthcare/Edu workspace with permissions):** Open sidebar Plugins → Skills → Create → Upload from your computer; choose the ZIP containing one top-level folder `byga-konten/`. Check the UI for review/installation status. File creation here **does not install** the skill on your account.

**ChatGPT personal plan / Projects:** Create a Project named "BYGA TikTok Creative Studio", paste `SKILL.md` body or `references/original-master-instructions.md` into Project instructions (use only the parts that fit), and attach the production playbook as a project file. Uploaded knowledge does not automatically register as a native Skill.

**Agent Skills compatible apps / Codex:** Place this folder in the directory your host scans for local skills and open a new session; in many Codex workflows the personal directory is `~/.agents/skills/byga-konten/` (on Windows typically `%USERPROFILE%\.agents\skills\byga-konten`). Confirm your host's actual configuration since paths vary.

**OpenAI API (if applicable to your environment):** Upload the ZIP through a supported skill API endpoint; available environments and permissions vary. API usage and subscription are separate.

## What this is / isn't
This skill teaches production workflows. It **does not** bundle paid video generation, upload TikTok content, scrape trends automatically, manage user credentials, or guarantee views. Render operations require available tools and explicit access.

## Examples
- `Buat carousel @jalurtarot 8 slide tentang angka jalan hidup 4. Desain Mystic Purple premium, teks akurat, caption.`
- `I: prompt 5 potret sinematik karakter yang sama dari foto referensi, vertikal 9:16.`
- `V: video 30 detik tentang produk ini, prompt per shot, VO Indonesia dan timecode.`
- `U: video UGC affiliate produk [produk], hanya gunakan spesifikasi yang saya berikan.`
- `T: cari tren TikTok terkini niche teknologi di Indonesia dan buat konsep orisinal.`
- `D: drama romantis 5 episode 30 detik, karakter tetap, dialog dan cliffhanger.`

## Run local checks
```
python scripts/validate_skill.py .
python scripts/content_qc.py --input examples/carousel-sample.json --mode carousel
python scripts/content_qc.py --input examples/video-sample.json --mode video
python -m unittest discover -s tests -v
```
No extra Python packages required. These checks validate basic structure and timing, **not creativity/fact-checking**.

## Versioning
v2.0.0. Invocation: `byga-konten`. Feel free to edit private brand presets, themes, workflows and templates. When modifying the skill, keep `SKILL.md` YAML metadata and folder name aligned.

# BYGA Skills in BYGA MCP MCP

The Worker exposes five canonical skills:

| Skill ID | Scope |
| --- | --- |
| `byga-android` | Android idea/PRD, stack recommendation, working project, debug APK builds in GitHub Actions and optional GitHub prereleases. |
| `byga-coding` | PRD, architecture, implementation, debugging, audits, GitHub CI/CD, Cloudflare operations, security and production verification. Merges the fullstack lifecycle and engineering playbook. |
| `byga-konten` | TikTok carousel, image/video concepts, UGC/affiliate, creative trends, episodic drama and content QC. |
| `byga-foto-profesional` | Professional photo enhancement: color correction, lighting, skin tone, sharpness, noise and dynamic range while preserving identity, objects, text and framing. |
| `byga-prompt` | Image/video/edit prompt enhancement; intent and reference locks, visual direction, shot continuity, model compatibility and evidence-based refinement. |

Packages live in `skills/<name>/`; each `SKILL.md` is the entry point. References are loaded when relevant; bundled Python scripts never execute automatically.

## Invocation

After the updated source reaches the configured GitHub ref and the Worker registry is deployed, refresh/reconnect MCP discovery as needed. Try:

- `Gunakan byga-android untuk membuat aplikasi stok offline dari PRD sampai APK uji coba via GitHub Actions.`
- `Gunakan byga-coding untuk audit CI repo mcpnew.`
- `Gunakan byga-coding mode FULL untuk membangun aplikasi Cloudflare sesuai kebutuhan ini.`
- `Gunakan byga-konten: carousel 8 slide untuk @jalurtarot, lengkap dengan caption.`
- `Gunakan byga-foto-profesional untuk enhance foto yang saya upload, natural dan tanpa mengubah wajah.`
- `Gunakan byga-foto-profesional: hanya prompt enhance foto profesional.`
- `Gunakan byga-prompt untuk enhance prompt video ini. Pertahankan karakter dan dialog; hanya prompt final.`

For direct tool calls:

1. `list_skills` discovers available metadata and per-account enabled state.
2. `get_skill_instructions(name="byga-coding")` reads that skill's instructions.
3. `read_skill_file(name="byga-coding", file="references/fullstack-lifecycle.md")` loads a relevant reference.

The `use-skill(name, task?)` MCP prompt also loads instructions in supporting clients. This is MCP discovery and prompt loading, not native ChatGPT Skills installation. A host chooses whether to call tools/prompts; the Worker cannot force activation on every message.

`byga-konten` produces the overall content package; `byga-prompt` focuses on refining individual visual prompts. They can be combined when the user's task benefits from both, without duplicating output.

`byga-foto-profesional` specializes in editing uploaded photos or preparing a copy-ready photo edit prompt. Its template is `skills/byga-foto-profesional/assets/prompt-enhance-foto.md`. It requires the original photo for edits, preserves all seven enhancement areas and the mandatory identity/content locks, and checks available output against the source. It supplies instructions, not an image renderer; actual editing requires a host image-editing tool. Identity preservation is an acceptance criterion, not an unverified guarantee.

`byga-android` specializes in Android delivery: it asks for the app requirements, recommends Kotlin/Jetpack Compose or Flutter based on those requirements, implements the app, and verifies a debug APK. Its PRD/checklist and native/Flutter workflow templates live in `skills/byga-android/`. Templates must be filled with verified toolchain versions and action SHAs, then copied into the application repository. Actions artifacts require repository access and expire; optional Releases publishing is an explicit manual dispatch and uses a separate write-permission job. Production signing is a separate scope. The package itself is a skill, not a prebuilt app or an APK.

## Renaming and existing account settings

| Previous ID | Canonical ID |
| --- | --- |
| `byga-cloudflare-fullstack` | `byga-coding` |
| `byga-coding-engineering` | `byga-coding` |
| `byga-tiktok-creative-studio` | `byga-konten` |
| `byga-prompt-enhancer` | `byga-prompt` |

Discovery lists only the five canonical built-ins. Previous IDs remain accepted as compatibility aliases for existing calls, but resolve to the canonical package and current installation source. Old stored metadata cannot redirect a built-in to a stale source.

Account preferences are read without rewriting KV. An explicit canonical enabled/disabled setting wins. Otherwise a disabled legacy built-in stays disabled; if either old engineering skill was disabled, the merged `byga-coding` stays disabled until explicitly enabled. `set_skill_enabled`, including calls using an old alias, writes the canonical setting. Other users' settings are unaffected. No database migration or automatic deletion of legacy records is needed.

## Tools and access

- `install_skill_from_github(owner, repo, path, ref?)` imports a readable third-party skill after validating its manifest. Canonical built-in IDs and their old aliases are reserved.
- `set_skill_enabled(name, enabled)` changes availability for the connected account.
- `uninstall_skill(name, confirm)` removes a user-imported registration; confirmation must match the name. Built-ins cannot be uninstalled through this tool; disable them instead.

Instructions and references are read from the source configured in `installation.json`. The account's GitHub OAuth token must be able to read that repository/ref. Custom skill registrations and preferences are account-scoped in `OAUTH_KV`; write audit logging remains best effort.

## Quality and verification limits

`byga-prompt` supports ENHANCE, DIAGNOSE, VARIANTS, REFINE, SERIES and HANDOFF. Its templates separate required-detail gates from aesthetic judgments. A prompt review is not a render evaluation; no 99.9% accuracy or success rate is claimed without an actual representative benchmark.

Registry tests check discovery, packaged file loading, alias migration, enabled-state isolation and built-in source protection. Package validation checks manifests and local resource paths. These checks do not prove visual quality, host auto-activation, GitHub/Cloudflare permissions, or successful production deployment.

## Security

Skill files are task guidance and lower-trust data. They cannot override user/system instructions, grant account access or authorize unrequested actions. The server constrains paths and file sizes; optional scripts are read as text and never run by the registry. Existing protected-branch, confirmation and audit guards still apply. Review third-party skill instructions before using them.


## Penguatan import Oktober 2026

Import baru menyimpan SHA commit yang diselesaikan dari ref saat install, bukan mengikuti perubahan branch selanjutnya. File eksternal dibaca melalui Git tree; tiap direktori harus tree dan file akhir harus blob reguler. Symlink/submodule, path traversal, file di atas 64 KiB, UTF-8 invalid dan binary NUL ditolak. Script yang valid tetap bisa dibaca sebagai teks; tidak pernah dijalankan. Sumber eksternal tetap harus ditinjau manusia dan tidak memberi izin tool.

Built-in dan preferensi/alias lama tidak dimigrasikan atau dihapus. Import lama dengan ref mutable masih bisa dibaca dengan pemeriksaan Git tree baru; uninstall/install ulang untuk memperoleh pin SHA. Allowlist diperiksa pada setiap tool dan prompt `use-skill`, termasuk sesi MCP lama. Tidak ada instruksi akun lain yang dibaca melalui registry pemanggil.

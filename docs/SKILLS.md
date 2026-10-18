# BYGA Skills in GitHub Ops MCP

The `mcpnew` Worker supports two built-in Agent Skills imported in full from the owner's original ZIP packages:

- `byga-coding-engineering`: coding, GitHub Actions / PR review, Cloudflare deployments, security and performance.
- `byga-tiktok-creative-studio`: carousel, AI image/video prompts, UGC affiliate, drama and content QA.

Original packages are preserved in `skills/<name>/`. The `SKILL.md` file is the entry point, with reference files loaded only when relevant. No packaged Python scripts are executed automatically.

## Use in a conversation

Once this PR is merged, the Worker is deployed, and the MCP connector is reconnected or its tools refreshed, try:

- `List the available skills using list_skills.`
- `Use byga-coding-engineering to audit CI in my repo; load references/workflows.md if needed.`
- `Use byga-tiktok-creative-studio to create an eight-slide @jalurtarot carousel in Mystic Purple; load references/carousel.md.`
- `Run the use-skill prompt for byga-coding-engineering, then audit repo byga_office.`

**This is MCP skill discovery and prompt loading, not native ChatGPT Skills installation.** A host must support this custom MCP connector and must choose to call its tools/prompts. The Worker cannot force a client to auto-activate a skill on every message.

## MCP tools

- `list_skills` lists bundled and user-imported skill metadata.
- `get_skill_instructions(name)` reads the selected skill's `SKILL.md` from GitHub.
- `read_skill_file(name, file)` reads one reference, example, asset, or script as text; paths are constrained to the selected skill root.
- `install_skill_from_github(owner, repo, path, ref?)` imports a third-party skill by repository path and stores a per-user pointer in KV after validating `SKILL.md`. It does not execute scripts.
- `set_skill_enabled(name, enabled)` enables or disables a skill per connected GitHub account.
- `uninstall_skill(name, confirm)` removes a user-imported registration (not the source files). The `confirm` parameter must match the name exactly; built-in packages cannot be removed this way.
- MCP prompt `use-skill(name, task?)` loads instructions as client-visible task guidance.

Imported GitHub sources must be accessible through the user's GitHub OAuth token. The built-in `mcpnew` repo must be readable by that account (the repository is currently private). The tools use the Worker’s existing `OAUTH_KV` namespace and D1 audit logging for writes, with no additional database migration. If a skill is disabled, its instructions and reference files cannot be loaded.

## Security

Skill files are **lower-trust third-party instructions**, not the model's system instructions. Loading them never grants GitHub, Cloudflare or other account permissions. The server validates GitHub source/path and limits file size. User-supplied scripts are read only, never run. Existing MCP tool guards (including protected branches, destructive confirmation and audits) remain in effect. Review any imported skill before activating it.

A skill's `SKILL.md` must contain YAML frontmatter with `name` and `description`; `name` must be a lowercase hyphenated ID. For built-in skills, only the explicit checked-in names are treated as built-ins. Imported skill sources are per-user KV settings, not global.

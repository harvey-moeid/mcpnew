/**
 * User-scoped registry for portable Agent Skills.
 * Skills are Markdown instructions, not executable plugins; their scripts are never run here.
 * Built-ins live in this repository; user imports point to an authenticated GitHub repository.
 */
import type { Octokit } from 'octokit'
import installation from '../installation.json' with { type: 'json' }

const skillSource = { owner: installation.githubOwner, repo: installation.githubRepo, ref: installation.githubRef }

export type SkillEntry = {
  name: string
  description: string
  version?: string
  source: { owner: string; repo: string; path: string; ref: string }
  builtIn: boolean
  enabled: boolean
}

export const BUILTIN_SKILLS: SkillEntry[] = [
  {
    name: 'byga-android',
    description: 'Build Android apps from discovery and PRD through stack selection, project implementation and installable test APKs delivered by GitHub Actions or GitHub Releases.',
    version: '1.0.0', builtIn: true, enabled: true,
    source: { ...skillSource, path: 'skills/byga-android' },
  },
  {
    name: 'byga-foto-profesional',
    description: 'Enhance uploaded photos with natural professional color correction, balanced lighting, realistic skin tones, subtle detail and noise reduction while preserving identity, objects, text, framing and composition.',
    version: '1.0.0', builtIn: true, enabled: true,
    source: { ...skillSource, path: 'skills/byga-foto-profesional' },
  },
  {
    name: 'byga-prompt',
    description: 'Enhance image and video prompts with intent preservation, reference and continuity locks, model-aware visual direction, and evidence-based evaluation and refinement.',
    version: '2.0.0', builtIn: true, enabled: true,
    source: { ...skillSource, path: 'skills/byga-prompt' },
  },
  {
    name: 'byga-coding',
    description: 'Unified engineering workflow for PRD, architecture, implementation, debugging, audits, GitHub CI/CD, Cloudflare operations, security and production verification.',
    version: '2.0.0', builtIn: true, enabled: true,
    source: { ...skillSource, path: 'skills/byga-coding' },
  },
  {
    name: 'byga-konten',
    description: 'TikTok carousel, prompts for images and videos, UGC affiliate, creative trends and episodic drama.',
    version: '2.0.0', builtIn: true, enabled: true,
    source: { ...skillSource, path: 'skills/byga-konten' },
  },
]

const prefix = (actor: string) => `mcp-skill:${actor}:`
const key = (actor: string, name: string) => prefix(actor) + name
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/

// Keep existing sessions and per-account disabled settings usable after renaming.
// Discovery exposes only the canonical names, with current checked-in sources.
const LEGACY_NAMES: Record<string, string> = {
  'byga-cloudflare-fullstack': 'byga-coding',
  'byga-coding-engineering': 'byga-coding',
  'byga-tiktok-creative-studio': 'byga-konten',
  'byga-prompt-enhancer': 'byga-prompt',
}
const canonicalName = (name: string) => Object.hasOwn(LEGACY_NAMES, name) ? LEGACY_NAMES[name] : name

function parseStoredSkill(raw: string | null, name: string): SkillEntry | undefined {
  if (!raw) return undefined
  try {
    const skill = JSON.parse(raw) as SkillEntry
    if (skill?.name === name && typeof skill.enabled === 'boolean' && skill.source && typeof skill.source.owner === 'string' && REPO_PART.test(skill.source.owner) && typeof skill.source.repo === 'string' && REPO_PART.test(skill.source.repo) && typeof skill.source.ref === 'string' && typeof skill.source.path === 'string') {
      assertSafePath(skill.source.path)
      return skill
    }
  } catch { /* Ignore unusable registry records, retaining checked-in defaults. */ }
  return undefined
}

function withStoredSetting(builtIn: SkillEntry, stored: Map<string, SkillEntry>): SkillEntry {
  const current = stored.get(builtIn.name)
  // An explicit setting under the new ID wins. Otherwise retain a disabled
  // legacy built-in; either disabled engineering skill disables the merged one.
  const enabled = current ? current.enabled : !Object.entries(LEGACY_NAMES).some(([old, name]) =>
    name === builtIn.name && stored.get(old)?.builtIn === true && stored.get(old)?.enabled === false)
  return { ...builtIn, enabled }
}

export function assertSkillName(name: string): void {
  if (!SKILL_NAME.test(name)) throw new Error('Skill name must be lowercase, hyphenated and 1–64 characters.')
}

export function assertSafePath(path: string): void {
  if (!path || path.length > 240 || path.startsWith('/') || path.includes('\\') || path.includes('%') ||
    path.split('/').some(segment => !REPO_PART.test(segment) || segment === '.' || segment === '..')) {
    throw new Error('Invalid relative skill path.')
  }
}

export function parseSkillHeader(markdown: string): { name: string; description: string; version?: string } {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (!block) throw new Error('Skill must start with SKILL.md YAML frontmatter.')
  const read = (label: string) => {
    const raw = block.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
    return raw.replace(/^(["'])(.*)\1$/, '$2')
  }
  const name = read('name')
  const description = read('description')
  if (!name || !description) throw new Error('SKILL.md must declare name and description.')
  assertSkillName(name)
  return { name, description: description.slice(0, 800), version: read('version') || undefined }
}

export async function getSkills(kv: KVNamespace, actor: string): Promise<SkillEntry[]> {
  const stored = new Map<string, SkillEntry>()
  let cursor: string | undefined
  // Bound the listing to avoid unexpectedly large reads / KV request costs.
  for (let page = 0; page < 5; page++) {
    const result = await kv.list({ prefix: prefix(actor), cursor, limit: 100 })
    for (const item of result.keys) {
      const name = item.name.slice(prefix(actor).length)
      const entry = parseStoredSkill(await kv.get(item.name), name)
      if (entry && SKILL_NAME.test(name)) stored.set(name, entry)
    }
    if (result.list_complete) {
      const entries = new Map([...stored].filter(([name]) => canonicalName(name) === name))
      for (const builtIn of BUILTIN_SKILLS) entries.set(builtIn.name, withStoredSetting(builtIn, stored))
      return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
    }
    cursor = result.cursor
    if (!cursor) break
  }
  throw new Error('Too many skills to list. Reduce the number of installed skills.')
}

export async function getSkill(kv: KVNamespace, actor: string, name: string): Promise<SkillEntry> {
  assertSkillName(name)
  name = canonicalName(name)
  const stored = parseStoredSkill(await kv.get(key(actor, name)), name)
  const builtIn = BUILTIN_SKILLS.find(entry => entry.name === name)
  if (builtIn) {
    const settings = new Map<string, SkillEntry>()
    if (stored) settings.set(name, stored)
    else for (const [old, target] of Object.entries(LEGACY_NAMES)) {
      if (target !== name) continue
      const legacy = parseStoredSkill(await kv.get(key(actor, old)), old)
      if (legacy) settings.set(old, legacy)
    }
    return withStoredSetting(builtIn, settings)
  }
  if (!stored) throw new Error(`Skill ${name} is not installed.`)
  return stored
}

export async function readSkillFile(octokit: Octokit, skill: SkillEntry, relativePath = 'SKILL.md'): Promise<string> {
  assertSafePath(relativePath)
  if (!skill.enabled) throw new Error(`Skill ${skill.name} is disabled.`)
  const { owner, repo, ref, path } = skill.source
  assertSafePath(path)
  const data = skill.builtIn ? (await octokit.rest.repos.getContent({ owner, repo, path: `${path}/${relativePath}`, ref })).data : await readImportedBlob(octokit, skill, relativePath)
  if (Array.isArray(data) || data.type !== 'file' || !('content' in data) || data.encoding !== 'base64' || 'target' in data || 'submodule_git_url' in data) {
    throw new Error('Requested skill file is unavailable or is not a regular file.')
  }
  if ((data.size ?? 0) > 65536) throw new Error('Skill file is too large (64 KiB maximum).')
  const encoded = data.content.replace(/\s/g, '')
  if (encoded.length > 4 * Math.ceil(65536 / 3)) throw new Error('Skill file exceeds the supported size.')
  const binary = atob(encoded)
  if (binary.length > 65536) throw new Error('Skill file exceeds the supported size.')
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
  if (decoded.includes('\0')) throw new Error('Binary skill files are not supported.')
  if (decoded.length > 65536) throw new Error('Skill file exceeds the supported size.')
  return decoded
}

// Resolve Git tree entries rather than Contents API symlink dereferencing.
// Every parent must be a directory, and the leaf must be a regular blob.
async function readImportedBlob(octokit: Octokit, skill: SkillEntry, relativePath: string) {
  const { owner, repo, ref, path } = skill.source
  const commit = await octokit.rest.repos.getCommit({ owner, repo, ref })
  let treeSha = commit.data.commit.tree.sha
  const segments = `${path}/${relativePath}`.split('/')
  if (segments.length > 32) throw new Error('Skill path is too deep.')
  for (const [index, segment] of segments.entries()) {
    const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha })
    if (tree.data.truncated) throw new Error('Skill source directory is too large to validate safely.')
    const entry = tree.data.tree.find(entry => entry.path === segment)
    if (!entry?.sha) throw new Error('Requested skill file is unavailable.')
    if (index < segments.length - 1) {
      if (entry.type !== 'tree' || entry.mode !== '040000') throw new Error('Skill paths cannot traverse symlinks or submodules.')
      treeSha = entry.sha
    } else {
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode ?? '')) throw new Error('Skill file must be a regular file, not a symlink or submodule.')
      if ((entry.size ?? 0) > 65536) throw new Error('Skill file is too large (64 KiB maximum).')
      const blob = (await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha })).data
      return { ...blob, type: 'file' as const }
    }
  }
  throw new Error('Requested skill file is unavailable.')
}

export async function installSkillFromGitHub(
  octokit: Octokit, kv: KVNamespace, actor: string,
  input: { owner: string; repo: string; path: string; ref?: string },
): Promise<SkillEntry> {
  if (!REPO_PART.test(input.owner) || !REPO_PART.test(input.repo) || input.owner === '.' || input.repo === '.') {
    throw new Error('Invalid GitHub owner or repository.')
  }
  assertSafePath(input.path)
  const ref = input.ref || 'main'
  if (ref.length > 100 || !/^[A-Za-z0-9_./-]+$/.test(ref) || ref.includes('..')) {
    throw new Error('Invalid Git ref.')
  }
  const commit = await octokit.rest.repos.getCommit({ owner: input.owner, repo: input.repo, ref })
  const pinnedRef = commit.data.sha
  if (!/^[a-f0-9]{40}$/i.test(pinnedRef)) throw new Error('Cannot resolve skill source to an immutable commit.')
  const provisional: SkillEntry = {
    name: 'candidate', description: '', builtIn: false, enabled: true,
    source: { owner: input.owner, repo: input.repo, path: input.path, ref: pinnedRef },
  }
  const markdown = await readSkillFile(octokit, provisional)
  const manifest = parseSkillHeader(markdown)
  if (BUILTIN_SKILLS.some(skill => skill.name === canonicalName(manifest.name))) {
    throw new Error('This skill is built in; do not override it with an external repository.')
  }
  if (await kv.get(key(actor, manifest.name))) {
    throw new Error(`Skill ${manifest.name} is already installed; uninstall it before importing a different source.`)
  }
  const installed: SkillEntry = { ...provisional, name: manifest.name, description: manifest.description, version: manifest.version }
  await kv.put(key(actor, installed.name), JSON.stringify(installed))
  return installed
}

export async function setSkillEnabled(kv: KVNamespace, actor: string, name: string, enabled: boolean): Promise<SkillEntry> {
  const skill = await getSkill(kv, actor, name)
  const next = { ...skill, enabled }
  await kv.put(key(actor, skill.name), JSON.stringify(next))
  return next
}

export async function uninstallSkill(kv: KVNamespace, actor: string, name: string): Promise<void> {
  const skill = await getSkill(kv, actor, name)
  if (skill.builtIn) throw new Error('Built-in skills cannot be uninstalled. Disable them instead.')
  await kv.delete(key(actor, name))
}

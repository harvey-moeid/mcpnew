/**
 * User-scoped registry for portable Agent Skills.
 * Skills are Markdown instructions, not executable plugins; their scripts are never run here.
 * Built-ins live in this repository; user imports point to an authenticated GitHub repository.
 */
import type { Octokit } from 'octokit'

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
    name: 'byga-tiktok-creative-studio',
    description: 'TikTok carousel, prompts for images and videos, UGC affiliate, creative trends and episodic drama.',
    version: '1.0.0', builtIn: true, enabled: true,
    source: { owner: 'harvey-moeid', repo: 'mcpnew', path: 'skills/byga-tiktok-creative-studio', ref: 'main' },
  },
  {
    name: 'byga-coding-engineering',
    description: 'Code audits, implementation, debugging, GitHub Actions and PRs, Cloudflare operations and security.',
    version: '1.0.0', builtIn: true, enabled: true,
    source: { owner: 'harvey-moeid', repo: 'mcpnew', path: 'skills/byga-coding-engineering', ref: 'main' },
  },
]

const prefix = (actor: string) => `mcp-skill:${actor}:`
const key = (actor: string, name: string) => prefix(actor) + name
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/

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
  const entries = new Map(BUILTIN_SKILLS.map(skill => [skill.name, { ...skill }]))
  let cursor: string | undefined
  // Bound the listing to avoid unexpectedly large reads / KV request costs.
  for (let page = 0; page < 5; page++) {
    const result = await kv.list({ prefix: prefix(actor), cursor, limit: 100 })
    for (const item of result.keys) {
      const raw = await kv.get(item.name)
      if (!raw) continue
      let stored: SkillEntry
      try { stored = JSON.parse(raw) as SkillEntry } catch { continue }
      if (stored?.name && item.name === key(actor, stored.name)) entries.set(stored.name, stored)
    }
    if (result.list_complete) return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
    cursor = result.cursor
    if (!cursor) break
  }
  throw new Error('Too many skills to list. Reduce the number of installed skills.')
}

export async function getSkill(kv: KVNamespace, actor: string, name: string): Promise<SkillEntry> {
  assertSkillName(name)
  const stored = await kv.get(key(actor, name))
  const builtIn = BUILTIN_SKILLS.find(entry => entry.name === name)
  if (!stored && builtIn) return { ...builtIn }
  if (!stored) throw new Error(`Skill ${name} is not installed.`)
  const skill = JSON.parse(stored) as SkillEntry
  if (skill.name !== name || !skill.source) throw new Error('Invalid stored skill entry.')
  return skill
}

export async function readSkillFile(octokit: Octokit, skill: SkillEntry, relativePath = 'SKILL.md'): Promise<string> {
  assertSafePath(relativePath)
  if (!skill.enabled) throw new Error(`Skill ${skill.name} is disabled.`)
  const { owner, repo, ref, path } = skill.source
  assertSafePath(path)
  const response = await octokit.rest.repos.getContent({ owner, repo, path: `${path}/${relativePath}`, ref })
  const data = response.data
  if (Array.isArray(data) || data.type !== 'file' || !('content' in data) || data.encoding !== 'base64') {
    throw new Error('Requested skill file is unavailable or is not a regular file.')
  }
  if ((data.size ?? 0) > 65536) throw new Error('Skill file is too large (64 KiB maximum).')
  const binary = atob(data.content.replace(/\s/g, ''))
  const decoded = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
  if (decoded.length > 65536) throw new Error('Skill file exceeds the supported size.')
  return decoded
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
  const provisional: SkillEntry = {
    name: 'candidate', description: '', builtIn: false, enabled: true,
    source: { owner: input.owner, repo: input.repo, path: input.path, ref },
  }
  const markdown = await readSkillFile(octokit, provisional)
  const manifest = parseSkillHeader(markdown)
  if (BUILTIN_SKILLS.some(skill => skill.name === manifest.name)) {
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
  await kv.put(key(actor, name), JSON.stringify(next))
  return next
}

export async function uninstallSkill(kv: KVNamespace, actor: string, name: string): Promise<void> {
  const skill = await getSkill(kv, actor, name)
  if (skill.builtIn) throw new Error('Built-in skills cannot be uninstalled. Disable them instead.')
  await kv.delete(key(actor, name))
}

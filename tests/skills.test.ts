import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import installation from '../installation.json' with { type: 'json' }
import { BUILTIN_SKILLS, parseSkillHeader, assertSafePath, getSkills, getSkill,
  readSkillFile, installSkillFromGitHub, setSkillEnabled, uninstallSkill } from '../src/skill-registry.ts'

function mockKV() {
  const store = new Map<string, string>()
  return { store,
    async get(name: string) { return store.get(name) ?? null },
    async put(name: string, value: string) { store.set(name, value) },
    async delete(name: string) { store.delete(name) },
    async list({ prefix }: { prefix: string }) { return { keys: [...store.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })), list_complete: true } },
  }
}
const manifest = '---\nname: custom-byga-skill\ndescription: "A custom test skill"\n---\n# Custom Skill\nUse only with user permission.\n'
const mockGitHub = {
  rest: { repos: { async getContent({ path }: { path: string }) {
    return { data: { type: 'file', encoding: 'base64', size: manifest.length,
      content: Buffer.from(path.endsWith('SKILL.md') ? manifest : '# Reference').toString('base64') } }
  } } },
}

test('all BYGA built-in skills are discoverable', async () => {
  const kv = mockKV()
  const entries = await getSkills(kv as any, 'actor')
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map(x => x.name), BUILTIN_SKILLS.map(x => x.name).sort())
  assert.equal((await getSkill(kv as any, 'actor', 'byga-coding-engineering')).enabled, true)
})

test('Cloudflare fullstack skill loads its packaged instructions through the registry', async () => {
  const kv = mockKV()
  const skill = await getSkill(kv as any, 'actor', 'byga-cloudflare-fullstack')
  assert.equal(skill.builtIn, true)
  assert.equal(skill.enabled, true)
  const github = { rest: { repos: { async getContent({ owner, repo, path, ref }: {
    owner: string; repo: string; path: string; ref: string
  }) {
    assert.equal(owner, installation.githubOwner)
    assert.equal(repo, installation.githubRepo)
    assert.equal(ref, installation.githubRef)
    const content = await readFile(new URL(`../${path}`, import.meta.url))
    return { data: { type: 'file', encoding: 'base64', size: content.length,
      content: content.toString('base64') } }
  } } } }
  const instructions = await readSkillFile(github as any, skill)
  const header = parseSkillHeader(instructions)
  assert.equal(header.name, skill.name)
  assert.equal(header.description, skill.description)
  assert.match(instructions, /Mode default: FULL\./)
  await setSkillEnabled(kv as any, 'actor', skill.name, false)
  assert.equal((await getSkill(kv as any, 'actor', skill.name)).enabled, false)
  assert.equal((await getSkill(kv as any, 'another-user', skill.name)).enabled, true)
})

test('manifest validation and traversal prevention', () => {
  assert.equal(parseSkillHeader(manifest).name, 'custom-byga-skill')
  assert.throws(() => parseSkillHeader('no frontmatter'), /frontmatter/)
  for (const invalid of ['../.env', '/root/file', 'references/../SKILL.md', 'a\\b', '%2e%2e', '']) {
    assert.throws(() => assertSafePath(invalid), /Invalid/)
  }
  assert.doesNotThrow(() => assertSafePath('references/workflows.md'))
})

test('install, load, disable, enable, and remove custom skill per account', async () => {
  const kv = mockKV()
  const installed = await installSkillFromGitHub(mockGitHub as any, kv as any, 'actor',
    { owner: 'owner', repo: 'repo', path: 'skills/custom-byga-skill', ref: 'main' })
  assert.equal(installed.name, 'custom-byga-skill')
  assert.equal((await getSkill(kv as any, 'actor', installed.name)).enabled, true)
  assert.equal((await getSkills(kv as any, 'another-user')).length, BUILTIN_SKILLS.length)
  assert.match(await readSkillFile(mockGitHub as any, installed, 'SKILL.md'), /custom-byga-skill/)
  assert.equal((await setSkillEnabled(kv as any, 'actor', installed.name, false)).enabled, false)
  await assert.rejects(() => readSkillFile(mockGitHub as any, { ...installed, enabled: false }), /disabled/)
  await setSkillEnabled(kv as any, 'actor', installed.name, true)
  await uninstallSkill(kv as any, 'actor', installed.name)
  await assert.rejects(() => getSkill(kv as any, 'actor', installed.name), /not installed/)
  await assert.rejects(() => uninstallSkill(kv as any, 'actor', 'byga-coding-engineering'), /Built-in/)
})

test('rejects replacing built-ins and invalid sources', async () => {
  const kv = mockKV()
  const original = manifest.replace('custom-byga-skill', 'byga-coding-engineering')
  const gh = { rest: { repos: { async getContent() { return { data: { type: 'file', encoding: 'base64', size: original.length, content: Buffer.from(original).toString('base64') } } } } } }
  await assert.rejects(() => installSkillFromGitHub(gh as any, kv as any, 'actor', { owner: 'a', repo: 'b', path: 'skill' }), /built in/)
  await assert.rejects(() => installSkillFromGitHub(gh as any, kv as any, 'actor', { owner: 'a', repo: 'b', path: '../skill' }), /Invalid/)
})

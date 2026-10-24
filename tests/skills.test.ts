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
  assert.deepEqual(entries.map(x => x.name), ['byga-coding', 'byga-konten', 'byga-prompt'])
  assert.deepEqual(entries.map(x => x.name), BUILTIN_SKILLS.map(x => x.name).sort())
  assert.equal((await getSkill(kv as any, 'actor', 'byga-coding')).enabled, true)
})

test('canonical skills load packaged instructions and referenced files through the registry', async () => {
  const kv = mockKV()
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
  for (const builtin of BUILTIN_SKILLS) {
    const skill = await getSkill(kv as any, 'actor', builtin.name)
    assert.equal(skill.builtIn, true)
    assert.equal(skill.enabled, true)
    assert.equal(skill.source.path, `skills/${skill.name}`)
    const instructions = await readSkillFile(github as any, skill)
    const header = parseSkillHeader(instructions)
    assert.equal(header.name, skill.name)
    assert.equal(header.version, skill.version)
    assert.ok(header.description.length > 0)
    const referencedFiles = [...instructions.matchAll(/`((?:references|assets|scripts|examples)\/[\w./-]+)`/g)]
    assert.ok(referencedFiles.length > 0)
    for (const [, file] of referencedFiles) {
      assertSafePath(file)
      assert.ok((await readSkillFile(github as any, skill, file)).trim(), `${skill.name}/${file}`)
    }
    await setSkillEnabled(kv as any, 'actor', skill.name, false)
    const disabled = await getSkill(kv as any, 'actor', skill.name)
    await assert.rejects(() => readSkillFile(github as any, disabled), /disabled/)
    assert.equal((await getSkill(kv as any, 'another-user', skill.name)).enabled, true)
  }
})

const legacyNames = {
  'byga-cloudflare-fullstack': 'byga-coding',
  'byga-coding-engineering': 'byga-coding',
  'byga-tiktok-creative-studio': 'byga-konten',
  'byga-prompt-enhancer': 'byga-prompt',
}
function legacySetting(name: string, enabled: boolean) {
  return { name, enabled, builtIn: true, description: 'Old metadata',
    source: { owner: 'old-owner', repo: 'old-repo', ref: 'old-ref', path: `skills/${name}` } }
}

test('legacy IDs resolve to canonical sources and retain disabled settings without duplicates', async () => {
  for (const [old, canonical] of Object.entries(legacyNames)) {
    const kv = mockKV()
    await kv.put(`mcp-skill:actor:${old}`, JSON.stringify(legacySetting(old, false)))
    const skill = await getSkill(kv as any, 'actor', old)
    assert.equal(skill.name, canonical)
    assert.equal(skill.enabled, false)
    assert.equal(skill.source.owner, installation.githubOwner)
    assert.equal(skill.source.repo, installation.githubRepo)
    assert.equal(skill.source.path, `skills/${canonical}`)
    const entries = await getSkills(kv as any, 'actor')
    assert.deepEqual(entries.map(x => x.name), ['byga-coding', 'byga-konten', 'byga-prompt'])
    assert.equal(entries.find(x => x.name === canonical)?.enabled, false)
    assert.equal((await getSkill(kv as any, 'other-user', canonical)).enabled, true)
    await setSkillEnabled(kv as any, 'actor', old, true)
    assert.equal(JSON.parse(kv.store.get(`mcp-skill:actor:${canonical}`)!).enabled, true)
    assert.equal((await getSkill(kv as any, 'actor', old)).enabled, true)
    assert.equal((await getSkills(kv as any, 'actor')).find(x => x.name === canonical)?.enabled, true)
    await setSkillEnabled(kv as any, 'actor', canonical, false)
    assert.equal((await getSkill(kv as any, 'actor', old)).enabled, false)
    await assert.rejects(() => uninstallSkill(kv as any, 'actor', old), /Built-in/)
  }
})

test('either disabled engineering skill disables the merged skill until explicitly enabled', async () => {
  const kv = mockKV()
  await kv.put('mcp-skill:actor:byga-cloudflare-fullstack', JSON.stringify(legacySetting('byga-cloudflare-fullstack', true)))
  await kv.put('mcp-skill:actor:byga-coding-engineering', JSON.stringify(legacySetting('byga-coding-engineering', false)))
  assert.equal((await getSkill(kv as any, 'actor', 'byga-coding')).enabled, false)
  assert.equal((await getSkills(kv as any, 'actor')).find(x => x.name === 'byga-coding')?.enabled, false)
  await setSkillEnabled(kv as any, 'actor', 'byga-coding', true)
  assert.equal((await getSkill(kv as any, 'actor', 'byga-cloudflare-fullstack')).enabled, true)
  assert.equal((await getSkill(kv as any, 'actor', 'byga-coding-engineering')).enabled, true)
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
  await assert.rejects(() => uninstallSkill(kv as any, 'actor', 'byga-coding'), /Built-in/)
})

test('rejects replacing canonical or legacy built-ins and invalid sources', async () => {
  const kv = mockKV()
  for (const name of [...BUILTIN_SKILLS.map(x => x.name), ...Object.keys(legacyNames)]) {
    const original = manifest.replace('custom-byga-skill', name)
    const gh = { rest: { repos: { async getContent() { return { data: { type: 'file', encoding: 'base64', size: original.length, content: Buffer.from(original).toString('base64') } } } } } }
    await assert.rejects(() => installSkillFromGitHub(gh as any, kv as any, 'actor', { owner: 'a', repo: 'b', path: 'skill' }), /built in/)
    await assert.rejects(() => installSkillFromGitHub(gh as any, kv as any, 'actor', { owner: 'a', repo: 'b', path: '../skill' }), /Invalid/)
  }
})

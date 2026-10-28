import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Run each TypeScript module directly: some Node 24 process-isolated --test
// environments report only file exits without executing the registered cases.
// Direct execution uses node:test's automatic runner and propagates failures.
let failed = false
for (const file of readdirSync(new URL('../tests/', import.meta.url)).filter(file => file.endsWith('.test.ts')).sort()) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', `tests/${file}`], { stdio: 'inherit', timeout: 120000 })
  if (result.status !== 0 || result.error) { failed = true; console.error(`FAIL ${file}: ${result.error?.message ?? result.status}`) }
}
process.exitCode = failed ? 1 : 0

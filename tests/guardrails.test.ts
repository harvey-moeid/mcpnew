import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBranchWritable } from '../src/guardrails.ts'

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOW_DIRECT_PUSH_TO_PROTECTED: 'false',
    PROTECTED_BRANCHES: 'main,master',
    ...overrides,
  } as Env
}

test('blocks writes to protected branches by default', () => {
  assert.throws(
    () => assertBranchWritable(env(), 'main'),
    /Direct writes to protected branch "main" are blocked/
  )
})

test('protected branch matching is case-insensitive', () => {
  assert.throws(() => assertBranchWritable(env(), 'MAIN'), /Direct writes/)
})

test('allows non-protected branches', () => {
  assert.doesNotThrow(() => assertBranchWritable(env(), 'feature/login'))
})

test('supports a custom protected branch list', () => {
  assert.throws(
    () => assertBranchWritable(env({ PROTECTED_BRANCHES: 'production,release' }), 'RELEASE'),
    /Direct writes/
  )
  assert.doesNotThrow(
    () => assertBranchWritable(env({ PROTECTED_BRANCHES: 'production,release' }), 'main')
  )
})

test('explicitly allows protected writes when configured', () => {
  assert.doesNotThrow(
    () => assertBranchWritable(env({ ALLOW_DIRECT_PUSH_TO_PROTECTED: 'true' }), 'main')
  )
})

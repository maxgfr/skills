import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectHost, formatInvocation } from '../hooks/invocation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the router is internal hook context, not a fourth public skill', () => {
  assert.equal(existsSync(join(root, 'skills', 'using-maxgfr', 'SKILL.md')), false)
  const claude = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.deepEqual(claude.skills, ['./skills/blueprint', './skills/build', './skills/verify'])
  const router = readFileSync(join(root, 'hooks', 'router.md'), 'utf8')
  assert.match(router, /TDD.*step aside|step aside.*TDD/is)
})

test('host skill invocations are rendered without guessing a namespace', () => {
  assert.equal(formatInvocation('verify', ['docs/plans/x.md'], { host: 'codex' }), '$verify docs/plans/x.md')
  assert.equal(
    formatInvocation('verify', ['docs/plans/x.md'], { host: 'claude', namespace: 'maxgfr' }),
    '/maxgfr:verify docs/plans/x.md',
  )
  assert.equal(formatInvocation('verify', [], { host: 'claude' }), '/verify')
  assert.equal(formatInvocation('verify'), 'invoke the verify skill')
})

test('Codex plugin variables win over Claude compatibility variables', () => {
  assert.equal(detectHost({ PLUGIN_ROOT: '/plugin', CLAUDE_PLUGIN_ROOT: '/compat' }), 'codex')
  assert.equal(detectHost({ CLAUDE_PLUGIN_ROOT: '/plugin' }), 'claude')
})

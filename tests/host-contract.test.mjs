import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'scripts', 'e2e-hosts.mjs')

test('the CI-safe host contract proves discovery, hooks and syntax for both hosts', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' }))
  assert.equal(out.ok, true)
  assert.deepEqual(out.hosts.map((host) => host.host), ['codex', 'claude'])
  for (const host of out.hosts) {
    assert.equal(host.ok, true)
    assert.deepEqual(host.skills, ['blueprint', 'build', 'verify'])
    assert.ok(host.checks.every((check) => check.ok), JSON.stringify(host.checks))
  }
  assert.equal(out.live, null)
})

test('the host contract supports help and rejects unknown flags', () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /^Usage:/)
  const bad = spawnSync(process.execPath, [SCRIPT, '--wat'], { encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /unknown flag/i)
})

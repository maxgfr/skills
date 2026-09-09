import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installedPluginMatches } from '../scripts/e2e-hosts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'scripts', 'e2e-hosts.mjs')

test('the CI-safe host contract proves explicit discovery, manual policy and no hooks for both hosts', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' }))
  assert.equal(out.ok, true)
  assert.deepEqual(out.hosts.map((host) => host.host), ['codex', 'claude'])
  for (const host of out.hosts) {
    assert.equal(host.ok, true)
    assert.deepEqual(host.skills, ['blueprint', 'build', 'verify'])
    assert.ok(host.checks.every((check) => check.ok), JSON.stringify(host.checks))
    assert.equal(host.checks.find((check) => check.id === 'manual-policy').ok, true)
    assert.equal(host.checks.find((check) => check.id === 'invocation-syntax').ok, true)
    assert.equal(host.checks.find((check) => check.id === 'no-registered-hooks').ok, true)
  }
  assert.equal(out.matrix.agentExecuted, false)
  assert.equal(out.matrix.measurementKind, 'structural-fixture')
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

test('live installation checks the manifest version and enabled state exactly', () => {
  const listing = 'PLUGIN  STATUS  VERSION  SOURCE\nmaxgfr@maxgfr-skills  installed, enabled  2.0.0  /tmp/plugin'
  assert.equal(installedPluginMatches(listing, '2.0.0'), true)
  assert.equal(installedPluginMatches(listing, '1.3.3'), false)
  assert.equal(installedPluginMatches(listing.replace('2.0.0', '2.0.01'), '2.0.0'), false)
  assert.equal(installedPluginMatches(listing.replace('enabled', 'disabled'), '2.0.0'), false)
  assert.equal(installedPluginMatches(listing.replace('maxgfr@', 'other@'), '2.0.0'), false)
})

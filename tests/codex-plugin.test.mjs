import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from '../scripts/validate-skills.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the Codex plugin exposes the public skills and uses the default hook location', () => {
  const manifestPath = join(root, '.codex-plugin', 'plugin.json')
  assert.ok(existsSync(manifestPath), 'missing .codex-plugin/plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.name, 'maxgfr')
  assert.equal(manifest.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  assert.equal(manifest.skills, './skills/')
  assert.equal('hooks' in manifest, false, 'current Codex ingestion rejects a manifest hooks field')
  assert.ok(existsSync(join(root, 'hooks', 'hooks.json')), 'default hooks/hooks.json is missing')
})

test('the repo marketplace points at this plugin root with explicit policy', () => {
  const marketplace = JSON.parse(readFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'))
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'maxgfr')
  assert.ok(entry)
  assert.deepEqual(entry.source, { source: 'local', path: './' })
  assert.deepEqual(entry.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' })
  assert.equal(entry.category, 'Developer Tools')
})

test('repository validation includes Codex manifests and marketplace metadata', () => {
  assert.deepEqual(validate(root).problems, [])
})

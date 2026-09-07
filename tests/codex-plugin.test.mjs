import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from '../scripts/validate-skills.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the Codex plugin exposes explicit-only public skills and registers no hooks', () => {
  const manifestPath = join(root, '.codex-plugin', 'plugin.json')
  assert.ok(existsSync(manifestPath), 'missing .codex-plugin/plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.name, 'maxgfr')
  assert.equal(manifest.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  assert.equal(manifest.skills, './skills/')
  assert.equal('hooks' in manifest, false, 'current Codex ingestion rejects a manifest hooks field')
  assert.deepEqual(manifest.interface.defaultPrompt, [
    'Use $blueprint to plan this repository change before coding.',
    'Use $build to implement the approved plan.',
    "Use $verify to run the repository's verification gates.",
  ])
  const hooks = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8'))
  assert.deepEqual(hooks.hooks, {})
  for (const skill of ['blueprint', 'build', 'verify']) {
    const skillMd = readFileSync(join(root, 'skills', skill, 'SKILL.md'), 'utf8')
    const metadata = readFileSync(join(root, 'skills', skill, 'agents', 'openai.yaml'), 'utf8')
    assert.match(skillMd, /^disable-model-invocation:\s*true$/m)
    assert.match(metadata, /^interface:$/m)
    assert.match(metadata, /^\s{2}display_name:\s*"[^"]+"$/m)
    assert.match(metadata, /^\s{2}short_description:\s*".{25,64}"$/m)
    assert.match(metadata, /^\s{2}allow_implicit_invocation:\s*false$/m)
    assert.ok(metadata.includes(`$${skill}`), `${skill} does not advertise its explicit invocation`)
  }
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

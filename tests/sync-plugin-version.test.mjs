import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const SCRIPT = join(root, 'scripts', 'sync-plugin-version.mjs')
const PKG = join(root, 'package.json')
const PLUGIN = join(root, '.claude-plugin', 'plugin.json')

function run(args = []) {
  try {
    return { exitCode: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }) }
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

// The script writes the repo's own manifests, so every test that exercises the
// write path restores them — a failed assertion must not leave the tree bumped.
function withRestoredManifests(fn) {
  const pkg = readFileSync(PKG, 'utf8')
  const plugin = readFileSync(PLUGIN, 'utf8')
  try {
    fn()
  } finally {
    writeFileSync(PKG, pkg)
    writeFileSync(PLUGIN, plugin)
  }
}

test('--check passes when the two manifests agree', () => {
  const r = run(['--check'])
  assert.equal(r.exitCode, 0, r.stderr)
})

test('--set writes the same version to both manifests', () => {
  withRestoredManifests(() => {
    const r = run(['--set', '9.9.9'])
    assert.equal(r.exitCode, 0)
    assert.equal(JSON.parse(readFileSync(PKG, 'utf8')).version, '9.9.9')
    assert.equal(JSON.parse(readFileSync(PLUGIN, 'utf8')).version, '9.9.9')
  })
})

test('--set accepts a prerelease and rejects anything that is not semver', () => {
  withRestoredManifests(() => {
    assert.equal(run(['--set', '2.0.0-beta.1']).exitCode, 0)
    assert.equal(JSON.parse(readFileSync(PLUGIN, 'utf8')).version, '2.0.0-beta.1')
  })
  // semantic-release interpolates the version into this command. A missing or
  // malformed value must fail the release, not write "undefined" into the
  // manifest a user installs.
  const bad = run(['--set', 'nonsense'])
  assert.equal(bad.exitCode, 1)
  assert.match(bad.stderr, /semver/)
  assert.equal(run(['--set']).exitCode, 1)
})

test('--set leaves the rest of the manifest untouched', () => {
  withRestoredManifests(() => {
    const before = JSON.parse(readFileSync(PLUGIN, 'utf8'))
    run(['--set', '3.1.4'])
    const after = JSON.parse(readFileSync(PLUGIN, 'utf8'))
    assert.deepEqual(Object.keys(after), Object.keys(before), 'key order and set must survive')
    assert.deepEqual(after.skills, before.skills)
    assert.equal(after.name, before.name)
  })
})

test('--check fails loudly when the manifests drift apart', () => {
  withRestoredManifests(() => {
    run(['--set', '5.0.0'])
    writeFileSync(PKG, readFileSync(PKG, 'utf8').replace('"5.0.0"', '"5.1.0"'))
    const r = run(['--check'])
    assert.equal(r.exitCode, 1)
    assert.match(r.stderr, /5\.0\.0.*5\.1\.0|5\.1\.0.*5\.0\.0/s)
  })
})

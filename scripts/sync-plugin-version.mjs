#!/usr/bin/env node
// sync-plugin-version.mjs — both host manifests carry the version a user
// installs, so neither may drift from package.json.
//
// semantic-release owns the number and hands it over during `prepare`; this
// script is what writes it in both places.
//
//   node scripts/sync-plugin-version.mjs --set 1.2.0  # write both manifests
//   node scripts/sync-plugin-version.mjs --check      # verify, exit 1 on drift
//   node scripts/sync-plugin-version.mjs              # copy package.json → plugin.json

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const check = args.includes('--check')

const setIndex = args.indexOf('--set')
const requested = setIndex >= 0 ? args[setIndex + 1] : null

if (setIndex >= 0 && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested ?? '')) {
  console.error(`--set needs a semver version, got ${JSON.stringify(requested)}`)
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pluginPaths = [
  join(root, '.claude-plugin', 'plugin.json'),
  join(root, '.codex-plugin', 'plugin.json'),
]

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const plugins = pluginPaths.map((path) => ({ path, data: JSON.parse(readFileSync(path, 'utf8')) }))

// Rewriting the parsed object would reorder or drop anything the file carries
// that we do not model. Only the version line is replaced.
function writeVersion(path, raw, version) {
  const next = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
  if (next === raw) {
    console.error(`${path} has no "version" field to update.`)
    process.exit(1)
  }
  writeFileSync(path, next)
}

if (requested) {
  writeVersion(pkgPath, readFileSync(pkgPath, 'utf8'), requested)
  for (const { path } of plugins) writeVersion(path, readFileSync(path, 'utf8'), requested)
  console.log(`package.json and ${plugins.length} plugin manifests → ${requested}`)
  process.exit(0)
}

const drift = plugins.filter(({ data }) => data.version !== pkg.version)
if (!drift.length) {
  console.log(`plugin manifests already at ${pkg.version}`)
  process.exit(0)
}

if (check) {
  for (const { path, data } of drift)
    console.error(`${path} is at ${data.version} but package.json is at ${pkg.version}.`)
  console.error('Run: node scripts/sync-plugin-version.mjs')
  process.exit(1)
}

for (const { path } of drift) writeVersion(path, readFileSync(path, 'utf8'), pkg.version)
console.log(`${drift.length} plugin manifest(s) → ${pkg.version}`)

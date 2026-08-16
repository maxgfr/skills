#!/usr/bin/env node
// sync-plugin-version.mjs — .claude-plugin/plugin.json carries the version a
// user actually installs, so it must never drift from package.json.
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
const pluginPath = join(root, '.claude-plugin', 'plugin.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'))

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
  writeVersion(pluginPath, readFileSync(pluginPath, 'utf8'), requested)
  console.log(`package.json and plugin.json → ${requested}`)
  process.exit(0)
}

if (plugin.version === pkg.version) {
  console.log(`plugin.json already at ${pkg.version}`)
  process.exit(0)
}

if (check) {
  console.error(
    `plugin.json is at ${plugin.version} but package.json is at ${pkg.version}. Run: node scripts/sync-plugin-version.mjs`,
  )
  process.exit(1)
}

writeVersion(pluginPath, readFileSync(pluginPath, 'utf8'), pkg.version)
console.log(`plugin.json → ${pkg.version}`)

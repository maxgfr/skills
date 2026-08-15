#!/usr/bin/env node
// sync-plugin-version.mjs — keep .claude-plugin/plugin.json's version in step
// with package.json, which changesets owns.
//
//   node scripts/sync-plugin-version.mjs          # write
//   node scripts/sync-plugin-version.mjs --check  # verify, exit 1 on drift

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pluginPath = join(root, '.claude-plugin', 'plugin.json')
const raw = readFileSync(pluginPath, 'utf8')
const plugin = JSON.parse(raw)

if (plugin.version === pkg.version) {
  console.log(`plugin.json already at ${pkg.version}`)
  process.exit(0)
}

if (check) {
  console.error(
    `plugin.json is at ${plugin.version} but package.json is at ${pkg.version}. Run: npm run version`,
  )
  process.exit(1)
}

plugin.version = pkg.version
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n')
console.log(`plugin.json → ${pkg.version}`)

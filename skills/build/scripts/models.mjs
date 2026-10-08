#!/usr/bin/env node
// models.mjs — map the three abstract tiers (small, medium, large) to the
// model names one host understands. The skills never name a model: names live
// only in models.json, read from <repo>/.agents/models.json and then
// ~/.agents/models.json. The first file that defines the host wins.
//
//   { "<host>": { "small": "…", "medium": "…", "large": "…" } }
//
// A tier that is absent, empty or "inherit" resolves to null: the session's
// own model. With no file at all every tier is null, and everything still runs.
//
// Usage: node models.mjs --cwd <repo> --host <host>
// Output: {"small":…,"medium":…,"large":…} on stdout.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TIERS = ['small', 'medium', 'large']

export function resolveModels(cwd, host, home = homedir()) {
  const out = { small: null, medium: null, large: null }
  if (!host) return out
  for (const file of [join(cwd, '.agents', 'models.json'), join(home, '.agents', 'models.json')]) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let config
    try {
      config = JSON.parse(text)
    } catch (err) {
      throw new Error(`${file} is not valid JSON: ${err.message}`)
    }
    const tiers = config && config[host]
    if (!tiers || typeof tiers !== 'object') continue
    for (const tier of TIERS) {
      const name = tiers[tier]
      out[tier] = typeof name === 'string' && name.trim() && name !== 'inherit' ? name.trim() : null
    }
    return out
  }
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write('Usage: node models.mjs --cwd <repo> --host <host>\n\nExample: node models.mjs --cwd . --host claude\n')
    process.exit(0)
  }
  const values = {}
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== '--cwd' && args[i] !== '--host') {
      process.stderr.write(`Unknown flag: ${args[i]}\n`)
      process.exit(1)
    }
    if (!args[i + 1]) {
      process.stderr.write(`${args[i]} needs a value.\n`)
      process.exit(1)
    }
    values[args[i]] = args[i + 1]
  }
  try {
    const models = resolveModels(resolve(values['--cwd'] ?? process.cwd()), values['--host'] ?? null)
    process.stdout.write(JSON.stringify(models) + '\n')
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  }
}

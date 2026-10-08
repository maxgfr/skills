#!/usr/bin/env node
// models.mjs — resolve the three abstract tiers (small, medium, large) to the
// model and effort one host understands, and which tier does which job. The
// skills never name a model: names live only in models.json, read from
// ~/.agents/models.json and then <repo>/.agents/models.json. Both are merged
// key by key, and the repo wins.
//
//   { "<host>": {
//       "small":  { "model": "…", "effort": "…" },   // or just "…" for the model
//       "medium": { "model": "…", "effort": "…" },
//       "large":  { "model": "…", "effort": "…" },
//       "attempts": ["small", "small", "medium"],     // build: tier of each try at a step
//       "review": "medium",                            // build: the reviewer's tier
//       "audit": "large",                              // verify: the auditor's tier
//       "solo": 3                                      // build: plans up to this many steps are built by the session itself
//   } }
//
// Anything absent keeps the default below. A model or effort that is absent,
// empty or "inherit" resolves to null: the session's own.
//
// Usage: node models.mjs --cwd <repo> --host <host>
// Output: the resolved object, as one line of JSON.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TIERS = ['small', 'medium', 'large']
const ROLES = { attempts: ['small', 'small', 'medium'], review: 'medium', audit: 'large', solo: 3 }

const pick = (v) => (typeof v === 'string' && v.trim() && v.trim() !== 'inherit' ? v.trim() : null)

function tier(value, where) {
  if (value === undefined || value === null || typeof value === 'string') return { model: pick(value), effort: null }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be a model name or { "model", "effort" }.`)
  for (const key of Object.keys(value))
    if (key !== 'model' && key !== 'effort') throw new Error(`${where} has an unknown key "${key}".`)
  return { model: pick(value.model), effort: pick(value.effort) }
}

function tierName(value, where) {
  if (!TIERS.includes(value)) throw new Error(`${where} must be one of ${TIERS.join(', ')}.`)
  return value
}

function read(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`)
  }
}

export function resolveTiers(cwd, host, home = homedir()) {
  const out = { small: tier(), medium: tier(), large: tier(), attempts: ROLES.attempts.slice(), review: ROLES.review, audit: ROLES.audit, solo: ROLES.solo }
  if (!host) return out
  for (const file of [join(home, '.agents', 'models.json'), join(cwd, '.agents', 'models.json')]) {
    const config = read(file)
    const entry = config && config[host]
    if (!entry) continue
    if (typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${file}: "${host}" must be an object.`)
    for (const [key, value] of Object.entries(entry)) {
      const where = `${file}: ${host}.${key}`
      if (TIERS.includes(key)) out[key] = tier(value, where)
      else if (key === 'attempts') {
        if (!Array.isArray(value) || !value.length) throw new Error(`${where} must be a non-empty list of tiers.`)
        out.attempts = value.map((t, i) => tierName(t, `${where}[${i}]`))
      } else if (key === 'review' || key === 'audit') out[key] = tierName(value, where)
      else if (key === 'solo') {
        if (!Number.isInteger(value) || value < 0) throw new Error(`${where} must be a whole number of steps (0 always delegates).`)
        out.solo = value
      }
      else throw new Error(`${where} is not a known key (${[...TIERS, ...Object.keys(ROLES)].join(', ')}).`)
    }
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
    process.stdout.write(JSON.stringify(resolveTiers(resolve(values['--cwd'] ?? process.cwd()), values['--host'] ?? null)) + '\n')
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  }
}

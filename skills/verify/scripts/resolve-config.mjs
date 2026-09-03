#!/usr/bin/env node
// Resolve verify's preset, config files and invocation flags into one concrete
// object. This is policy with a right answer, so Phase 0 runs this script rather
// than asking a model to reproduce the precedence rules.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TIER, LENS_NAMES, TIER_NAMES, resolveTier } from './tiers.mjs'

const MODEL_STAGES = ['planner', 'reporter', 'gates', 'spec', 'finders', 'judges', 'fixer']
const LANE_NAMES = ['gates', 'spec', 'defects', 'behavior', 'peer']

const BASE = {
  models: Object.fromEntries(MODEL_STAGES.map((name) => [name, 'inherit'])),
  loop: { enabled: true, max_iterations: 3, fix_severity: 'blocking' },
  gates: { extra: [], skip: [] },
  report: { dir: '.agents/verify', keep_runs: 10 },
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

export function deepMerge(base, ...layers) {
  const out = plainObject(base) ? { ...base } : base
  for (const layer of layers) {
    if (!plainObject(layer)) continue
    for (const [key, value] of Object.entries(layer)) {
      out[key] = plainObject(value) && plainObject(out[key])
        ? deepMerge(out[key], value)
        : Array.isArray(value) ? [...value] : value
    }
  }
  return out
}

export function configCandidates({ cwd = process.cwd(), host, env = process.env } = {}) {
  const repo = resolve(cwd)
  const home = env.HOME || homedir()
  const user = host === 'codex'
    ? join(env.CODEX_HOME || join(home, '.codex'), 'verify.json')
    : join(home, '.claude', 'verify.json')
  return [user, join(repo, '.claude', 'verify.json'), join(repo, '.agents', 'verify.json')]
}

function valueAfter(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function positiveInteger(raw, flag) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} requires a positive integer`)
  return value
}

function csv(raw) {
  return raw.split(',').map((part) => part.trim()).filter(Boolean)
}

function rejectUnknown(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new Error(`unknown config key ${where}${key}`)
  }
}

function expectPositive(value, where) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${where} must be a positive integer`)
}

export function validateConfig(config, where = '') {
  const prefix = where ? `${where}: ` : ''
  rejectUnknown(config, ['tier', 'models', 'effort', 'lanes', 'judges', 'loop', 'gates', 'finders', 'report', 'stop_guard'], prefix)
  if (config.tier !== undefined && !TIER_NAMES.includes(config.tier)) throw new Error(`${prefix}unknown tier ${JSON.stringify(config.tier)}`)
  if (config.stop_guard !== undefined && typeof config.stop_guard !== 'boolean') throw new Error(`${prefix}stop_guard must be boolean`)

  for (const key of ['models', 'effort']) {
    if (config[key] === undefined) continue
    if (!plainObject(config[key])) throw new Error(`${prefix}${key} must be an object`)
    rejectUnknown(config[key], MODEL_STAGES, `${prefix}${key}.`)
    for (const [stage, value] of Object.entries(config[key])) {
      if (typeof value !== 'string' || !value) throw new Error(`${prefix}${key}.${stage} must be a non-empty string`)
      if (key === 'effort' && !['low', 'medium', 'high', 'xhigh', 'max'].includes(value))
        throw new Error(`${prefix}effort.${stage} has unknown value ${JSON.stringify(value)}`)
    }
  }
  if (config.lanes !== undefined) {
    if (!plainObject(config.lanes)) throw new Error(`${prefix}lanes must be an object`)
    rejectUnknown(config.lanes, LANE_NAMES, `${prefix}lanes.`)
    for (const key of ['gates', 'spec', 'defects', 'peer'])
      if (config.lanes[key] !== undefined && typeof config.lanes[key] !== 'boolean') throw new Error(`${prefix}lanes.${key} must be boolean`)
    if (config.lanes.behavior !== undefined && !['off', 'quick', 'full'].includes(config.lanes.behavior))
      throw new Error(`${prefix}lanes.behavior expects off, quick, or full`)
  }
  if (config.judges !== undefined) {
    if (!plainObject(config.judges)) throw new Error(`${prefix}judges must be an object`)
    rejectUnknown(config.judges, ['panel', 'panel_blocking'], `${prefix}judges.`)
    for (const [key, value] of Object.entries(config.judges)) expectPositive(value, `${prefix}judges.${key}`)
  }
  if (config.loop !== undefined) {
    if (!plainObject(config.loop)) throw new Error(`${prefix}loop must be an object`)
    rejectUnknown(config.loop, ['enabled', 'max_iterations', 'fix_severity'], `${prefix}loop.`)
    if (config.loop.enabled !== undefined && typeof config.loop.enabled !== 'boolean') throw new Error(`${prefix}loop.enabled must be boolean`)
    if (config.loop.max_iterations !== undefined) expectPositive(config.loop.max_iterations, `${prefix}loop.max_iterations`)
    if (config.loop.fix_severity !== undefined && !['blocking', 'major', 'all'].includes(config.loop.fix_severity))
      throw new Error(`${prefix}loop.fix_severity expects blocking, major, or all`)
  }
  for (const key of ['gates', 'report']) {
    if (config[key] !== undefined && !plainObject(config[key])) throw new Error(`${prefix}${key} must be an object`)
  }
  if (config.gates) {
    rejectUnknown(config.gates, ['extra', 'skip'], `${prefix}gates.`)
    for (const key of ['extra', 'skip'])
      if (config.gates[key] !== undefined && (!Array.isArray(config.gates[key]) || !config.gates[key].every((value) => typeof value === 'string')))
        throw new Error(`${prefix}gates.${key} must be an array of strings`)
  }
  if (config.report) {
    rejectUnknown(config.report, ['dir', 'keep_runs'], `${prefix}report.`)
    if (config.report.dir !== undefined && (typeof config.report.dir !== 'string' || !config.report.dir)) throw new Error(`${prefix}report.dir must be a non-empty string`)
    if (config.report.keep_runs !== undefined) expectPositive(config.report.keep_runs, `${prefix}report.keep_runs`)
  }
  if (config.finders !== undefined) {
    if (!Array.isArray(config.finders) || !config.finders.length) throw new Error(`${prefix}finders must be a non-empty array`)
    const invalid = config.finders.filter((name) => !LENS_NAMES.includes(name))
    if (invalid.length) throw new Error(`${prefix}unknown lenses: ${invalid.join(', ')}`)
  }
  return config
}

export function parseInvocation(argv = []) {
  let tier = null
  let mode = 'loop'
  let ref = null
  let onlyLanes = null
  let globalModel = null
  let finderModel = null
  const overrides = {}

  const setRef = (value) => {
    if (ref !== null) throw new Error(`multiple refs provided: ${JSON.stringify(ref)} and ${JSON.stringify(value)}`)
    ref = value
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      if (TIER_NAMES.includes(arg)) {
        if (tier && tier !== arg) throw new Error(`multiple tiers provided: ${tier} and ${arg}`)
        tier = arg
      } else if (arg === 'report') {
        mode = 'report'
      } else if (arg === 'crosscheck') {
        overrides.lanes = deepMerge(overrides.lanes || {}, { peer: true })
      } else {
        setRef(arg)
      }
      continue
    }

    const known = ['--ref', '--behavior', '--panel', '--finders', '--model', '--max-iterations', '--skip', '--lanes', '--lenses']
    if (!known.includes(arg)) throw new Error(`unknown flag ${arg}`)
    const raw = valueAfter(argv, i, arg)
    i += 1
    if (arg === '--ref') setRef(raw)
    else if (arg === '--behavior') {
      if (!['off', 'quick', 'full'].includes(raw)) throw new Error('--behavior expects off, quick, or full')
      overrides.lanes = deepMerge(overrides.lanes || {}, { behavior: raw })
    } else if (arg === '--panel') {
      overrides.judges = deepMerge(overrides.judges || {}, { panel_blocking: positiveInteger(raw, arg) })
    } else if (arg === '--finders') finderModel = raw
    else if (arg === '--model') globalModel = raw
    else if (arg === '--max-iterations') {
      overrides.loop = deepMerge(overrides.loop || {}, { max_iterations: positiveInteger(raw, arg) })
    } else if (arg === '--skip') overrides.gates = deepMerge(overrides.gates || {}, { skip: csv(raw) })
    else if (arg === '--lanes') {
      onlyLanes = csv(raw)
      const invalid = onlyLanes.filter((name) => !LANE_NAMES.includes(name))
      if (invalid.length) throw new Error(`unknown lanes: ${invalid.join(', ')}`)
    } else if (arg === '--lenses') {
      overrides.finders = csv(raw)
      const invalid = overrides.finders.filter((name) => !LENS_NAMES.includes(name))
      if (invalid.length) throw new Error(`unknown lenses: ${invalid.join(', ')}`)
    }
  }

  if (globalModel) overrides.models = Object.fromEntries(MODEL_STAGES.map((name) => [name, globalModel]))
  if (finderModel) overrides.models = deepMerge(overrides.models || {}, { finders: finderModel })
  return { tier, mode, ref, overrides, onlyLanes }
}

function readConfig(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!plainObject(value)) throw new Error('top level must be an object')
    return validateConfig(value, path)
  } catch (error) {
    throw new Error(`invalid JSON config ${path}: ${error.message}`)
  }
}

function explicitConfigPath(cwd, env) {
  if (!env.VERIFY_CONFIG) return null
  return isAbsolute(env.VERIFY_CONFIG) ? env.VERIFY_CONFIG : resolve(cwd, env.VERIFY_CONFIG)
}

export function resolveConfig({ cwd = process.cwd(), host, env = process.env, argv = [] } = {}) {
  if (host && !['codex', 'claude'].includes(host)) throw new Error('host must be codex or claude')
  const invocation = parseInvocation(argv)
  const files = []
  const explicit = explicitConfigPath(cwd, env)
  if (explicit) files.push(explicit)
  files.push(...configCandidates({ cwd, host, env }))

  const layers = []
  const sources = []
  for (const file of files) {
    if (!existsSync(file)) continue
    layers.push(readConfig(file))
    sources.push(file)
  }

  const configuredTier = layers.reduce((value, layer) => layer.tier || value, DEFAULT_TIER)
  const tier = invocation.tier || configuredTier
  if (!TIER_NAMES.includes(tier)) throw new Error(`unknown tier ${JSON.stringify(tier)} — expected one of ${TIER_NAMES.join(', ')}`)

  let config = deepMerge(BASE, resolveTier(tier), ...layers, invocation.overrides, { tier })
  if (invocation.onlyLanes) {
    const selected = new Set(invocation.onlyLanes)
    config.lanes = {
      gates: selected.has('gates'),
      spec: selected.has('spec'),
      defects: selected.has('defects'),
      behavior: selected.has('behavior') ? (config.lanes.behavior === 'off' ? 'quick' : config.lanes.behavior) : 'off',
      peer: selected.has('peer'),
    }
  }
  if (invocation.mode === 'report') config = deepMerge(config, { loop: { enabled: false } })
  validateConfig(config, 'resolved config')

  return { tier, mode: invocation.mode, ref: invocation.ref, config, sources }
}

function help() {
  return `Usage: node resolve-config.mjs [--cwd PATH] [--host codex|claude] [--] [tier|report|crosscheck|ref] [--ref REF] [--behavior MODE] [--panel N] [--finders MODEL] [--model MODEL] [--max-iterations N] [--skip LIST] [--lanes LIST] [--lenses LIST]\n\nResolves tier defaults, config files, and invocation flags as JSON.\n\nExample: node resolve-config.mjs --cwd . --host codex -- deep crosscheck --ref main\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = process.argv.slice(2)
  if (raw.includes('--help')) {
    process.stdout.write(help())
    process.exit(0)
  }
  let cwd = process.cwd()
  let host = null
  const split = raw.indexOf('--')
  const outer = split === -1 ? raw : raw.slice(0, split)
  const invocation = split === -1 ? [] : raw.slice(split + 1)
  for (let i = 0; i < outer.length; i += 1) {
    if (outer[i] === '--cwd' || outer[i] === '--host') {
      if (!outer[i + 1]) throw new Error(`${outer[i]} requires a value`)
      if (outer[i] === '--cwd') cwd = outer[++i]
      else host = outer[++i]
    } else invocation.push(outer[i])
  }
  try {
    process.stdout.write(JSON.stringify(resolveConfig({ cwd, host, argv: invocation }), null, 2) + '\n')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}

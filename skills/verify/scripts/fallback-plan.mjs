#!/usr/bin/env node
// Expand verify's resolved config into a deterministic native-agent schedule.
// It does not pretend to dispatch agents; it gives capable hosts an executable
// adapter whose JSON says exactly which jobs are parallel and where barriers sit.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from './resolve-config.mjs'

export function fallbackPlan({ cwd = process.cwd(), host, argv = [] } = {}) {
  const resolved = resolveConfig({ cwd, host, argv })
  const { config } = resolved
  const jobs = []
  if (config.lanes.gates) jobs.push({ id: 'lane:gates', lane: 'gates', brief: 'Run every resolved gate and return command, exit code, and first failing lines.' })
  if (config.lanes.spec) jobs.push({ id: 'lane:spec', lane: 'spec', brief: 'Read references/lanes.md and check every matrix requirement against the delta.' })
  if (config.lanes.defects) {
    for (const lens of config.finders) jobs.push({ id: `lane:defects:${lens}`, lane: 'defects', lens, brief: `Run the ${lens} defect lens from references/lanes.md.` })
  }
  if (config.lanes.behavior !== 'off') jobs.push({ id: 'lane:behavior', lane: 'behavior', mode: config.lanes.behavior, brief: `Prove behavior in ${config.lanes.behavior} mode in an isolated worktree.` })
  if (config.lanes.peer) jobs.push({ id: 'lane:peer', lane: 'peer', brief: `Run peer-run.mjs with --host ${host || 'unresolved'} and treat its claims as candidates.` })

  const needsMatrix = config.lanes.spec || config.lanes.defects || config.lanes.behavior !== 'off'
  return {
    ok: true,
    host: host || null,
    tier: resolved.tier,
    mode: resolved.mode,
    ref: resolved.ref,
    config,
    sources: resolved.sources,
    phases: [
      { id: 'matrix', enabled: needsMatrix, parallel: false, jobs: needsMatrix ? [{ id: 'matrix:plan', role: 'planner', brief: 'Build the verification matrix exactly as references/matrix.md specifies.' }] : [] },
      { id: 'lanes', enabled: jobs.length > 0, parallel: true, after: needsMatrix ? ['matrix'] : [], jobs },
      {
        id: 'dedupe',
        enabled: config.lanes.defects || config.lanes.spec || config.lanes.behavior !== 'off' || config.lanes.peer,
        parallel: false,
        after: ['lanes'],
        reducer: {
          operation: 'merge-nearby-location',
          line_tolerance: 3,
          keep_severity: 'highest',
          merge_found_by: true,
          machine_truth: 'exempt',
        },
      },
      {
        id: 'judging',
        enabled: config.lanes.defects || config.lanes.spec || config.lanes.peer,
        parallel: true,
        after: ['dedupe'],
        reducer: {
          operation: 'majority-of-requested',
          panel: config.judges.panel,
          panel_blocking: config.judges.panel_blocking,
          threshold: 'ceil(requested_panel / 2)',
        },
      },
      { id: 'verdict', enabled: true, parallel: false, after: ['judging'], brief: 'Aggregate only executed evidence and surviving findings.' },
      { id: 'fix-loop', enabled: config.loop.enabled, parallel: false, after: ['verdict'], max_iterations: config.loop.max_iterations, guard: 'scripts/forbidden-repairs.mjs' },
    ],
  }
}

function cli(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node fallback-plan.mjs [--cwd REPO] [--host codex|claude] [--pretty] [--] [verify arguments]\n\nExample: node fallback-plan.mjs --cwd . --host codex --pretty -- deep crosscheck\n')
    return 0
  }
  const split = argv.indexOf('--')
  const outer = split === -1 ? argv : argv.slice(0, split)
  const invocation = split === -1 ? [] : argv.slice(split + 1)
  let cwd = process.cwd()
  let host = null
  let pretty = false
  for (let i = 0; i < outer.length; i += 1) {
    if (outer[i] === '--pretty') {
      pretty = true
      continue
    }
    if (!['--cwd', '--host'].includes(outer[i])) throw new Error(`Unknown flag: ${outer[i]}`)
    if (!outer[i + 1]) throw new Error(`${outer[i]} needs a value.`)
    if (outer[i] === '--cwd') cwd = outer[++i]
    else host = outer[++i]
  }
  if (host && !['codex', 'claude'].includes(host)) throw new Error('--host must be codex or claude.')
  process.stdout.write(JSON.stringify(fallbackPlan({ cwd, host, argv: invocation }), null, pretty ? 2 : 0) + '\n')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = cli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

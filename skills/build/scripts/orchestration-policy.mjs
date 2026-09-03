#!/usr/bin/env node
// One serialized decision contract for Workflow and native-subagent builds.
// Both execution paths consume this output instead of rephrasing acceptance,
// retry, dependency, or concurrency rules in host-specific prose.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function buildPolicy({ mode = 'workflow', maxAttempts = 2 } = {}) {
  if (!['workflow', 'peer'].includes(mode)) throw new Error('mode must be workflow or peer.')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer.')
  return {
    mode,
    parallel: mode !== 'peer',
    max_attempts: mode === 'peer' ? 1 : maxAttempts,
    on_dependency_not_done: 'skip',
    acceptance: {
      implementer_exit: 0,
      reviewer_exit: 0,
      reviewer_spec: true,
      reviewer_quality: true,
      guard_verdict: 'CLEAN',
    },
  }
}

function cli(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node orchestration-policy.mjs [--mode workflow|peer] [--max-attempts N] [--pretty]\n\nExample: node orchestration-policy.mjs --mode workflow --max-attempts 2 --pretty\n')
    return 0
  }
  let mode = 'workflow'
  let maxAttempts = 2
  let pretty = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pretty') {
      pretty = true
      continue
    }
    if (!['--mode', '--max-attempts'].includes(argv[i])) throw new Error(`Unknown flag: ${argv[i]}`)
    if (!argv[i + 1]) throw new Error(`${argv[i]} needs a value.`)
    if (argv[i] === '--mode') mode = argv[++i]
    else maxAttempts = Number(argv[++i])
  }
  process.stdout.write(JSON.stringify(buildPolicy({ mode, maxAttempts }), null, pretty ? 2 : 0) + '\n')
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

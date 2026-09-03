#!/usr/bin/env node
// Translate an approved build plan into host-neutral native-agent dispatches.
// The host performs the calls; this adapter makes their ordering and barriers
// explicit so the fallback does not depend on a model reconstructing a workflow.

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { schedule } from './plan-steps.mjs'
import { buildPolicy } from './orchestration-policy.mjs'

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function fallbackPlan({ cwd = process.cwd(), plan, host, namespace, mode = 'workflow', maxAttempts = 2, runDir } = {}) {
  if (mode === 'peer' && !host) throw new Error('--host is required in peer mode; do not guess the active host.')
  const parsed = schedule(resolve(cwd), plan)
  if (!parsed.ok) return parsed
  const policy = buildPolicy({ mode, maxAttempts })
  const resolvedRunDir = resolve(cwd, runDir || '.agents/build/run')
  const byId = new Map(parsed.steps.map((step) => [step.id, step]))
  const waves = parsed.waves.map((ids, index) => ({
    id: `wave-${index + 1}`,
    parallel: policy.parallel && ids.length > 1,
    steps: ids,
    jobs: ids.flatMap((id) => {
      const step = byId.get(id)
      return [
        {
          id: `${id}:implement`,
          role: mode === 'peer' ? 'peer-implementer' : 'implementer',
          step: id,
          ...(mode === 'peer'
            ? {
                command: {
                  executable: process.execPath,
                  argv: [join(skillDir, 'scripts/peer-build.mjs'), '--host', host || 'unresolved', '--cwd', resolve(cwd), '--plan', parsed.planPath, '--step', id, '--out', join(resolvedRunDir, 'peer', id)],
                },
                brief: 'Run this command once. Its structured output is a claim; the reviewer and guard remain authoritative.',
              }
            : { brief: `Read references/briefs.md and implement ${id} from ${parsed.planPath}. Touch only its named files; run ${step.verifyCmd}.` }),
        },
        {
          id: `${id}:review`,
          role: 'reviewer',
          step: id,
          after: `${id}:implement`,
          brief: `Review ${id} against its exact plan block and run ${step.verifyCmd}. Return pass or concrete defects.`,
        },
      ]
    }),
    barrier: {
      role: 'forbidden-repairs',
      command: `node scripts/forbidden-repairs.mjs --since <wave-baseline> --plan ${parsed.planPath} --pretty`,
      pass: 'exit 0 and verdict CLEAN',
    },
  }))
  const invocation = host === 'codex'
    ? `$verify ${parsed.planPath}`
    : host === 'claude'
      ? `/${namespace ? `${namespace}:` : ''}verify ${parsed.planPath}`
      : `invoke the verify skill ${parsed.planPath}`
  return {
    ok: true,
    host: host || null,
    mode,
    policy,
    planPath: parsed.planPath,
    waves,
    terminal: {
      role: 'verification',
      after: waves.map((wave) => wave.id),
      invocation,
    },
  }
}

function cli(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node fallback-plan.mjs [--cwd REPO] [--plan FILE] [--host codex|claude] [--namespace NAME] [--mode workflow|peer] [--max-attempts N] [--run-dir DIR] [--pretty]\n\nExample: node fallback-plan.mjs --cwd . --host codex --mode workflow --max-attempts 2 --run-dir .agents/build/run --pretty\n')
    return 0
  }
  const allowed = new Set(['--cwd', '--plan', '--host', '--namespace', '--mode', '--max-attempts', '--run-dir'])
  const options = {}
  let pretty = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pretty') {
      pretty = true
      continue
    }
    if (!allowed.has(argv[i])) throw new Error(`Unknown flag: ${argv[i]}`)
    if (!argv[i + 1]) throw new Error(`${argv[i]} needs a value.`)
    const key = { '--cwd': 'cwd', '--plan': 'plan', '--host': 'host', '--namespace': 'namespace', '--mode': 'mode', '--max-attempts': 'maxAttempts', '--run-dir': 'runDir' }[argv[i]]
    options[key] = key === 'maxAttempts' ? Number(argv[++i]) : argv[++i]
  }
  if (options.host && !['codex', 'claude'].includes(options.host)) throw new Error('--host must be codex or claude.')
  const out = fallbackPlan(options)
  process.stdout.write(JSON.stringify(out, null, pretty ? 2 : 0) + '\n')
  return out.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = cli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

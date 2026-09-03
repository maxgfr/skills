import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = [
  'skills/verify/scripts/detect-gates.mjs',
  'skills/verify/scripts/forbidden-repairs.mjs',
  'skills/build/scripts/plan-steps.mjs',
  'skills/blueprint/scripts/peer-run.mjs',
  'skills/build/scripts/peer-run.mjs',
  'skills/verify/scripts/peer-run.mjs',
  'skills/build/scripts/peer-build.mjs',
]

const helpContracts = [
  ['skills/verify/scripts/detect-gates.mjs', ['--cwd', '--pretty']],
  ['skills/verify/scripts/forbidden-repairs.mjs', ['--since', '--patch', '--plan', '--allow', '--include-untracked', '--pretty']],
  ['skills/build/scripts/plan-steps.mjs', ['--cwd', '--plan', '--pretty']],
  ['skills/blueprint/scripts/peer-run.mjs', ['--host', '--mode', '--cwd', '--prompt', '--schema', '--out', '--model', '--timeout-ms']],
  ['skills/build/scripts/peer-run.mjs', ['--host', '--mode', '--cwd', '--prompt', '--schema', '--out', '--model', '--timeout-ms']],
  ['skills/verify/scripts/peer-run.mjs', ['--host', '--mode', '--cwd', '--prompt', '--schema', '--out', '--model', '--timeout-ms']],
  ['skills/build/scripts/peer-build.mjs', ['--host', '--cwd', '--plan', '--step', '--out', '--model', '--timeout-ms']],
  ['skills/verify/scripts/resolve-config.mjs', ['--cwd', '--host', '--ref', '--behavior', '--panel', '--finders', '--model', '--max-iterations', '--skip', '--lanes', '--lenses']],
  ['skills/build/scripts/fallback-plan.mjs', ['--cwd', '--plan', '--host', '--namespace', '--mode', '--max-attempts', '--run-dir', '--pretty']],
  ['skills/build/scripts/orchestration-policy.mjs', ['--mode', '--max-attempts', '--pretty']],
  ['skills/verify/scripts/fallback-plan.mjs', ['--cwd', '--host', '--pretty']],
  ['scripts/doctor.mjs', ['--host', '--root', '--json']],
  ['scripts/e2e-hosts.mjs', ['--json', '--live']],
]

for (const [rel, flags] of helpContracts) {
  test(`${rel} help lists every flag and a runnable example`, () => {
    const run = spawnSync(process.execPath, [join(root, rel), '--help'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    for (const flag of flags) assert.match(run.stdout, new RegExp(flag.replace('-', '\\-')), `missing ${flag}`)
    assert.match(run.stdout, /Example:/)
  })
}

for (const rel of scripts) {
  test(`${rel} has a side-effect-free help contract`, () => {
    const run = spawnSync(process.execPath, [join(root, rel), '--help'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^Usage:/)
    assert.equal(run.stderr, '')
  })

  test(`${rel} rejects unknown flags`, () => {
    const run = spawnSync(process.execPath, [join(root, rel), '--definitely-unknown'], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /unknown flag/i)
  })
}

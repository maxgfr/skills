import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs as parsePeerArgs } from '../skills/build/scripts/peer-build.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(root, 'skills/build/scripts/fallback-plan.mjs')
const VERIFY = join(root, 'skills/verify/scripts/fallback-plan.mjs')
const POLICY = join(root, 'skills/build/scripts/orchestration-policy.mjs')

function repoWithPlan() {
  const repo = mkdtempSync(join(tmpdir(), 'fallback-plan-'))
  mkdirSync(join(repo, 'docs', 'plans'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'plans', 'x.md'), `---
status: approved
---
## Goal
Ship it.
## Execution order
S-001, S-002
## Steps
### S-001 — First
- **Files:** \`src/a.js\`
- **Depends on:** none
- **Change:** A
- **Verify:** \`node --check src/a.js\` → exit 0
### S-002 — Second
- **Files:** \`src/b.js\`
- **Depends on:** S-001
- **Change:** B
- **Verify:** \`node --check src/b.js\` → exit 0
`)
  return repo
}

test('build fallback turns the approved plan into ordered native-agent dispatches', () => {
  const repo = repoWithPlan()
  try {
    const out = JSON.parse(execFileSync(process.execPath, [BUILD, '--cwd', repo, '--host', 'codex'], { encoding: 'utf8' }))
    assert.equal(out.ok, true)
    assert.equal(out.host, 'codex')
    assert.deepEqual(out.waves.map((wave) => wave.steps), [['S-001'], ['S-002']])
    assert.deepEqual(out.waves[0].jobs.map((job) => job.role), ['implementer', 'reviewer'])
    assert.equal(out.waves[0].barrier.role, 'forbidden-repairs')
    assert.deepEqual(out.policy.acceptance, {
      implementer_exit: 0,
      reviewer_exit: 0,
      reviewer_spec: true,
      reviewer_quality: true,
      guard_verdict: 'CLEAN',
    })
    assert.equal(out.terminal.invocation, '$verify docs/plans/x.md')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('build fallback represents peer mode as serial, one-attempt peer dispatches', () => {
  const repo = repoWithPlan()
  try {
    const out = JSON.parse(execFileSync(process.execPath, [BUILD, '--cwd', repo, '--host', 'codex', '--mode', 'peer'], { encoding: 'utf8' }))
    assert.equal(out.mode, 'peer')
    assert.equal(out.policy.max_attempts, 1)
    assert.equal(out.waves[0].parallel, false)
    assert.deepEqual(out.waves[0].jobs.map((job) => job.role), ['peer-implementer', 'reviewer'])
    const peerArgv = out.waves[0].jobs[0].command.argv
    assert.match(peerArgv.join(' '), /peer-build\.mjs/)
    assert.equal(peerArgv[peerArgv.indexOf('--out') + 1], join(repo, '.agents/build/run/peer/S-001'))
    assert.equal(parsePeerArgs(peerArgv.slice(1)).out, join(repo, '.agents/build/run/peer/S-001'))
    assert.equal(out.policy.on_dependency_not_done, 'skip')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('peer fallback refuses to guess the active host', () => {
  const repo = repoWithPlan()
  try {
    const run = spawnSync(process.execPath, [BUILD, '--cwd', repo, '--mode', 'peer'], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /host.*required/i)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('verify fallback expands resolved lanes into a deterministic parallel dispatch plan', () => {
  const repo = mkdtempSync(join(tmpdir(), 'fallback-verify-'))
  try {
    const out = JSON.parse(execFileSync(process.execPath, [VERIFY, '--cwd', repo, '--host', 'codex', '--', 'deep', 'crosscheck'], { encoding: 'utf8' }))
    assert.equal(out.ok, true)
    assert.equal(out.tier, 'deep')
    assert.deepEqual(out.phases.map((phase) => phase.id), ['matrix', 'lanes', 'dedupe', 'judging', 'verdict', 'fix-loop'])
    assert.equal(out.phases[1].parallel, true)
    assert.equal(out.phases[1].jobs.filter((job) => job.lane === 'defects').length, 6)
    assert.ok(out.phases[1].jobs.some((job) => job.lane === 'peer'))
    assert.deepEqual(out.phases[2].reducer, {
      operation: 'merge-nearby-location',
      line_tolerance: 3,
      keep_severity: 'highest',
      merge_found_by: true,
      machine_truth: 'exempt',
    })
    assert.deepEqual(out.phases[3].reducer, {
      operation: 'majority-of-requested',
      panel: 1,
      panel_blocking: 3,
      threshold: 'ceil(requested_panel / 2)',
    })
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

for (const script of [BUILD, VERIFY]) {
  test(`${script.split('/').slice(-3).join('/')} supports help and rejects unknown adapter flags`, () => {
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
    assert.equal(help.status, 0)
    assert.match(help.stdout, /^Usage:/)
    const bad = spawnSync(process.execPath, [script, '--adapter-nope'], { encoding: 'utf8' })
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /unknown flag/i)
  })
}

test('the build policy is the same serialized contract consumed by every adapter', () => {
  const workflow = JSON.parse(execFileSync(process.execPath, [POLICY, '--mode', 'workflow', '--max-attempts', '4'], { encoding: 'utf8' }))
  const peer = JSON.parse(execFileSync(process.execPath, [POLICY, '--mode', 'peer', '--max-attempts', '4'], { encoding: 'utf8' }))
  assert.equal(workflow.max_attempts, 4)
  assert.equal(workflow.parallel, true)
  assert.equal(peer.max_attempts, 1)
  assert.equal(peer.parallel, false)
  assert.deepEqual(peer.acceptance, workflow.acceptance)
})

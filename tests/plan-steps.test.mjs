// plan-steps.mjs decides which plan is built, in what order, and what can run
// side by side. Each of those has a right answer; these pin them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePlan, waves, findPlan, schedule } from '../skills/build/scripts/plan-steps.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const SCRIPT = join(root, 'skills', 'build', 'scripts', 'plan-steps.mjs')
const FIXTURES = join(here, 'fixtures', 'plans')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

function cli(cwd, ...extra) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--cwd', cwd, ...extra], { encoding: 'utf8', stdio: 'pipe' })
    return { exitCode: 0, ...JSON.parse(stdout) }
  } catch (err) {
    return { exitCode: err.status, ...JSON.parse(err.stdout) }
  }
}

test('parsePlan reads the status, the goal, the order and every step field', () => {
  const plan = parsePlan(fixture('approved.md'))
  assert.equal(plan.status, 'approved')
  assert.match(plan.goal, /429/)
  assert.deepEqual(plan.executionOrder, ['S-001', 'S-002', 'S-003'])
  assert.equal(plan.steps.length, 3)
  const s2 = plan.steps[1]
  assert.equal(s2.id, 'S-002')
  assert.equal(s2.title, 'Wire the middleware')
  assert.deepEqual(s2.files, ['src/limit/middleware.ts', 'src/api/router.ts'])
  assert.deepEqual(s2.dependsOn, ['S-001'])
  assert.deepEqual(s2.implements, ['Q-001'])
  assert.equal(s2.verifyCmd, 'npx vitest run tests/api/limit.test.ts')
  assert.equal(s2.verifyExpected, '2 passed')
  assert.match(s2.doneWhen, /429/)
  assert.match(s2.raw, /^### S-002/)
})

test('a line range on a Files entry does not make it a different file', () => {
  const plan = parsePlan(fixture('overlap.md'))
  assert.deepEqual(plan.steps[0].files, ['src/router.ts'])
})

test('waves layer by dependency, then split on shared files', () => {
  const plan = parsePlan(fixture('approved.md'))
  assert.deepEqual(waves(plan.steps).waves, [['S-001'], ['S-002', 'S-003']])
})

test('two steps naming the same file never share a wave, and a step naming none runs alone', () => {
  // Four steps with no dependencies. S-001 and S-002 both touch src/router.ts;
  // S-004 names no file, so it could touch anything. Only S-003 can safely
  // share a wave with one of the router steps.
  const plan = parsePlan(fixture('overlap.md'))
  const w = waves(plan.steps).waves
  const waveOf = (id) => w.findIndex((wave) => wave.includes(id))
  assert.notEqual(waveOf('S-001'), waveOf('S-002'), 'S-001 and S-002 share src/router.ts')
  assert.deepEqual(w[waveOf('S-004')], ['S-004'], 'a step with no Files: runs alone')
  assert.equal(waveOf('S-003'), waveOf('S-001'), 'S-003 shares nothing with S-001 and joins its wave')
  assert.equal(w.flat().length, 4)
})

test('a cycle and an unknown dependency are errors, not schedules', () => {
  assert.match(waves(parsePlan(fixture('cycle.md')).steps).error, /cycle/i)
  const steps = [{ id: 'S-001', files: [], dependsOn: ['S-009'] }]
  assert.match(waves(steps).error, /S-009, which is not a step/)
})

test('an unapproved plan is refused, and says why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-steps-'))
  try {
    mkdirSync(join(dir, 'docs', 'plans'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'plans', '2026-01-01-thing.md'), fixture('unapproved.md'))
    const r = cli(dir, '--plan', 'docs/plans/2026-01-01-thing.md')
    assert.equal(r.ok, false)
    assert.equal(r.exitCode, 1)
    assert.match(r.error, /awaiting-approval.*not approved/)
    // and it is never picked up by discovery either
    assert.equal(findPlan(dir, null), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a step with no Verify: command is refused before anything is built', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-steps-'))
  try {
    writeFileSync(join(dir, 'plan.md'), fixture('no-verify.md'))
    const r = schedule(dir, 'plan.md')
    assert.equal(r.ok, false)
    assert.match(r.error, /S-002 has no `Verify:` command/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('with no path given, the newest approved plan under docs/plans wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-steps-'))
  try {
    const plans = join(dir, 'docs', 'plans')
    mkdirSync(plans, { recursive: true })
    writeFileSync(join(plans, '2026-01-01-old.md'), fixture('approved.md'))
    writeFileSync(join(plans, '2026-02-01-new.md'), fixture('approved.md'))
    writeFileSync(join(plans, '2026-03-01-draft.md'), fixture('unapproved.md'))
    const old = new Date('2026-01-01T00:00:00Z')
    const recent = new Date('2026-02-01T00:00:00Z')
    const draft = new Date('2026-03-01T00:00:00Z')
    utimesSync(join(plans, '2026-01-01-old.md'), old, old)
    utimesSync(join(plans, '2026-02-01-new.md'), recent, recent)
    utimesSync(join(plans, '2026-03-01-draft.md'), draft, draft)
    const r = cli(dir)
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.planPath, 'docs/plans/2026-02-01-new.md')
    assert.deepEqual(r.waves, [['S-001'], ['S-002', 'S-003']])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no plan at all is a one-line refusal that names the fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-steps-'))
  try {
    const r = cli(dir)
    assert.equal(r.ok, false)
    assert.match(r.error, /invoke blueprint first/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

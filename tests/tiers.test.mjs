import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIERS, TIER_NAMES, DEFAULT_TIER, LENS_NAMES, resolveTier } from '../skills/verify/scripts/tiers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(resolve(here, '..'), 'skills', 'verify', 'scripts', 'tiers.mjs')

test('the default tier actually verifies the change', () => {
  // The default is the one people invoke. A default that only runs the gates
  // answers "do the commands pass", not "is this change any good" — which is
  // the question /verify is asked. It must read the diff and check the promise.
  const d = resolveTier(DEFAULT_TIER)
  assert.equal(DEFAULT_TIER, 'light', 'the token-conscious default must stay light')
  assert.equal(d.lanes.defects, true, 'the default must hunt for defects')
  assert.equal(d.lanes.spec, true, 'the default must check the change against its promise')
  assert.ok(d.finders.length >= 2, 'one lens is not a defect hunt')
  assert.notEqual(DEFAULT_TIER, 'ultralight', 'gates-only is an opt-in, never the default')
})

test('the default is still not the most expensive tier', () => {
  // It buys real verification, but the lane that starts servers and the
  // three-skeptic panel stay opt-in — that is what kept the old default at 40
  // agents.
  const d = resolveTier(DEFAULT_TIER)
  assert.equal(d.lanes.behavior, 'off')
  assert.equal(d.judges.panel_blocking, 1)
  assert.ok(d.finders.length < TIERS.deep.finders.length)
})

test('the tiers are ordered by what they actually run', () => {
  const lensCount = TIER_NAMES.map((n) => (TIERS[n].lanes.defects ? TIERS[n].finders.length : 0))
  assert.deepEqual(lensCount, [0, 3, 4, 6])
  assert.deepEqual(
    TIER_NAMES.map((n) => TIERS[n].lanes.behavior),
    ['off', 'off', 'quick', 'full'],
  )
  assert.equal(TIER_NAMES[0], 'ultralight', 'the listing order is the cost order')
})

test('ultralight runs the gates and nothing else', () => {
  const t = resolveTier('ultralight')
  assert.equal(t.lanes.gates, true, 'law 1 has no cheap variant — the gates always run')
  assert.deepEqual([t.lanes.spec, t.lanes.defects, t.lanes.behavior], [false, false, 'off'])
})

test('no tier turns the peer crosscheck on by itself', () => {
  // Lane E spends a second vendor's tokens. Every other lane may be switched on
  // by picking a tier; this one may only be switched on by asking for it, so
  // `/verify deep` can never quietly start billing an OpenAI account.
  for (const name of TIER_NAMES) {
    assert.equal(resolveTier(name).lanes.peer, false, `${name} must not enable lane E`)
  }
})

test('no tier can skip refutation — both panels floor at one', () => {
  for (const [name, t] of Object.entries(TIERS)) {
    assert.ok(t.judges.panel >= 1, `${name} panel`)
    assert.ok(t.judges.panel_blocking >= 1, `${name} panel_blocking`)
  }
})

test('every lens named by a tier exists', () => {
  for (const [name, t] of Object.entries(TIERS)) {
    for (const lens of t.finders) {
      assert.ok(LENS_NAMES.includes(lens), `${name} names an unknown lens: ${lens}`)
    }
  }
})

test('resolveTier hands back a fresh object each time', () => {
  // The caller merges config files and flags on top. A shared reference would
  // let one run's overrides leak into the next.
  const a = resolveTier('normal')
  a.lanes.spec = false
  a.finders.push('bogus')
  const b = resolveTier('normal')
  assert.equal(b.lanes.spec, true)
  assert.ok(!b.finders.includes('bogus'))
})

test('an unknown tier fails loudly instead of silently resolving to something', () => {
  assert.throws(() => resolveTier('ultra-light'), /unknown tier/)
  assert.throws(() => resolveTier('ULTRALIGHT'), /unknown tier/)
  assert.equal(resolveTier().tier, DEFAULT_TIER, 'no argument means the default')
})

test('the CLI prints one tier, every tier, and exits 1 on a bad name', () => {
  const one = JSON.parse(execFileSync(process.execPath, [SCRIPT, 'light'], { encoding: 'utf8' }))
  assert.equal(one.tier, 'light')

  const all = JSON.parse(execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }))
  assert.deepEqual(Object.keys(all), TIER_NAMES)

  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, 'nope'], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => err.status === 1,
  )
})

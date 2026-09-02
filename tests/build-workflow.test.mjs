// The build workflow decides what "done" means for a step, and it is the part
// no validator reaches: it runs inside the host's Workflow runtime. So it gets
// that runtime here — stubbed agents returning scripted results — and every
// way it could report `built` over a step that was not, or start work before
// it was allowed to, is a scenario below.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const WORKFLOW = join(root, 'skills', 'build', 'workflows', 'build.mjs')

const source = readFileSync(WORKFLOW, 'utf8').replace(/^export\s+const\s+meta\s*=/m, 'const meta =')

const compiled = new Function(
  'args',
  'agent',
  'parallel',
  'pipeline',
  'phase',
  'log',
  'budget',
  `return (async () => {\n${source}\n})()`,
)

const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
const pipeline = async (items, ...stages) => {
  const out = []
  for (const [i, item] of items.entries()) {
    let value = item
    for (const stage of stages) value = await stage(value, item, i)
    out.push(value)
  }
  return out
}

const step = (id, dependsOn, files) => ({
  id,
  title: `step ${id}`,
  files,
  dependsOn,
  verifyCmd: `npm test -- ${id}`,
  verifyExpected: 'passes',
  raw: `### ${id} — step ${id}\n- **Files:** ${files.map((f) => `\`${f}\``).join(' · ')}\n- **Depends on:** ${dependsOn.join(', ') || 'none'}\n- **Verify:** \`npm test -- ${id}\` → passes`,
})

// S-001 ← S-002 ← S-003: a chain.
const CHAIN = [step('S-001', [], ['src/a.ts']), step('S-002', ['S-001'], ['src/b.ts']), step('S-003', ['S-002'], ['src/c.ts'])]
const CHAIN_WAVES = [['S-001'], ['S-002'], ['S-003']]

// S-001, then S-002 and S-003 side by side.
const FAN = [step('S-001', [], ['src/a.ts']), step('S-002', ['S-001'], ['src/b.ts']), step('S-003', ['S-001'], ['src/c.ts'])]
const FAN_WAVES = [['S-001'], ['S-002', 'S-003']]

const IMPL_OK = { done_claimed: true, files_touched: ['src/x.ts'], verify_cmd: 'npm test', verify_exit_code: 0, verify_output: 'ok' }
const REVIEW_OK = { spec_ok: true, quality_ok: true, verify_exit_code: 0, verify_output: 'ok', issues: [] }
const GUARD_CLEAN = { verdict: 'CLEAN', violations: [] }

// Longest pattern wins, so `review:S-002` beats `review:` no matter which order
// the scenario spread them in. Matching on insertion order instead means a test
// can silently exercise the generic stub it thought it had overridden.
function makeAgent(script, calls) {
  const patterns = Object.keys(script).sort((a, b) => b.length - a.length)
  return async (prompt, opts = {}) => {
    const label = opts.label || 'unlabelled'
    calls.push(label)
    for (const pattern of patterns) {
      if (label === pattern || label.startsWith(pattern)) {
        const value = script[pattern]
        return typeof value === 'function' ? value(prompt, opts, label) : value
      }
    }
    return null
  }
}

function run(argsOverride, script, logs = []) {
  const calls = []
  const args = {
    cwd: '/wt',
    planPath: 'docs/plans/2026-01-01-thing.md',
    steps: CHAIN,
    waves: CHAIN_WAVES,
    skillDir: '/skill',
    runDir: '/wt/.agents/build/20260101-000000',
    baseline: 'abc123',
    mode: 'workflow',
    ...argsOverride,
  }
  return compiled(args, makeAgent(script, calls), parallel, pipeline, () => {}, (m) => logs.push(String(m)), {
    total: null,
    spent: () => 0,
    remaining: () => Infinity,
  }).then((result) => ({ result, calls }))
}

const HAPPY = { 'impl:': IMPL_OK, 'review:': REVIEW_OK, 'guard:': GUARD_CLEAN, summary: 'written' }

test('a clean build lands every step and hands off to verify on the plan path', async () => {
  const { result, calls } = await run({}, HAPPY)
  assert.equal(result.status, 'built')
  assert.deepEqual(result.steps.map((s) => s.status), ['done', 'done', 'done'])
  assert.equal(result.next, '/verify docs/plans/2026-01-01-thing.md')
  assert.equal(result.stopped_by, null)
  assert.ok(calls.includes('summary'))
})

test('nothing precedes the first implementer — no question, no summary, no confirmation', async () => {
  // The user's rule: one invocation launches the build. Phase 0 is
  // deterministic and outside the workflow; inside it, the first agent spent
  // is the one that writes code.
  const { calls } = await run({}, HAPPY)
  assert.ok(calls[0].startsWith('impl:'), `first agent call was ${calls[0]}`)
})

test('a wave waits for the wave before it', async () => {
  const { calls } = await run({ steps: FAN, waves: FAN_WAVES }, HAPPY)
  const at = (label) => calls.indexOf(label)
  assert.ok(at('review:S-001') >= 0)
  assert.ok(at('impl:S-002') > at('review:S-001'), 'S-002 started before S-001 was reviewed')
  assert.ok(at('impl:S-003') > at('review:S-001'), 'S-003 started before S-001 was reviewed')
  assert.ok(at('impl:S-002') > at('guard:S-001'), 'S-002 started before S-001 was guarded')
})

test('a step whose Verify command fails is retried once, then blocked, and its dependents are skipped', async () => {
  const { result, calls } = await run(
    {},
    {
      'impl:S-002': { ...IMPL_OK, verify_exit_code: 1, verify_output: '1 failed' },
      'review:S-002': { ...REVIEW_OK, verify_exit_code: 1, spec_ok: false, issues: [{ file: 'src/b.ts', line: 3, issue: 'test fails', kind: 'spec' }] },
      ...HAPPY,
    },
  )
  assert.equal(result.status, 'blocked')
  const s2 = result.steps.find((s) => s.id === 'S-002')
  assert.equal(s2.status, 'blocked')
  assert.equal(s2.attempts, 2)
  assert.equal(calls.filter((c) => c === 'impl:S-002').length, 1)
  assert.equal(calls.filter((c) => c === 'impl:S-002:retry').length, 1)
  assert.ok(calls.some((c) => c === 'impl:S-002:retry'), 'no retry was attempted')
  const s3 = result.steps.find((s) => s.id === 'S-003')
  assert.equal(s3.status, 'skipped')
  assert.ok(result.skipped.some((s) => s.id === 'S-003' && s.because === 'S-002'))
  assert.ok(!calls.includes('impl:S-003'), 'a dependent of a blocked step was implemented anyway')
  assert.equal(result.next, null)
})

test('a reviewer that rejects the spec blocks the step even when the implementer reported green', async () => {
  const { result } = await run(
    {},
    {
      'review:S-001': { ...REVIEW_OK, spec_ok: false, issues: [{ file: 'src/a.ts', line: 1, issue: 'Preserve violated', kind: 'spec' }] },
      ...HAPPY,
    },
  )
  assert.equal(result.steps[0].status, 'blocked')
  assert.equal(result.status, 'blocked')
})

test("a reviewer whose own run of the Verify command fails is not overruled by the implementer's", async () => {
  const { result } = await run({}, { 'review:S-001': { ...REVIEW_OK, verify_exit_code: 2 }, ...HAPPY })
  assert.equal(result.steps[0].status, 'blocked')
  assert.equal(result.steps[0].exit_code, 2, "the reviewer's exit code is the one recorded")
})

test('a reviewer that never returned leaves the step unproven, not blocked, and triggers no retry', async () => {
  // Observed for real: eleven agents died on a quota limit mid-run, and the
  // workflow reported the steps as blocked — blaming the code for an outage,
  // and spending a second implementer against the same outage. An agent that
  // never ran found nothing because it never ran.
  const { result, calls } = await run({}, { ...HAPPY, 'review:S-001': null })
  const s1 = result.steps[0]
  assert.equal(s1.status, 'unproven')
  assert.match(s1.notes, /never returned/)
  assert.equal(s1.attempts, 1, 'an outage must not spend a second implementer')
  assert.ok(!calls.includes('impl:S-001:retry'))
  assert.equal(result.status, 'unproven')
  assert.equal(result.next, null, 'unproven must never hand off to verify')
  assert.ok(result.unproven.some((u) => u.id === 'S-001'))
  assert.ok(
    result.residual_risk.some((r) => /NOT JUDGED/.test(r) && /S-001/.test(r)),
    JSON.stringify(result.residual_risk),
  )
})

test('an implementer or a guard that never returned is unproven too', async () => {
  const noImpl = await run({}, { ...HAPPY, 'impl:S-001': null })
  assert.equal(noImpl.result.steps[0].status, 'unproven')
  assert.match(noImpl.result.steps[0].notes, /implementer never returned/)
  assert.ok(!noImpl.calls.includes('review:S-001'), 'the reviewer ran with nothing to review')

  // No guard, no clean bill: the scan is the only thing between the build and
  // a step that landed by silencing its own proof.
  const noGuard = await run({}, { ...HAPPY, 'guard:S-001': null })
  assert.equal(noGuard.result.steps[0].status, 'unproven')
  assert.match(noGuard.result.steps[0].notes, /guard never returned/)
  assert.equal(noGuard.result.status, 'unproven')
})

test('a step nobody judged still stops the wave that depended on it', async () => {
  const { result } = await run({ steps: FAN, waves: FAN_WAVES }, { ...HAPPY, 'review:S-001': null })
  assert.equal(result.steps.find((s) => s.id === 'S-002').status, 'skipped')
  assert.ok(result.skipped.some((s) => s.id === 'S-002' && s.because === 'S-001'))
})

test('unproven and blocked are different answers, and blocked wins when both happen', async () => {
  const { result } = await run(
    { steps: FAN, waves: FAN_WAVES },
    {
      ...HAPPY,
      'review:S-002': { ...REVIEW_OK, spec_ok: false, issues: [{ file: 'src/b.ts', line: 1, issue: 'missing', kind: 'spec' }] },
      'review:S-003': null,
    },
  )
  assert.equal(result.steps.find((s) => s.id === 'S-002').status, 'blocked')
  assert.equal(result.steps.find((s) => s.id === 'S-003').status, 'unproven')
  assert.equal(result.status, 'blocked', 'a real rejection outranks an outage')
})

test('a forbidden repair reverts the hunk, stops the build, and nothing later is implemented', async () => {
  const { result, calls } = await run(
    {},
    {
      'guard:S-001': { verdict: 'FORBIDDEN', violations: [{ rule: 'test-skip', file: 'tests/a.test.ts', line: 4 }] },
      ...HAPPY,
    },
  )
  assert.ok(calls.includes('revert-forbidden'), 'the forbidden hunk was not reverted')
  assert.match(result.stopped_by, /forbidden-repair: test-skip @ tests\/a\.test\.ts/)
  assert.equal(result.status, 'blocked')
  assert.ok(!calls.includes('impl:S-002'), 'the build went on after a forbidden repair')
  assert.deepEqual(result.steps.map((s) => s.status), ['blocked', 'skipped', 'skipped'])
})

test('an implementer that reports blocked_by is not retried', async () => {
  const { result, calls } = await run(
    {},
    { 'impl:S-001': { ...IMPL_OK, done_claimed: false, verify_exit_code: -1, blocked_by: 'needs a schema migration the plan does not have' }, ...HAPPY },
  )
  assert.equal(result.steps[0].status, 'blocked')
  assert.match(result.steps[0].notes, /schema migration/)
  assert.ok(!calls.includes('impl:S-001:retry'))
})

test('peer mode: an unavailable peer stops the build by name, and no host implementer is spawned', async () => {
  const { result, calls } = await run(
    { mode: 'peer', host: 'claude' },
    { 'peer:': { status: 'peer_unavailable', reason: '`codex` is not on PATH.' }, ...HAPPY },
  )
  assert.equal(result.status, 'peer_unavailable')
  assert.match(result.stopped_by, /not on PATH/)
  assert.equal(calls.filter((c) => c.startsWith('impl:')).length, 0, 'the host implemented what the peer was asked to')
  assert.equal(result.steps[0].status, 'peer_unavailable')
})

test('peer mode: the reviewer and the guard still run on every step, and steps go one at a time', async () => {
  const { result, calls } = await run(
    { mode: 'peer', host: 'claude', steps: FAN, waves: FAN_WAVES },
    { 'peer:': { status: 'ok', files_touched: ['src/x.ts'] }, ...HAPPY },
  )
  assert.equal(result.status, 'built')
  for (const id of ['S-001', 'S-002', 'S-003']) {
    assert.ok(calls.includes(`review:${id}`), `${id} was not reviewed`)
    assert.ok(calls.includes(`guard:${id}`), `${id} was not guarded`)
  }
  // Sequential: S-003's peer call comes after S-002's guard, not beside it.
  assert.ok(calls.indexOf('peer:S-003') > calls.indexOf('guard:S-002'))
  assert.ok(result.residual_risk.some((r) => /peer's own reports were not used/.test(r)))
})

test('peer mode: a peer that wrote code but whose step fails review is retried through the peer, not the host', async () => {
  let reviews = 0
  const { result, calls } = await run(
    { mode: 'peer', host: 'claude', steps: [CHAIN[0]], waves: [['S-001']] },
    {
      'peer:': { status: 'ok', files_touched: ['src/a.ts'] },
      'review:': () => (++reviews === 1 ? { ...REVIEW_OK, quality_ok: false, issues: [{ file: 'src/a.ts', line: 9, issue: 'debug output left', kind: 'quality' }] } : REVIEW_OK),
      'guard:': GUARD_CLEAN,
      summary: 'written',
    },
  )
  assert.equal(result.status, 'built')
  assert.equal(calls.filter((c) => c === 'peer:S-001').length, 2)
  assert.equal(calls.filter((c) => c.startsWith('impl:')).length, 0)
})

test('the guard is invoked as a transcription of the script, on the baseline and the plan', async () => {
  let guardPrompt = null
  await run({}, { ...HAPPY, 'guard:': (prompt) => ((guardPrompt = prompt), GUARD_CLEAN) })
  assert.ok(guardPrompt.includes('node /skill/scripts/forbidden-repairs.mjs --since abc123 --plan docs/plans/2026-01-01-thing.md'))
  assert.ok(guardPrompt.includes('Do not interpret'))
})

test('the implementer brief carries the step verbatim, the forbidden list, and asks for relative paths', async () => {
  let brief = null
  await run({ steps: [CHAIN[0]], waves: [['S-001']] }, { ...HAPPY, 'impl:': (prompt) => ((brief = prompt), IMPL_OK) })
  assert.ok(brief.includes(CHAIN[0].raw))
  assert.ok(brief.includes('YOU MAY NOT'))
  assert.ok(brief.includes('npm test -- S-001'))
  // A real run came back with absolute paths in the record, which another
  // agent then has to reconcile with the plan's relative ones.
  assert.match(brief, /files_touched holds paths relative to \/wt, never absolute/)
})

test('the workflow never reaches for the clock or a random number', () => {
  // Resume replays cached agent calls; a call whose prompt embeds Date.now()
  // never matches its cache entry, so the whole run restarts.
  assert.ok(!source.includes('Date.now('))
  assert.ok(!source.includes('Math.random('))
})

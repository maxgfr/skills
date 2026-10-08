// The build workflow decides what "done" means for a step, and it runs inside
// the host's Workflow runtime, which no validator reaches. So it gets that
// runtime here — stubbed agents returning scripted results.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'skills', 'build', 'workflows', 'build.mjs'), 'utf8').replace(
  /^export\s+const\s+meta\s*=/m,
  'const meta =',
)
const compiled = new Function('args', 'agent', 'parallel', 'phase', 'log', `return (async () => {\n${source}\n})()`)
const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))

const step = (id, dependsOn) => ({
  id,
  title: `step ${id}`,
  files: [`src/${id}.ts`],
  dependsOn,
  verifyCmd: `npm test -- ${id}`,
  verifyExpected: 'passes',
  raw: `### ${id} — step ${id}\n- **Verify:** \`npm test -- ${id}\` → passes`,
})
const CHAIN = [step('S-001', []), step('S-002', ['S-001']), step('S-003', ['S-002'])]
const FAN = [step('S-001', []), step('S-002', ['S-001']), step('S-003', ['S-001'])]
const FAN_WAVES = [['S-001'], ['S-002', 'S-003']]

const IMPL_OK = { done: true, files: ['src/x.ts'], exit: 0, out: 'ok' }
const REVIEW_OK = { ok: true, exit: 0, guard: 'CLEAN', issues: [] }
const REJECT = { ok: false, exit: 1, guard: 'CLEAN', issues: ['src/S-001.ts:3 — missing branch'] }
const HAPPY = { 'impl:': IMPL_OK, 'review:': REVIEW_OK }
const TIERS = {
  small: { model: 'tier-s', effort: 'max' },
  medium: { model: 'tier-m', effort: 'high' },
  large: { model: null, effort: null },
  attempts: ['small', 'small', 'medium'],
  review: 'medium',
}

// Longest pattern wins, so `review:S-002` beats `review:`.
function makeAgent(script, calls) {
  const patterns = Object.keys(script).sort((a, b) => b.length - a.length)
  return async (prompt, opts = {}) => {
    calls.push({ label: opts.label, model: opts.model, effort: opts.effort, prompt })
    const hit = patterns.find((p) => opts.label === p || opts.label.startsWith(p))
    const value = hit ? script[hit] : null
    return typeof value === 'function' ? value(prompt, opts) : value
  }
}

async function run(over, script) {
  const calls = []
  const args = { cwd: '/wt', planPath: 'docs/plans/x.md', steps: CHAIN, skillDir: '/skill', baseline: 'abc', host: 'claude', tiers: TIERS, ...over }
  const result = await compiled(args, makeAgent(script, calls), parallel, () => {}, () => {})
  return { result, calls, labels: calls.map((c) => c.label) }
}

test('a clean build is one line per step and hands off to verify on the plan', async () => {
  const { result } = await run({}, HAPPY)
  assert.equal(result.status, 'built')
  assert.deepEqual(result.lines, ['S-001 done 0 small', 'S-002 done 0 small', 'S-003 done 0 small'])
  assert.equal(result.next, '/verify docs/plans/x.md')
})

test('the handoff uses the host syntax it was given, and never guesses one', async () => {
  assert.equal((await run({ host: 'codex' }, HAPPY)).result.next, '$verify docs/plans/x.md')
  assert.equal((await run({ namespace: 'maxgfr' }, HAPPY)).result.next, '/maxgfr:verify docs/plans/x.md')
  assert.equal((await run({ host: null }, HAPPY)).result.next, 'invoke the verify skill with docs/plans/x.md')
})

test('implementers get the small tier and reviewers the medium one, model and effort', async () => {
  const { calls } = await run({}, HAPPY)
  for (const c of calls) {
    const impl = c.label.startsWith('impl:')
    assert.deepEqual([c.model, c.effort], impl ? ['tier-s', 'max'] : ['tier-m', 'high'], c.label)
  }
})

test('an unset tier passes no model and no effort, so the agent inherits the session', async () => {
  const { calls } = await run({ tiers: {} }, HAPPY)
  assert.ok(calls.every((c) => c.model === undefined && c.effort === undefined))
})

test('the ladder and the reviewer tier come from the config', async () => {
  const tiers = { ...TIERS, attempts: ['medium', 'large'], review: 'large', large: { model: 'tier-l', effort: 'xhigh' } }
  const { calls, result } = await run({ steps: [CHAIN[0]], tiers }, { ...HAPPY, 'review:': REJECT })
  assert.deepEqual(calls.map((c) => [c.label, c.model]), [
    ['impl:S-001:1', 'tier-m'],
    ['review:S-001:1', 'tier-l'],
    ['impl:S-001:2', 'tier-l'],
    ['review:S-001:2', 'tier-l'],
  ])
  assert.match(result.lines[0], /^S-001 blocked 1 large /)
})

test('a rejected step escalates small, small with the issues, then medium, then blocks', async () => {
  const { result, calls } = await run({}, { ...HAPPY, 'review:S-001': REJECT })
  const impls = calls.filter((c) => c.label.startsWith('impl:S-001'))
  assert.deepEqual(impls.map((c) => c.model), ['tier-s', 'tier-s', 'tier-m'])
  assert.ok(!impls[0].prompt.includes('missing branch'))
  assert.ok(impls[1].prompt.includes('src/S-001.ts:3 — missing branch'), 'the retry did not carry the issues')
  assert.equal(result.status, 'blocked')
  assert.match(result.lines[0], /^S-001 blocked 1 medium /)
  assert.deepEqual(result.lines.slice(1), ['S-002 skipped - - needs S-001', 'S-003 skipped - - needs S-002'])
  assert.equal(result.next, null)
})

test('the medium attempt can land a step the small ones could not', async () => {
  let n = 0
  const { result } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'review:': () => (++n < 3 ? REJECT : REVIEW_OK) })
  assert.deepEqual(result.lines, ['S-001 done 0 medium'])
})

test('a small implementer that reports blocked_by goes straight to medium; a medium one blocks', async () => {
  const blocked = { ...IMPL_OK, done: false, exit: -1, blocked_by: 'needs a migration' }
  const { result, labels } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'impl:S-001': blocked })
  assert.deepEqual(labels, ['impl:S-001:1', 'impl:S-001:3'])
  assert.match(result.lines[0], /^S-001 blocked - medium blocked_by: needs a migration/)
})

test('a reviewer that rejects is not overruled by an implementer that reported green', async () => {
  const { result } = await run({ steps: [CHAIN[0]], tiers: { ...TIERS, attempts: ['small'] } }, { ...HAPPY, 'review:': { ...REVIEW_OK, ok: false } })
  assert.equal(result.status, 'blocked')
})

test('an agent that never returned is unproven, buys no retry, and never hands off', async () => {
  for (const missing of ['impl:S-001', 'review:S-001']) {
    const { result, labels } = await run({}, { ...HAPPY, [missing]: null })
    assert.match(result.lines[0], /^S-001 unproven .* never returned/)
    assert.equal(labels.filter((l) => l.startsWith('impl:S-001')).length, 1)
    assert.equal(result.status, 'unproven')
    assert.equal(result.next, null)
  }
})

test('blocked outranks unproven when both happen', async () => {
  const { result } = await run({ steps: FAN, waves: FAN_WAVES }, { ...HAPPY, 'review:S-002': { ...REJECT }, 'review:S-003': null })
  assert.equal(result.status, 'blocked')
})

test('a wave waits for the wave before it', async () => {
  const { labels } = await run({ steps: FAN, waves: FAN_WAVES }, HAPPY)
  assert.ok(labels.indexOf('impl:S-002:1') > labels.indexOf('review:S-001:1'))
  assert.ok(labels.indexOf('impl:S-003:1') > labels.indexOf('review:S-001:1'))
})

test('a forbidden repair is reverted by the small tier and stops the build', async () => {
  const { result, calls, labels } = await run({}, { ...HAPPY, 'review:S-001': { ...REVIEW_OK, guard: 'FORBIDDEN', violations: ['test-skip tests/a.test.ts:4'] }, 'revert:': 'reverted' })
  const revert = calls.find((c) => c.label === 'revert:S-001')
  assert.ok(revert && revert.model === 'tier-s')
  assert.ok(revert.prompt.includes('test-skip tests/a.test.ts:4'))
  assert.match(result.stopped_by, /forbidden repair in S-001/)
  assert.ok(!labels.some((l) => l.startsWith('impl:S-002')))
  assert.equal(result.status, 'blocked')
})

test('a long violation list stays one short line, and the revert still gets all of it', async () => {
  // Seen for real: twenty violations on one file turned the one-line step
  // report into a wall of text.
  const violations = Array.from({ length: 20 }, (_, i) => `spec-rewrite plan.md:${i + 1}`)
  const { result, calls } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'review:': { ...REVIEW_OK, guard: 'FORBIDDEN', violations }, 'revert:': 'ok' })
  assert.match(result.stopped_by, /plan\.md:1, spec-rewrite plan\.md:2, spec-rewrite plan\.md:3 \+17 more$/)
  assert.ok(result.lines[0].length < 160, result.lines[0])
  assert.ok(calls.find((c) => c.label === 'revert:S-001').prompt.includes('plan.md:20'))
})

test('the reviewer reruns Verify and the guard on the baseline and the plan', async () => {
  const { calls } = await run({ steps: [CHAIN[0]] }, HAPPY)
  const review = calls.find((c) => c.label.startsWith('review:')).prompt
  assert.ok(review.includes('Run: npm test -- S-001'))
  assert.ok(review.includes('node /skill/scripts/forbidden-repairs.mjs --since abc --plan docs/plans/x.md'))
  const impl = calls.find((c) => c.label.startsWith('impl:')).prompt
  assert.ok(impl.includes(CHAIN[0].raw) && impl.includes('YOU MAY NOT'))
})

test('dispatch.md carries the workflow briefs verbatim', () => {
  // Hosts without a Workflow tool paste these briefs; a brief that drifts from
  // the workflow's is two builds wearing one name.
  const dispatch = readFileSync(join(root, 'skills', 'build', 'references', 'dispatch.md'), 'utf8')
  const forbidden = /const FORBIDDEN = `([^`]+)`/.exec(source)[1]
  assert.ok(dispatch.includes(forbidden), 'the FORBIDDEN list drifted')
  const returns = source
    .split('\n')
    .filter((l) => /^(- )?Return JSON:/.test(l))
    .map((l) => l.replace(/`\s*}?\s*$/, ''))
  assert.equal(returns.length, 2)
  for (const line of returns) assert.ok(dispatch.includes(line), `drifted: ${line}`)
})

test('the workflow never reaches for the clock or a random number', () => {
  assert.ok(!source.includes('Date.now(') && !source.includes('Math.random('))
})

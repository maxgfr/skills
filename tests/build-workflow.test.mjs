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
  files: [`src/${id}.ts`],
  dependsOn,
  verifyCmd: `npm test -- ${id}`,
  raw: `### ${id} — step ${id}\n- **Verify:** \`npm test -- ${id}\` → passes`,
})
const CHAIN = [step('S-001', []), step('S-002', ['S-001']), step('S-003', ['S-002'])]
const FAN = [step('S-001', []), step('S-002', ['S-001']), step('S-003', ['S-001'])]
const FAN_WAVES = [['S-001'], ['S-002', 'S-003']]

const IMPL_OK = { exit: 0 }
const OK = { ok: true, exit: 0, issues: [] }
const REJECT = { ok: false, exit: 1, issues: ['src/S-001.ts:3 — missing branch'] }
const TIERS = {
  small: { model: 'tier-s', effort: 'max' },
  medium: { model: 'tier-m', effort: 'high' },
  large: { model: null, effort: null },
  attempts: ['small', 'small', 'medium'],
  review: 'medium',
}

// A reviewer stub judges every step named in its brief; `verdict(id, n)` gets
// how many times that step has been reviewed so far.
const idsIn = (prompt) => [...new Set([...prompt.matchAll(/^### (S-\d{3})/gm)].map((m) => m[1]))]
function reviewer(verdict = () => OK, extra = {}) {
  const seen = new Map()
  return (prompt) => ({
    guard: 'CLEAN',
    ...extra,
    steps: idsIn(prompt).map((id) => {
      seen.set(id, (seen.get(id) || 0) + 1)
      return { id, ...verdict(id, seen.get(id)) }
    }),
  })
}
const HAPPY = { 'impl:': IMPL_OK, 'review:': reviewer() }

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
  const args = { cwd: '/wt', planPath: 'docs/plans/x.md', steps: CHAIN, skillDir: '/skill', baseline: 'abc', tiers: TIERS, ...over }
  const result = await compiled(args, makeAgent(script, calls), parallel, () => {}, () => {})
  return { result, calls, labels: calls.map((c) => c.label) }
}

test('a clean build is one line per step, and the result carries nothing host-specific', async () => {
  const { result } = await run({}, HAPPY)
  assert.deepEqual(result, {
    status: 'built',
    worktree: '/wt',
    lines: ['S-001 done 0 small', 'S-002 done 0 small', 'S-003 done 0 small'],
    stopped_by: null,
  })
})

test('a wave of parallel steps shares one reviewer, which reruns every Verify and the guard once', async () => {
  const wide = [step('S-001', []), step('S-002', []), step('S-003', [])]
  const { result, calls } = await run({ steps: wide, waves: [['S-001', 'S-002', 'S-003']] }, HAPPY)
  const reviews = calls.filter((c) => c.label.startsWith('review:'))
  assert.equal(reviews.length, 1)
  for (const id of ['S-001', 'S-002', 'S-003']) {
    assert.ok(reviews[0].prompt.includes(`out=$( (npm test -- ${id}) 2>&1 ); e=$?;`), id)
    assert.ok(reviews[0].prompt.includes(`echo "${id} exit=$e"`), id)
  }
  assert.equal(reviews[0].prompt.match(/forbidden-repairs\.mjs/g).length, 1)
  assert.equal(result.status, 'built')
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

test('a rejected step escalates small, small with the issues, then medium, then blocks', async () => {
  const { result, calls } = await run({}, { ...HAPPY, 'review:': reviewer((id) => (id === 'S-001' ? REJECT : OK)) })
  const impls = calls.filter((c) => c.label.startsWith('impl:S-001'))
  assert.deepEqual(impls.map((c) => c.model), ['tier-s', 'tier-s', 'tier-m'])
  assert.ok(!impls[0].prompt.includes('missing branch'))
  assert.ok(impls[1].prompt.includes('src/S-001.ts:3 — missing branch'), 'the retry did not carry the issues')
  assert.equal(result.status, 'blocked')
  assert.match(result.lines[0], /^S-001 blocked 1 medium /)
  assert.deepEqual(result.lines.slice(1), ['S-002 skipped - - needs S-001', 'S-003 skipped - - needs S-002'])
})

test('in a shared wave only the rejected step is retried, and the retry gets its own review', async () => {
  const { result, labels, calls } = await run(
    { steps: FAN, waves: FAN_WAVES },
    { ...HAPPY, 'review:': reviewer((id, n) => (id === 'S-002' && n === 1 ? REJECT : OK)) },
  )
  assert.deepEqual(labels, ['impl:S-001:1', 'review:w1:1', 'impl:S-002:1', 'impl:S-003:1', 'review:w2:1', 'impl:S-002:2', 'review:w2:2'])
  assert.deepEqual(idsIn(calls.find((c) => c.label === 'review:w2:2').prompt), ['S-002'])
  assert.equal(result.status, 'built')
})

test('a retry carries at most three of the reviewer issues', async () => {
  const many = { ok: false, exit: 0, issues: ['a:1 — one', 'a:2 — two', 'a:3 — three', 'a:4 — four'] }
  const { calls } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'review:': reviewer((id, n) => (n === 1 ? many : OK)) })
  const retry = calls.find((c) => c.label === 'impl:S-001:2').prompt
  assert.ok(retry.includes('a:3 — three') && !retry.includes('a:4 — four'))
})

test('the medium attempt can land a step the small ones could not', async () => {
  const { result } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'review:': reviewer((id, n) => (n < 3 ? REJECT : OK)) })
  assert.deepEqual(result.lines, ['S-001 done 0 medium'])
})

test('the ladder and the reviewer tier come from the config', async () => {
  const tiers = { ...TIERS, attempts: ['medium', 'large'], review: 'large', large: { model: 'tier-l', effort: 'xhigh' } }
  const { calls, result } = await run({ steps: [CHAIN[0]], tiers }, { ...HAPPY, 'review:': reviewer(() => REJECT) })
  assert.deepEqual(calls.map((c) => [c.label, c.model]), [
    ['impl:S-001:1', 'tier-m'],
    ['review:w1:1', 'tier-l'],
    ['impl:S-001:2', 'tier-l'],
    ['review:w1:2', 'tier-l'],
  ])
  assert.match(result.lines[0], /^S-001 blocked 1 large /)
})

test('a small implementer that reports blocked_by goes straight to the last tier; there it blocks', async () => {
  const blocked = { exit: -1, blocked_by: 'needs a migration' }
  const { result, labels } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'impl:S-001': blocked })
  assert.deepEqual(labels, ['impl:S-001:1', 'impl:S-001:3'])
  assert.match(result.lines[0], /^S-001 blocked - medium blocked_by: needs a migration/)
})

test('a reviewer that rejects is not overruled by an implementer that reported green', async () => {
  const { result } = await run({ steps: [CHAIN[0]], tiers: { ...TIERS, attempts: ['small'] } }, { ...HAPPY, 'review:': reviewer(() => ({ ...OK, ok: false })) })
  assert.equal(result.status, 'blocked')
})

test('an agent that never returned is unproven and buys no retry', async () => {
  for (const missing of ['impl:S-001', 'review:']) {
    const { result, labels } = await run({}, { ...HAPPY, [missing]: null })
    assert.match(result.lines[0], /^S-001 unproven .* never returned/)
    assert.equal(labels.filter((l) => l.startsWith('impl:S-001')).length, 1)
    assert.equal(result.status, 'unproven')
  }
})

test('a step the reviewer left out of its answer is unproven, not done', async () => {
  const { result } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'review:': () => ({ guard: 'CLEAN', steps: [] }) })
  assert.match(result.lines[0], /^S-001 unproven .* did not judge it/)
})

test('blocked outranks unproven when both happen', async () => {
  const { result } = await run(
    { steps: FAN, waves: FAN_WAVES },
    { ...HAPPY, 'review:': (prompt) => ({ guard: 'CLEAN', steps: idsIn(prompt).filter((id) => id !== 'S-003').map((id) => ({ id, ...(id === 'S-002' ? REJECT : OK) })) }) },
  )
  assert.equal(result.status, 'blocked')
})

test('a forbidden repair is reverted by the first-attempt tier and stops the build', async () => {
  const { result, calls, labels } = await run(
    {},
    { ...HAPPY, 'review:': reviewer(() => OK, { guard: 'FORBIDDEN', violations: ['test-skip tests/a.test.ts:4'] }), 'revert:': 'reverted' },
  )
  const revert = calls.find((c) => c.label === 'revert:w1')
  assert.ok(revert && revert.model === 'tier-s')
  assert.ok(revert.prompt.includes('test-skip tests/a.test.ts:4'))
  assert.match(result.stopped_by, /^forbidden repair: test-skip/)
  assert.ok(!labels.some((l) => l.startsWith('impl:S-002')))
  assert.equal(result.status, 'blocked')
})

test('a long violation list stays one short line, and the revert still gets all of it', async () => {
  const violations = Array.from({ length: 20 }, (_, i) => `spec-rewrite plan.md:${i + 1}`)
  const { result, calls } = await run({ steps: [CHAIN[0]] }, { ...HAPPY, 'review:': reviewer(() => OK, { guard: 'FORBIDDEN', violations }), 'revert:': 'ok' })
  assert.match(result.stopped_by, /plan\.md:1, spec-rewrite plan\.md:2, spec-rewrite plan\.md:3 \+17 more$/)
  assert.ok(result.lines[0].length < 160, result.lines[0])
  assert.ok(calls.find((c) => c.label === 'revert:w1').prompt.includes('plan.md:20'))
})

test('the reviewer reruns Verify and the guard on the baseline and the plan', async () => {
  const { calls } = await run({ steps: [CHAIN[0]] }, HAPPY)
  const review = calls.find((c) => c.label.startsWith('review:')).prompt
  assert.ok(review.includes('out=$( (npm test -- S-001) 2>&1 ); e=$?;'))
  // One shell call holds the whole review: every extra tool call re-sends the
  // agent's context, which is where a subagent's tokens go.
  assert.match(review, /Run this once, as a single shell call:\n\ngit diff abc -- src\/S-001\.ts\nfor f in \$\(git ls-files -o --exclude-standard -- src\/S-001\.ts\)/)
  assert.ok(review.includes('| tail -15'), 'Verify output is capped')
  assert.ok(review.includes('node /skill/scripts/forbidden-repairs.mjs --brief --since abc --plan docs/plans/x.md'))
  const impl = calls.find((c) => c.label.startsWith('impl:')).prompt
  assert.ok(impl.includes(CHAIN[0].raw) && impl.includes('Never skip, weaken or delete a test'))
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
    .map((l) => l.replace(/\$\{.*$|`\s*}?\s*$/, ''))
  assert.equal(returns.length, 2)
  for (const line of returns) assert.ok(dispatch.includes(line), `drifted: ${line}`)
})

test('the workflow never reaches for the clock or a random number', () => {
  assert.ok(!source.includes('Date.now(') && !source.includes('Math.random('))
})

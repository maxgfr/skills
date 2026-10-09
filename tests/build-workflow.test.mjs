// The build workflow script, run with stub subagents. Its scheduling, its
// retries one tier up, its stops and its repair mode are code, so they are
// tested as code rather than read as prose.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const markdown = readFileSync(join(ROOT, 'skills/build/references/workflow.md'), 'utf8')
const script = markdown.match(/```js\n([\s\S]*?)\n```/)[1].replace(/^export const meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const tick = () => new Promise((done) => setImmediate(done))

const TIERS = { small: { model: 'tiny', effort: 'max' }, medium: { model: 'mid', effort: 'high' }, large: {} }

const step = (id, { waits = [], files = [`${id}.md`], tier = 'small', reviewTier = 'medium', security = false } = {}) => ({
  id,
  block: `### ${id} — demo step`,
  waits,
  files,
  tier,
  reviewTier,
  security,
})

// Runs the script; `reply(kind, id)` answers each subagent, kind being
// implement, review or fix, and `calls` the calls launched so far. Every call is recorded in launch order.
async function run(args, reply) {
  const calls = []
  const agent = async (prompt, opts) => {
    const [kind, id] = opts.label.startsWith('review ')
      ? ['review', opts.label.slice('review '.length)]
      : opts.label.startsWith('fix ')
        ? ['fix', opts.label.slice('fix '.length)]
        : ['implement', opts.label.split(' ')[0]]
    calls.push({ kind, id, opts, prompt })
    await tick()
    return reply(kind, id, calls)
  }
  const parallel = (thunks) => Promise.all(thunks.map((thunk) => thunk().catch(() => null)))
  const body = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', script)
  const result = await body(
    agent,
    parallel,
    undefined,
    () => {},
    () => {},
    { tiers: TIERS, worktree: '/wt', plan: '/plan.md', ...args },
    { total: null },
  )
  return { result, calls }
}

const pass = (kind) => (kind === 'review' ? { ok: true, exit: 0, issues: [], forbidden: [] } : { exit: 0 })
const at = (calls, kind, id) => calls.findIndex((call) => call.kind === kind && call.id === id)

test('independent steps start together, a dependent one after their reviews, each on its tier', async () => {
  const { result, calls } = await run(
    { steps: [step('S-001'), step('S-002'), step('S-003', { waits: ['S-001', 'S-002'] })] },
    pass,
  )
  assert.deepEqual(
    result.steps.map((s) => [s.id, s.status, s.exit, s.by]),
    [
      ['S-001', 'done', 0, 'small'],
      ['S-002', 'done', 0, 'small'],
      ['S-003', 'done', 0, 'small'],
    ],
  )
  assert.ok(at(calls, 'implement', 'S-002') < at(calls, 'review', 'S-001'))
  assert.ok(at(calls, 'implement', 'S-003') > at(calls, 'review', 'S-001'))
  assert.ok(at(calls, 'implement', 'S-003') > at(calls, 'review', 'S-002'))
  const first = calls[at(calls, 'implement', 'S-001')]
  assert.equal(first.opts.model, 'tiny')
  assert.equal(first.opts.effort, 'max')
  assert.match(first.prompt, /Work and run commands only in \/wt/)
  assert.match(first.prompt, /### S-001 — demo step/)
  assert.equal(calls[at(calls, 'review', 'S-001')].opts.model, 'mid')
})

test('a rejected try retries one tier up with the reviewer issues', async () => {
  let reviews = 0
  const { result, calls } = await run({ steps: [step('S-001')] }, (kind) =>
    kind === 'review' && reviews++ === 0
      ? { ok: false, exit: 1, issues: ['a.md:3 — missing branch'], forbidden: [] }
      : pass(kind),
  )
  assert.deepEqual(result.steps[0], { id: 'S-001', status: 'done', exit: 0, by: 'medium' })
  const retry = calls.filter((call) => call.kind === 'implement')[1]
  assert.equal(retry.opts.model, 'mid')
  assert.match(retry.prompt, /The previous attempt was rejected\. Fix every item:\n- a\.md:3 — missing branch/)
})

test('three rejected tries block the step on the large tier, and the steps after it are skipped', async () => {
  const { result, calls } = await run(
    { steps: [step('S-001'), step('S-002', { waits: ['S-001'] })] },
    (kind) => (kind === 'review' ? { ok: false, exit: 1, issues: ['a.md:1 — wrong'], forbidden: [] } : { exit: 1 }),
  )
  assert.deepEqual(result.steps[0], { id: 'S-001', status: 'blocked', exit: 1, by: 'large', note: 'a.md:1 — wrong' })
  assert.deepEqual(result.steps[1], { id: 'S-002', status: 'skipped', exit: '-', by: '-', note: 'needs S-001' })
  assert.deepEqual(
    calls.filter((call) => call.kind === 'implement').map((call) => call.opts.model ?? 'inherit'),
    ['tiny', 'mid', 'inherit'],
  )
})

test('a blocked_by retries one tier up with it as the issue, without a review', async () => {
  let tries = 0
  const { result, calls } = await run({ steps: [step('S-001')] }, (kind) =>
    kind === 'implement' && tries++ === 0 ? { exit: -1, blocked_by: 'needs a gate change' } : pass(kind),
  )
  assert.equal(result.steps[0].status, 'done')
  assert.equal(result.steps[0].by, 'medium')
  assert.equal(calls.filter((call) => call.kind === 'review').length, 1)
  assert.match(calls.filter((call) => call.kind === 'implement')[1].prompt, /- needs a gate change/)
})

test('a smaller implementer can hand its step straight to the large tier without spending a try', async () => {
  let tries = 0
  const { result, calls } = await run({ steps: [step('S-001')] }, (kind) =>
    kind === 'implement' && tries++ === 0 ? { exit: -1, escalate: 'needs a design choice' } : pass(kind),
  )
  assert.deepEqual(result.steps[0], { id: 'S-001', status: 'done', exit: 0, by: 'large' })
  const [small, large] = calls.filter((call) => call.kind === 'implement')
  assert.match(small.prompt, /return escalate/)
  assert.doesNotMatch(large.prompt, /return escalate/)
  assert.equal(large.opts.model, undefined)
  assert.match(large.prompt, /A smaller model handed this step to you: needs a design choice/)
  assert.equal(calls.filter((call) => call.kind === 'review').length, 1)
})

test('a large implementer that still fails gets its three tries after an escalation', async () => {
  let tries = 0
  const { result, calls } = await run({ steps: [step('S-001')] }, (kind) => {
    if (kind === 'review') return { ok: false, exit: 1, issues: ['a.md:1 — wrong'], forbidden: [] }
    return tries++ === 0 ? { exit: -1, escalate: 'too hard' } : { exit: 1 }
  })
  assert.equal(result.steps[0].status, 'blocked')
  assert.equal(calls.filter((call) => call.kind === 'implement').length, 4)
})

test('a forbidden change blocks its step, is returned, and stops the retries of the others', async () => {
  const { result } = await run({ steps: [step('S-001'), step('S-002')] }, async (kind, id) => {
    if (kind !== 'review') return pass(kind)
    if (id === 'S-001') return { ok: false, exit: 0, issues: [], forbidden: ['a.md:2 — test skipped'] }
    await tick()
    await tick()
    return { ok: false, exit: 1, issues: ['b.md:1 — wrong'], forbidden: [] }
  })
  assert.deepEqual(result.forbidden, ['a.md:2 — test skipped'])
  assert.equal(result.steps[0].status, 'blocked')
  assert.deepEqual(result.steps[1], {
    id: 'S-002',
    status: 'skipped',
    exit: '-',
    by: '-',
    note: 'stopped on a forbidden change',
  })
})

test('steps that share a file never run at the same time', async () => {
  const { calls } = await run(
    { steps: [step('S-001', { files: ['a.md'] }), step('S-002', { files: ['a.md', 'b.md'] })] },
    pass,
  )
  assert.ok(at(calls, 'implement', 'S-002') > at(calls, 'review', 'S-001'))
})

test('a subagent that never answers leaves its step unproven and the next one skipped', async () => {
  const { result } = await run({ steps: [step('S-001'), step('S-002', { waits: ['S-001'] })] }, () => null)
  assert.equal(result.steps[0].status, 'unproven')
  assert.equal(result.steps[1].status, 'skipped')
})

test('the reviewer of a security step looks for security holes on its own tier', async () => {
  const { calls } = await run({ steps: [step('S-001', { security: true, reviewTier: 'large' })] }, pass)
  const review = calls[at(calls, 'review', 'S-001')]
  assert.match(review.prompt, /injection/)
  assert.equal(review.opts.model, undefined)
})

test('a repair runs one fixer per group, medium first and large after', async () => {
  const groups = [
    { file: 'src/a.ts', lines: ['finding src/a.ts:12 — wrong id'] },
    { file: '-', lines: ['gate npm test 1 boom'] },
  ]
  const first = await run({ repair: { round: 1, groups } }, (kind, id) =>
    id === 'src/a.ts' ? { fixed: true, note: 'id from the saved row' } : null,
  )
  assert.deepEqual(first.result.fixes, [
    { file: 'src/a.ts', fixed: true, note: 'id from the saved row', by: 'medium' },
    { file: '-', fixed: false, note: 'no answer', by: 'medium' },
  ])
  assert.deepEqual(first.calls.map((call) => call.opts.model), ['mid', 'mid'])
  assert.match(first.calls[0].prompt, /finding src\/a\.ts:12 — wrong id/)
  const second = await run({ repair: { round: 2, groups } }, () => ({ fixed: true }))
  assert.deepEqual(second.calls.map((call) => call.opts.model), [undefined, undefined])
})

test('a step waiting on an unknown id is blocked before any agent runs, and a step waiting on it is skipped', async () => {
  const { result, calls } = await run(
    { steps: [step('S-001', { waits: ['S-404'] }), step('S-002', { waits: ['S-001'] })] },
    pass,
  )
  assert.deepEqual(result.steps, [
    { id: 'S-001', status: 'blocked', exit: '-', by: '-', note: 'unknown step S-404 in Depends on' },
    { id: 'S-002', status: 'skipped', exit: '-', by: '-', note: 'needs S-001' },
  ])
  assert.equal(calls.length, 0)
})

test('steps whose Depends on loop are blocked without an agent, and an independent step still runs', async () => {
  const { result, calls } = await run(
    { steps: [step('S-001', { waits: ['S-002'] }), step('S-002', { waits: ['S-001'] }), step('S-003')] },
    pass,
  )
  assert.deepEqual(result.steps, [
    { id: 'S-001', status: 'blocked', exit: '-', by: '-', note: 'Depends on loops' },
    { id: 'S-002', status: 'blocked', exit: '-', by: '-', note: 'Depends on loops' },
    { id: 'S-003', status: 'done', exit: 0, by: 'small' },
  ])
  assert.deepEqual(calls.filter((call) => call.id !== 'S-003'), [])
})

test('a step that waits on itself is blocked on a loop without an agent, and an independent step still runs', async () => {
  const { result, calls } = await run({ steps: [step('S-001'), step('S-003', { waits: ['S-003'] })] }, pass)
  assert.deepEqual(result.steps, [
    { id: 'S-001', status: 'done', exit: 0, by: 'small' },
    { id: 'S-003', status: 'blocked', exit: '-', by: '-', note: 'Depends on loops' },
  ])
  assert.deepEqual(calls.filter((call) => call.id === 'S-003'), [])
})

test('a repair runs its fixers one after another, the one with no file last, and keeps the groups order', async () => {
  const groups = [
    { file: 'src/a.ts', lines: ['finding src/a.ts:1 — wrong'] },
    { file: '-', lines: ['gate npm test 1 boom'] },
    { file: 'src/b.ts', lines: ['finding src/b.ts:2 — wrong'] },
  ]
  const answered = []
  const launched = []
  const { result, calls } = await run({ repair: { round: 1, groups } }, async (kind, id, sofar) => {
    // The per-file fixers answer late, so a fixer launched beside them would answer first.
    if (id !== '-') for (let wait = 0; wait < 3; wait++) await tick()
    answered.push(id)
    launched.push(sofar.length)
    return { fixed: true, note: `fixed ${id}` }
  })
  assert.deepEqual(calls.map((call) => call.id), ['src/a.ts', 'src/b.ts', '-'])
  assert.deepEqual(answered, ['src/a.ts', 'src/b.ts', '-'])
  // When each fixer answers, no later one has been launched yet.
  assert.deepEqual(launched, [1, 2, 3])
  assert.deepEqual(
    result.fixes.map((fix) => [fix.file, fix.note]),
    [
      ['src/a.ts', 'fixed src/a.ts'],
      ['-', 'fixed -'],
      ['src/b.ts', 'fixed src/b.ts'],
    ],
  )
})

test('a step that only waits on a loop is skipped, not blocked', async () => {
  const { result, calls } = await run(
    {
      steps: [
        step('S-001', { waits: ['S-002'] }),
        step('S-002', { waits: ['S-001'] }),
        step('S-003', { waits: ['S-001'] }),
      ],
    },
    pass,
  )
  assert.deepEqual(result.steps, [
    { id: 'S-001', status: 'blocked', exit: '-', by: '-', note: 'Depends on loops' },
    { id: 'S-002', status: 'blocked', exit: '-', by: '-', note: 'Depends on loops' },
    { id: 'S-003', status: 'skipped', exit: '-', by: '-', note: 'needs S-001' },
  ])
  assert.equal(calls.length, 0)
})

test('steps sharing a file follow the Depends on order, not the plan order, so no loop is reported', async () => {
  const { result, calls } = await run(
    { steps: [step('S-001', { waits: ['S-002'], files: ['a.md'] }), step('S-002', { files: ['a.md'] })] },
    pass,
  )
  assert.deepEqual(
    result.steps.map((s) => [s.id, s.status]),
    [
      ['S-001', 'done'],
      ['S-002', 'done'],
    ],
  )
  assert.ok(at(calls, 'implement', 'S-001') > at(calls, 'review', 'S-002'))
})

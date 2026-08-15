// The workflow script is the part of the skill that decides the verdict, and
// it is the part no gate could reach: it runs inside the host's Workflow
// runtime, not as a module. So we give it that runtime — stubbed agents that
// return scripted results — and drive real scenarios through it.
//
// Every scenario here corresponds to a way the pipeline could return PASS over
// broken code. That is the only failure mode of a verification tool that
// matters: being wrong in the reassuring direction.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const WORKFLOW = join(root, 'skills', 'verify', 'workflows', 'verify.mjs')

const source = readFileSync(WORKFLOW, 'utf8').replace(/^export\s+const\s+meta\s*=/m, 'const meta =')

// Mirrors the host contract: top-level await, top-level return, injected globals.
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

const PASSING_GATES = {
  results: [{ id: 'test-1', cmd: 'npm test', status: 'pass', exit_code: 0, failures_count: 0 }],
}

const BASE_MATRIX = {
  promise_source: 'plan',
  gates: [{ id: 'test-1', cmd: 'npm test', why: 'code changed', blocking: true, timeout_s: 300 }],
  requirements: [],
  behaviors: [{ id: 'B1', claim: 'the CLI rejects bad input', how_to_prove: 'run it' }],
  risk_areas: [],
}

// Scripted agent: keyed on the label the workflow assigns each call.
function makeAgent(script, calls) {
  return async (prompt, opts = {}) => {
    const label = opts.label || 'unlabelled'
    calls.push(label)
    for (const [pattern, value] of Object.entries(script)) {
      if (label === pattern || label.startsWith(pattern)) {
        return typeof value === 'function' ? value(prompt, opts) : value
      }
    }
    return null
  }
}

function run(argsOverride, script) {
  const calls = []
  const args = {
    mode: 'report',
    cwd: '/repo',
    diffCmd: 'git diff HEAD',
    skillDir: '/skill',
    reportDir: '/repo/.claude/verify/20260101-000000',
    baseline: 'abc123',
    gates: {},
    config: {
      lanes: { gates: true, spec: false, defects: true, behavior: 'quick' },
      loop: { enabled: false },
      finders: ['correctness'],
    },
    ...argsOverride,
  }
  return compiled(args, makeAgent(script, calls), parallel, pipeline, () => {}, () => {}, {
    total: null,
    spent: () => 0,
    remaining: () => Infinity,
  }).then((result) => ({ result, calls }))
}

test('a clean run passes', async () => {
  const { result } = await run(
    {},
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'prove:': { behavior_id: 'B1', proven: 'true', command: 'cli --bad', output_excerpt: 'exit 1' },
      report: 'written',
    },
  )
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.counts.blocking, 0)
})

test('a behaviour that was RUN and failed forces FAIL', async () => {
  // The strongest evidence the pipeline produces must be able to reach the
  // verdict. Gates green + a disproven behaviour is not a pass.
  const { result } = await run(
    {},
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'prove:': {
        behavior_id: 'B1',
        proven: 'false',
        command: 'cli --bad',
        output_excerpt: 'exit 0, expected 1',
      },
      report: 'written',
    },
  )
  assert.equal(result.verdict, 'FAIL', 'a disproven behaviour was ignored')
  assert.equal(result.counts.blocking, 1)
  assert.match(result.findings[0].defect, /B1/)
})

test('a disproven behaviour never faces a skeptic', async () => {
  const { calls } = await run(
    {},
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'prove:': { behavior_id: 'B1', proven: 'false', output_excerpt: 'wrong' },
      report: 'written',
    },
  )
  assert.ok(!calls.some((c) => c.startsWith('judge:')), 'machine truth was sent to a skeptic')
})

test('with no gate run and no behaviour proven, the verdict is UNPROVEN — not PASS', async () => {
  const { result } = await run(
    { config: { lanes: { gates: false, spec: false, defects: false, behavior: 'off' }, loop: { enabled: false } } },
    { matrix: { ...BASE_MATRIX, gates: [], behaviors: [] }, report: 'written' },
  )
  assert.equal(result.verdict, 'UNPROVEN')
})

test('a lane that errors is recorded, not silently treated as finding nothing', async () => {
  const { result } = await run(
    {},
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'prove:': () => {
        throw new Error('worktree creation failed: no commits yet')
      },
      report: 'written',
    },
  )
  // A green gate is real evidence, so the run can still pass — but the dead lane
  // must reach the caller, or the report shows an empty BEHAVIOUR section that
  // reads exactly like "we checked and it was fine".
  assert.equal(result.lane_failures.length, 1)
  assert.equal(result.lane_failures[0].label, 'prove:B1')
  assert.equal(result.lane_failures[0].kind, 'behavior')
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.behaviors.length, 0, 'a dead lane must not fabricate a result')
})

// ---------------------------------------------------------------- fix loop

const LOOP_ARGS = {
  mode: 'loop',
  config: {
    lanes: { gates: true, spec: false, defects: true, behavior: 'off' },
    loop: { enabled: true, max_iterations: 2, fix_severity: 'blocking' },
    finders: ['correctness'],
  },
}

const ONE_BUG = {
  findings: [
    {
      file: 'src/app.ts',
      line: 42,
      defect: 'off-by-one on the last page',
      failure_scenario: 'page=last returns an empty list',
      severity: 'blocking',
      suggested_fix: 'use <= instead of <',
    },
  ],
}

const SURVIVES = { refuted: false, reason: 'reachable from the HTTP handler' }

test('a fixer that reports fixed:false does not resolve its finding', async () => {
  const { result } = await run(LOOP_ARGS, {
    matrix: { ...BASE_MATRIX, behaviors: [] },
    gates: PASSING_GATES,
    'find:': ONE_BUG,
    'judge:': SURVIVES,
    report: 'written',
    'fix:': { fixed: false, summary_one_line: 'could not work out the boundary' },
    guard: { verdict: 'CLEAN', violations: [] },
    'regate:': { ...PASSING_GATES, findings: [{ id: 'F1', gone: false }] },
    'final-gates': PASSING_GATES,
  })
  assert.equal(result.verdict, 'FAIL', 'an unfixed blocker was reported as resolved')
  assert.equal(result.counts.blocking, 1)
  assert.deepEqual(result.fixed, [])
})

test('a fixer claiming success is not believed when the recheck says otherwise', async () => {
  const { result } = await run(LOOP_ARGS, {
    matrix: { ...BASE_MATRIX, behaviors: [] },
    gates: PASSING_GATES,
    'find:': ONE_BUG,
    'judge:': SURVIVES,
    report: 'written',
    'fix:': { fixed: true, summary_one_line: 'fixed it' },
    guard: { verdict: 'CLEAN', violations: [] },
    'regate:': { ...PASSING_GATES, findings: [{ id: 'F1', gone: false, evidence: 'code unchanged' }] },
    'final-gates': PASSING_GATES,
  })
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.counts.blocking, 1)
})

test('a genuinely fixed finding resolves and the run passes', async () => {
  const { result, calls } = await run(LOOP_ARGS, {
    matrix: { ...BASE_MATRIX, behaviors: [] },
    gates: PASSING_GATES,
    'find:': ONE_BUG,
    'judge:': SURVIVES,
    report: 'written',
    'fix:': { fixed: true, summary_one_line: 'boundary corrected' },
    guard: { verdict: 'CLEAN', violations: [] },
    'regate:': { ...PASSING_GATES, findings: [{ id: 'F1', gone: true, evidence: 'src/app.ts:42' }] },
    'final-gates': PASSING_GATES,
  })
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.fixed.length, 1)
  assert.ok(calls.includes('final-gates'), 'PASS must rest on a fresh full gate run')
})

test('a forbidden repair stops the loop and fails the run', async () => {
  const { result, calls } = await run(LOOP_ARGS, {
    matrix: { ...BASE_MATRIX, behaviors: [] },
    gates: PASSING_GATES,
    'find:': ONE_BUG,
    'judge:': SURVIVES,
    report: 'written',
    'fix:': { fixed: true, summary_one_line: 'silenced it' },
    guard: {
      verdict: 'FORBIDDEN',
      violations: [{ rule: 'suppression', file: 'src/app.ts', line: 42, text: '// @ts-ignore' }],
    },
    'revert-forbidden': 'reverted',
    'final-gates': PASSING_GATES,
  })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.stopped_by, /forbidden-repair: suppression/)
  assert.ok(calls.includes('revert-forbidden'), 'the forbidden hunks were not reverted')
  assert.ok(!calls.includes('final-gates'), 'a stopped loop must not go on to declare green')
})

test('a finding that survives two fix attempts stops the loop instead of burning iterations', async () => {
  const { result, calls } = await run(LOOP_ARGS, {
    matrix: { ...BASE_MATRIX, behaviors: [] },
    gates: PASSING_GATES,
    'find:': ONE_BUG,
    'judge:': SURVIVES,
    report: 'written',
    'fix:': { fixed: true, summary_one_line: 'tried again' },
    guard: { verdict: 'CLEAN', violations: [] },
    'regate:': { ...PASSING_GATES, findings: [{ id: 'F1', gone: false }] },
    'final-gates': PASSING_GATES,
  })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.stopped_by, /not-resolved-after-2-attempts/)
  assert.equal(calls.filter((c) => c.startsWith('fix:')).length, 2)
})

test('the loop runs for major findings when fix_severity says so, with nothing blocking', async () => {
  const { calls } = await run(
    {
      mode: 'loop',
      config: {
        lanes: { gates: true, spec: false, defects: true, behavior: 'off' },
        loop: { enabled: true, max_iterations: 1, fix_severity: 'major' },
        finders: ['correctness'],
      },
    },
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': { findings: [{ ...ONE_BUG.findings[0], severity: 'major' }] },
      'judge:': SURVIVES,
      report: 'written',
      'fix:': { fixed: true, summary_one_line: 'done' },
      guard: { verdict: 'CLEAN', violations: [] },
      'regate:': { ...PASSING_GATES, findings: [{ id: 'F1', gone: true }] },
      'final-gates': PASSING_GATES,
    },
  )
  assert.ok(calls.some((c) => c.startsWith('fix:')), 'fix_severity: major never entered the loop')
})

test('report mode never fixes anything', async () => {
  const { calls } = await run(
    { mode: 'report' },
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': ONE_BUG,
      'judge:': SURVIVES,
      report: 'written',
    },
  )
  assert.ok(!calls.some((c) => c.startsWith('fix:')), 'report mode wrote to the tree')
  assert.ok(!calls.includes('guard'))
})

test('a blocking finding faces a panel of three and needs two survivors', async () => {
  let vote = 0
  const { result, calls } = await run(
    {},
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': ONE_BUG,
      'judge:': () => {
        vote++
        // Two refutations out of three kill it.
        return vote <= 2 ? { refuted: true, reason: 'unreachable' } : SURVIVES
      },
      report: 'written',
    },
  )
  assert.equal(calls.filter((c) => c.startsWith('judge:')).length, 3)
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.refuted_count, 1)
})

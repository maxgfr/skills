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
import { TIERS, resolveTier, DEFAULT_TIER } from '../skills/verify/scripts/tiers.mjs'

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
function makeAgent(script, calls, seen = []) {
  return async (prompt, opts = {}) => {
    const label = opts.label || 'unlabelled'
    calls.push(label)
    // Parallel to `calls` so the 16 tests that assert on labels stay untouched,
    // while the model/effort assertions get what they need.
    seen.push({ label, model: opts.model, effort: opts.effort })
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
  const seen = []
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
  return compiled(args, makeAgent(script, calls, seen), parallel, pipeline, () => {}, () => {}, {
    total: null,
    spent: () => 0,
    remaining: () => Infinity,
  }).then((result) => ({ result, calls, seen }))
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

test('the light tier judges a blocking finding with one skeptic, not three', async () => {
  // The panel is the most expensive thing the workflow does: N agents per
  // finding, each reading the code. A tier that cannot shrink it cannot be
  // cheap, however few finders it runs.
  const { result, calls } = await run(
    { config: { lanes: { gates: true, spec: false, defects: true, behavior: 'off' }, loop: { enabled: false }, finders: ['correctness'], judges: { panel: 1, panel_blocking: 1 } } },
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': ONE_BUG,
      'judge:': SURVIVES,
      report: 'written',
    },
  )
  assert.equal(calls.filter((c) => c.startsWith('judge:')).length, 1)
  assert.equal(result.counts.blocking, 1, 'a single skeptic still decides — law 2 holds')
})

test('a panel is never reduced to zero skeptics', async () => {
  // No finding without a refutation attempt. A tier that set panel 0 would turn
  // every candidate into a reported defect nobody checked.
  const { result, calls } = await run(
    { config: { lanes: { gates: true, spec: false, defects: true, behavior: 'off' }, loop: { enabled: false }, finders: ['correctness'], judges: { panel: 0, panel_blocking: 0 } } },
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': ONE_BUG,
      'judge:': { refuted: true, reason: 'unreachable' },
      report: 'written',
    },
  )
  assert.equal(calls.filter((c) => c.startsWith('judge:')).length, 1)
  assert.equal(result.refuted_count, 1)
})

test('a five-skeptic panel needs three survivors', async () => {
  let vote = 0
  const { result, calls } = await run(
    { config: { lanes: { gates: true, spec: false, defects: true, behavior: 'off' }, loop: { enabled: false }, finders: ['correctness'], judges: { panel: 1, panel_blocking: 5 } } },
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': ONE_BUG,
      // Two refutations out of five leave three survivors — it lives.
      'judge:': () => (++vote <= 2 ? { refuted: true, reason: 'unreachable' } : SURVIVES),
      report: 'written',
    },
  )
  assert.equal(calls.filter((c) => c.startsWith('judge:')).length, 5)
  assert.equal(result.counts.blocking, 1)
  assert.equal(result.refuted_count, 0)
})

// ---------------------------------------------------------------- tiers
//
// The presets live in scripts/tiers.mjs rather than in a Markdown table because
// two of the workflow's guards punish a preset that is only nearly right, and
// neither failure shows up in a reading of the resolved config.

const DETECTED = {
  gates: [{ id: 'test-1', kind: 'test', cmd: 'npm test', blocking: true, timeout_s: 300 }],
}

const FAILING_GATES = {
  results: [
    { id: 'test-1', cmd: 'npm test', status: 'fail', exit_code: 1, first_failing_lines: '1 failed' },
  ],
}

const ultralightArgs = (extra = {}) => ({
  tier: 'ultralight',
  gates: DETECTED,
  config: resolveTier('ultralight'),
  ...extra,
})

test('an ultralight run spends exactly one agent', async () => {
  // deepEqual, not a count: it proves in one line that no planner, no reporter,
  // no finder and no skeptic ran, and it breaks the moment someone adds an
  // unconditional agent() call. The script deliberately has no `matrix` key —
  // makeAgent returns null for an unmatched label, so a resurrected planner
  // would crash the run rather than quietly pass.
  const { result, calls } = await run(ultralightArgs(), { gates: PASSING_GATES })
  assert.deepEqual(calls, ['gates'])
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.tier, 'ultralight')
})

test('a green run writes no report file and says so instead of naming one', async () => {
  const { result } = await run(ultralightArgs(), { gates: PASSING_GATES })
  assert.equal(result.report_path, null, 'a path here points at a file nobody wrote')
  assert.ok(
    result.residual_risk.some((r) => /defect hunt/.test(r)),
    `lanes that never ran must be named: ${JSON.stringify(result.residual_risk)}`,
  )
})

test('ultralight still repairs a red gate', async () => {
  const { calls } = await run(
    ultralightArgs({
      mode: 'loop',
      config: { ...resolveTier('ultralight'), loop: { enabled: true, max_iterations: 1 } },
    }),
    {
      gates: FAILING_GATES,
      'fix:': { fixed: true, files_touched: ['src/a.ts'], summary_one_line: 'fixed' },
      guard: { verdict: 'CLEAN', violations: [] },
      'regate:': { results: PASSING_GATES.results, findings: [{ id: 'F1', gone: true }] },
      'final-gates': PASSING_GATES,
      report: 'written',
    },
  )
  assert.ok(!calls.includes('matrix'), 'the planner came back on the red path')
  assert.ok(calls.includes('final-gates'), 'the fix loop needs matrix.gates to re-run')
})

test('the detected-gates wrapper object is unwrapped, not passed through', async () => {
  // detect-gates.mjs returns {cwd, repo, gates, ci, notes}. Handing the wrapper
  // to matrix.gates makes .length undefined, the gates lane never runs, and the
  // run returns a verdict over zero executed commands — a silent no-op that
  // reads like a real result.
  const { result, calls } = await run(ultralightArgs(), { gates: PASSING_GATES })
  assert.ok(calls.includes('gates'), 'the gates lane was skipped — matrix.gates was not an array')
  assert.notEqual(result.verdict, 'UNPROVEN')
})

test('a gate that could not run is explained, never a bare FAIL', async () => {
  const { result } = await run(ultralightArgs(), {
    gates: {
      results: [
        {
          id: 'test-1',
          cmd: 'npm test',
          status: 'not_run',
          exit_code: null,
          first_failing_lines: 'command not found',
        },
      ],
    },
    report: 'written',
  })
  assert.equal(result.verdict, 'FAIL')
  assert.ok(
    result.findings.length > 0,
    'FAIL with zero findings is the emptiest possible failure — name the command',
  )
  assert.match(result.findings[0].defect, /could not run/)
})

test('two red gates are two findings, not one', async () => {
  // Gate candidates used to share file:'gate', so dedupe collapsed every gate
  // failure into one — and the fix round then read "fix these defects in gate".
  const { result } = await run(
    {
      tier: 'ultralight',
      gates: {
        gates: [
          { id: 'test-1', cmd: 'npm test', blocking: true, timeout_s: 300 },
          { id: 'tc-1', cmd: 'npm run typecheck', blocking: true, timeout_s: 300 },
        ],
      },
      config: resolveTier('ultralight'),
    },
    {
      gates: {
        results: [
          { id: 'test-1', cmd: 'npm test', status: 'fail', exit_code: 1, first_failing_lines: 'x' },
          { id: 'tc-1', cmd: 'npm run typecheck', status: 'fail', exit_code: 2, first_failing_lines: 'y' },
        ],
      },
      report: 'written',
    },
  )
  assert.equal(result.findings.length, 2, JSON.stringify(result.findings.map((f) => f.defect)))
})

test('a non-blocking gate does not sink the verdict on its own', async () => {
  const { result } = await run(
    {
      tier: 'ultralight',
      gates: {
        gates: [
          { id: 'test-1', cmd: 'npm test', blocking: true, timeout_s: 300 },
          { id: 'e2e-1', cmd: 'npm run test:e2e', blocking: false, timeout_s: 900 },
        ],
      },
      config: resolveTier('ultralight'),
    },
    {
      gates: {
        results: [
          { id: 'test-1', cmd: 'npm test', status: 'pass', exit_code: 0 },
          { id: 'e2e-1', cmd: 'npm run test:e2e', status: 'fail', exit_code: 1, first_failing_lines: 'flaky' },
        ],
      },
      report: 'written',
    },
  )
  assert.equal(result.verdict, 'PASS', 'a non-blocking e2e must not turn the run red by itself')
  assert.ok(result.findings.length > 0, 'but its failure is still reported')
})

test('every tier names all five lanes — an unnamed lane is ON', async () => {
  for (const [name, preset] of Object.entries(TIERS)) {
    assert.deepEqual(
      Object.keys(preset.lanes).sort(),
      ['behavior', 'defects', 'gates', 'peer', 'spec'],
      `${name} leaves a lane unnamed; note a MISSING behavior key resolves to "quick", not "off"`,
    )
  }
})

test('no tier ships an empty finders array — empty means all six lenses', async () => {
  for (const [name, preset] of Object.entries(TIERS)) {
    assert.ok(preset.finders.length > 0, `${name} would silently run every lens`)
  }
})

test('each tier spawns the lenses it promises', async () => {
  const expected = { ultralight: 0, light: 3, normal: 4, deep: 6 }
  for (const [name, count] of Object.entries(expected)) {
    const { calls } = await run(
      { tier: name, gates: DETECTED, config: resolveTier(name) },
      {
        matrix: { ...BASE_MATRIX, behaviors: [] },
        gates: PASSING_GATES,
        'find:': { findings: [] },
        spec: { verdicts: [], out_of_scope: [] },
        report: 'written',
      },
    )
    assert.equal(calls.filter((c) => c.startsWith('find:')).length, count, `${name} lens count`)
  }
})

test('by default no stage is pinned to a named model', async () => {
  const { seen } = await run(ultralightArgs(), { gates: PASSING_GATES })
  assert.ok(
    seen.every((o) => o.model === undefined),
    `pinned by default: ${JSON.stringify(seen.filter((o) => o.model))}`,
  )
})

test('pinning one stage reaches that stage and no other', async () => {
  const { seen } = await run(
    {
      tier: 'light',
      gates: DETECTED,
      config: { ...resolveTier('light'), models: { finders: 'fable' } },
    },
    {
      matrix: { ...BASE_MATRIX, behaviors: [] },
      gates: PASSING_GATES,
      'find:': { findings: [] },
      report: 'written',
    },
  )
  const finders = seen.filter((o) => o.label.startsWith('find:'))
  assert.ok(finders.length > 0 && finders.every((o) => o.model === 'fable'))
  assert.ok(seen.filter((o) => o.label === 'gates').every((o) => o.model === undefined))
})

// ------------------------------------------------------------------- lane E

// Lane C stays on: with spec, defects and behavior all off the workflow
// synthesizes the matrix, no gate is dispatched, and every verdict below would
// be UNPROVEN for a reason that has nothing to do with the peer.
const PEER_LANES = { gates: true, spec: false, defects: true, behavior: 'off', peer: true }

test('lane E does not run unless it was asked for', async () => {
  // Not merely "defaults to off". The other lanes are gated on `!== false`, so
  // an omitted key runs them; lane E is gated on `=== true` precisely so a
  // partial config cannot start spending a second vendor's tokens. Both shapes.
  for (const lanes of [
    { gates: true, spec: false, defects: false, behavior: 'off' },
    { gates: true, spec: false, defects: false, behavior: 'off', peer: false },
  ]) {
    const { calls } = await run(
      { config: { lanes, loop: { enabled: false }, finders: ['correctness'] } },
      { matrix: BASE_MATRIX, gates: PASSING_GATES, report: 'written' },
    )
    assert.ok(!calls.includes('peer:crosscheck'), `lane E ran with lanes=${JSON.stringify(lanes)}`)
  }
})

test('a peer finding is dispatched, judged, and can sink the verdict', async () => {
  const { result, calls } = await run(
    { config: { lanes: PEER_LANES, loop: { enabled: false }, finders: ['correctness'] } },
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'peer:crosscheck': {
        peer_status: 'ok',
        findings: [
          {
            file: 'src/app.ts',
            line: 2,
            defect: 'parse never validates input',
            failure_scenario: 'a null input reaches the sink',
            severity: 'blocking',
          },
        ],
      },
      // The peer gets no exemption from law 2. Its finding survives only because
      // this skeptic failed to refute it.
      'judge:': { refuted: false, reason: 'reachable', severity_adjustment: 'none' },
      report: 'written',
    },
  )
  assert.ok(calls.includes('peer:crosscheck'), 'lane E never dispatched')
  assert.ok(calls.some((c) => c.startsWith('judge:')), 'the peer finding skipped the skeptic')
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.findings[0].found_by[0], 'peer')
})

test('a peer finding a skeptic refutes does not reach the report', async () => {
  const { result } = await run(
    { config: { lanes: PEER_LANES, loop: { enabled: false }, finders: ['correctness'] } },
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'peer:crosscheck': {
        peer_status: 'ok',
        findings: [
          { file: 'src/app.ts', line: 2, defect: 'invented', failure_scenario: 'none', severity: 'blocking' },
        ],
      },
      'judge:': { refuted: true, reason: 'the guard is three lines up', severity_adjustment: 'none' },
      report: 'written',
    },
  )
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.refuted_count, 1)
})

test('an unreachable peer is named in residual risk, and never passes as crosschecked', async () => {
  // The whole value of the word. A run that never reached the peer must not be
  // indistinguishable from one where the peer looked and found nothing.
  const { result } = await run(
    { config: { lanes: PEER_LANES, loop: { enabled: false }, finders: ['correctness'] } },
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'peer:crosscheck': { peer_status: 'peer_unavailable', reason: 'codex is not authenticated', findings: [] },
      report: 'written',
    },
  )
  assert.ok(
    result.residual_risk.some((r) => /not crosschecked/.test(r)),
    `residual risk did not name the failed crosscheck: ${JSON.stringify(result.residual_risk)}`,
  )
  assert.equal(result.counts.blocking, 0, 'an unreachable peer must not contribute findings')
})

test('a peer that answered cleanly leaves no crosscheck warning behind', async () => {
  // The other direction of the same rule: a guard that only ever warns is one
  // nobody proved stays quiet when it should.
  const { result } = await run(
    { config: { lanes: PEER_LANES, loop: { enabled: false }, finders: ['correctness'] } },
    {
      matrix: BASE_MATRIX,
      gates: PASSING_GATES,
      'find:': { findings: [] },
      'peer:crosscheck': { peer_status: 'ok', findings: [] },
      report: 'written',
    },
  )
  assert.ok(!result.residual_risk.some((r) => /crosscheck/.test(r)))
})

test('a lane E that died contributes nothing and is not read as a clean crosscheck', async () => {
  // The stub returns null for an unscripted label — the harness's way of
  // modelling a lane that threw.
  const { result } = await run(
    { config: { lanes: PEER_LANES, loop: { enabled: false }, finders: ['correctness'] } },
    { matrix: BASE_MATRIX, gates: PASSING_GATES, report: 'written' },
  )
  assert.ok(result.lane_failures.some((f) => f.kind === 'peer'))
  assert.ok(result.residual_risk.some((r) => /not crosschecked/.test(r)))
})

export const meta = {
  name: 'verify',
  description: 'Prove produced work: run the real gates, check the plan, hunt defects, run the thing, refute every finding, then fix the blockers',
  whenToUse: 'After an implementation, before calling anything done. Invoked by the verify skill.',
  phases: [
    { title: 'Matrix', detail: 'turn the plan + diff into a targeted verification matrix' },
    { title: 'Lanes', detail: 'gates · plan conformance · defect hunt · behaviour proof, in parallel' },
    { title: 'Judge', detail: 'every candidate finding faces a skeptic paid to refute it' },
    { title: 'Report', detail: 'compact verdict up, full detail to disk' },
    { title: 'Fix', detail: 'repair blockers, guard against silencing repairs, re-verify' },
  ],
}

// ---------------------------------------------------------------- inputs

const A = args || {}
const cfg = A.config || {}
const models = cfg.models || {}
const efforts = cfg.effort || {}
const lanes = cfg.lanes || { gates: true, spec: true, defects: true, behavior: 'quick' }
const loopCfg = cfg.loop || { enabled: true, max_iterations: 3, fix_severity: 'blocking' }
// How many skeptics a candidate faces. Phase 0 resolves the tier into these.
const judgeCfg = { panel: 1, panel_blocking: 3, ...(cfg.judges || {}) }
// Named so the report can state it. A PASS at `light` bought less evidence than
// a PASS at `deep`, and a report that does not say which one ran hides that.
// Must match DEFAULT_TIER in scripts/tiers.mjs. The workflow body runs in a
// wrapper with no module resolution, so it cannot import the constant.
const tier = A.tier || cfg.tier || 'light'
const mode = A.mode || 'loop'
const diffCmd = A.diffCmd || 'git diff HEAD'
const cwd = A.cwd || '.'
const skillDir = A.skillDir || '.'
const reportDir = A.reportDir || '.agents/verify/run'
const planText = A.planText || ''
const planPath = A.planPath || ''
const baseline = A.baseline || 'HEAD'

function mdl(stage) {
  const m = models[stage]
  return !m || m === 'inherit' ? undefined : m
}

function eff(stage) {
  return efforts[stage] || undefined
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Untracked files appear in no diff. A lane told only about `git diff` would
// silently skip a brand-new module — which is where new defects live.
const untracked = A.untracked || []

const CONTEXT = [
  `Repo: ${cwd}`,
  `Diff under verification: \`${diffCmd}\``,
  untracked.length
    ? `Also under verification, as whole-file additions (they are untracked and appear in NO diff — read them directly):\n${untracked.map((f) => `  - ${f}`).join('\n')}`
    : '',
  planPath ? `Plan / promise: ${planPath}` : 'Plan / promise: none supplied — intent is inferred.',
]
  .filter(Boolean)
  .join('\n')

// ---------------------------------------------------------------- schemas

const MATRIX_SCHEMA = {
  type: 'object',
  required: ['promise_source', 'gates', 'requirements', 'behaviors', 'risk_areas'],
  properties: {
    promise_source: { type: 'string', enum: ['plan', 'issue', 'inferred'] },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'cmd', 'why', 'blocking'],
        properties: {
          id: { type: 'string' },
          cmd: { type: 'string' },
          why: { type: 'string' },
          blocking: { type: 'boolean' },
          timeout_s: { type: 'number' },
        },
      },
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'quote', 'how_to_check'],
        properties: {
          id: { type: 'string' },
          quote: { type: 'string' },
          files_expected: { type: 'array', items: { type: 'string' } },
          how_to_check: { type: 'string' },
        },
      },
    },
    behaviors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'claim', 'how_to_prove'],
        properties: {
          id: { type: 'string' },
          claim: { type: 'string' },
          how_to_prove: { type: 'string' },
        },
      },
    },
    risk_areas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'why'],
        properties: { path: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
}

const GATES_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'cmd', 'status'],
        properties: {
          id: { type: 'string' },
          cmd: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'not_run', 'timeout'] },
          exit_code: { type: ['number', 'null'] },
          duration_s: { type: 'number' },
          failures_count: { type: 'number' },
          first_failing_lines: { type: 'string' },
        },
      },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'defect', 'failure_scenario', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          defect: { type: 'string' },
          failure_scenario: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

// Lane E returns findings plus the one fact findings alone cannot carry: whether
// the peer answered at all. Without it, "the peer found nothing" and "the peer
// was never reached" arrive as the same empty array — and the second one has to
// reach RESIDUAL RISK, because a crosscheck that did not happen is not a clean
// crosscheck.
const PEER_SCHEMA = {
  type: 'object',
  required: ['peer_status', 'findings'],
  properties: {
    peer_status: { type: 'string', enum: ['ok', 'peer_unavailable', 'peer_output_invalid'] },
    reason: { type: 'string' },
    findings: FINDINGS_SCHEMA.properties.findings,
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['requirement_id', 'verdict'],
        properties: {
          requirement_id: { type: 'string' },
          verdict: { type: 'string', enum: ['implemented', 'partial', 'missing', 'contradicted'] },
          quote: { type: 'string' },
          evidence_file: { type: 'string' },
          evidence_line: { type: 'number' },
          missing_detail: { type: 'string' },
        },
      },
    },
    out_of_scope: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'what'],
        properties: { file: { type: 'string' }, line: { type: 'number' }, what: { type: 'string' } },
      },
    },
  },
}

const BEHAVIOR_SCHEMA = {
  type: 'object',
  required: ['behavior_id', 'proven'],
  properties: {
    behavior_id: { type: 'string' },
    proven: { type: 'string', enum: ['true', 'false', 'blocked'] },
    command: { type: 'string' },
    output_excerpt: { type: 'string' },
    reason_if_blocked: { type: 'string' },
    red_green: {
      type: 'array',
      items: {
        type: 'object',
        required: ['test_file', 'red_green'],
        properties: {
          test_file: { type: 'string' },
          test_name: { type: 'string' },
          red_green: { type: 'string', enum: ['pass', 'never_red', 'skipped'] },
          reverted_hunk: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    evidence_file: { type: 'string' },
    evidence_line: { type: 'number' },
    severity_adjustment: { type: 'string', enum: ['none', 'major', 'minor'] },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['fixed'],
  properties: {
    fixed: { type: 'boolean' },
    files_touched: { type: 'array', items: { type: 'string' } },
    summary_one_line: { type: 'string' },
    blocked_by: { type: 'string' },
  },
}

// The recheck must be able to say, per finding, whether the defect is gone.
// A gate-only schema structurally discards that answer.
const RECHECK_SCHEMA = {
  type: 'object',
  required: ['results', 'findings'],
  properties: {
    results: GATES_SCHEMA.properties.results,
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'gone'],
        properties: {
          id: { type: 'string' },
          gone: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const GUARD_SCHEMA = {
  type: 'object',
  required: ['verdict', 'violations'],
  properties: {
    verdict: { type: 'string', enum: ['CLEAN', 'FORBIDDEN'] },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rule', 'file'],
        properties: {
          rule: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          text: { type: 'string' },
        },
      },
    },
    raw: { type: 'string' },
  },
}

// ---------------------------------------------------------- phase 1: matrix

// Hoisted above the matrix: whether the planner is worth spawning depends on it.
const behaviorMode = lanes.behavior === undefined ? 'quick' : lanes.behavior

// The matrix exists to aim lanes B, C and D. With all three off, the only lane
// left reads its commands straight from detect-gates.mjs, and the planner is an
// agent spent to copy a list. Keyed on the lanes rather than on the tier name so
// it stays correct when a flag turns a lane back on: `--behavior quick` over
// ultralight needs a real matrix, and would otherwise iterate an empty
// behaviours array and report nothing, which is silence, not a clean result.
const synthesizeMatrix = lanes.spec === false && lanes.defects === false && behaviorMode === 'off'

// detect-gates.mjs returns {cwd, repo, packageManager, gates, ci, notes} — the
// ARRAY is A.gates.gates. Passing the wrapper object here makes .length
// undefined, the gates lane never runs, and the run returns a verdict over zero
// executed commands.
const detectedGates = (A.gates && Array.isArray(A.gates.gates) ? A.gates.gates : []).map((g) => ({
  id: g.id,
  cmd: g.cmd,
  why: 'detected',
  blocking: g.blocking !== false,
  timeout_s: g.timeout_s,
}))

if (!synthesizeMatrix) phase('Matrix')

const matrix = synthesizeMatrix
  ? {
      synthesized: true,
      // Not "inferred": nobody inferred anything. No promise was read.
      promise_source: 'not_checked',
      gates: detectedGates,
      requirements: [],
      behaviors: [],
      risk_areas: [],
    }
  : await agent(
      `${CONTEXT}

You are building a verification matrix: the specific list of things this change must be proven to do. You read metadata, not source — keep it cheap.

THE PROMISE
${
  planText
    ? planText.slice(0, 12000)
    : planPath
      ? `Read it from ${planPath}. That file is the promise this change must be measured against.`
      : '(none — infer intent from the commit messages and the diffstat, and set promise_source to "inferred")'
}

THE CHANGE
Run \`${diffCmd} --stat\` and \`git log --oneline\` for the same range. Read the file list, not the file contents.

THE DETECTED GATES
${JSON.stringify(A.gates || {}, null, 2)}

Produce the matrix:
- gates: keep the detected commands the diff could plausibly affect; drop the rest with no comment. Never invent a script name.
- requirements: one per verifiable clause of the promise, quoting it VERBATIM in "quote". A clause with two verbs is two requirements.
- behaviors: 2 to 5 claims that can be PROVEN BY RUNNING something. "how_to_prove" must be an executable procedure with real arguments, not a description. If a claim cannot be run, leave it out.
- risk_areas: where a defect would be most costly or most likely — biggest hunk, time/money arithmetic, auth, concurrency, migrations, public interfaces.`,
      {
        schema: MATRIX_SCHEMA,
        model: mdl('planner'),
        effort: eff('planner'),
        label: 'matrix',
        phase: 'Matrix',
      },
    )

// "0 requirements · 0 behaviours" would read as "the planner looked and found
// nothing" — the opposite of what happened, which is that nobody looked.
log(
  synthesizeMatrix
    ? `matrix: skipped — gates only (${matrix.gates.length} detected, none filtered out)`
    : `matrix: ${matrix.requirements.length} requirements · ${matrix.behaviors.length} behaviours · ${matrix.gates.length} gates · promise=${matrix.promise_source}`,
)

// ----------------------------------------------------------- phase 2: lanes

phase('Lanes')

const LENSES = {
  correctness:
    'Correctness and edge cases: off-by-one, empty or single-element input, boundary values, 0/""/null/NaN treated as absent, timezone and DST arithmetic, integer division, sort stability, locale-dependent comparison.',
  'failure-handling':
    'Failure handling: unhandled rejection, error thrown past a boundary that cannot catch it, retry without backoff, partial write with no rollback, resource never released, error message leaking a secret.',
  'state-async':
    'State and async: race between two awaits, missing await, shared mutable state across requests, cache never invalidated, effect firing twice, ordering assumed between independent promises.',
  'trust-input':
    'Trust and input: user input reaching a query/command/path/HTML sink, missing authorisation check on a new route, secret or token in code or logs, redirect target from user input, missing size limit on an upload or a loop.',
  wiring:
    'Wiring: new code that is unreachable — not exported, not imported, not registered, behind a flag never set, a route not mounted, a migration not run, a config key read from the wrong place.',
  leftovers:
    'Leftovers: TODO/FIXME added by this change, stub returning a constant, mock or fixture left in a production path, hardcoded localhost/API key/user id, console.log, commented-out code, dead branch.',
}

const finderLenses = (cfg.finders && cfg.finders.length ? cfg.finders : Object.keys(LENSES)).filter(
  (l) => LENSES[l],
)

const riskText = JSON.stringify(matrix.risk_areas)
const tasks = []
const kinds = []
const labels = []

function push(kind, label, thunk) {
  kinds.push(kind)
  labels.push(label)
  tasks.push(thunk)
}

// Lane A — gates
if (lanes.gates !== false && matrix.gates.length) {
  push('gates', 'gates', () =>
    agent(
      `${CONTEXT}

Run each command below from the repo root, in order. DO NOT fix anything. DO NOT interpret. Do not stop early unless a failure makes the next command meaningless (a failed build makes a test run meaningless; a failed lint does not).

Commands:
${matrix.gates.map((g) => `- ${g.id}: ${g.cmd} (timeout ${g.timeout_s || 300}s)`).join('\n')}

For each command report: status (pass | fail | not_run | timeout), exit_code, duration_s, failures_count, and at most 15 lines of output chosen to show the FIRST failure — not the summary tail.

A command whose tool is missing is not_run with the error in first_failing_lines. A command you did not run to completion is never "pass".`,
      { schema: GATES_SCHEMA, model: mdl('gates'), effort: eff('gates'), label: 'gates', phase: 'Lanes' },
    ),
  )
}

// Lane B — plan conformance
if (lanes.spec !== false && matrix.requirements.length) {
  for (const group of chunk(matrix.requirements, 3)) {
    push('spec', `spec:${group[0].id}`, () =>
      agent(
        `${CONTEXT}

Check these requirements against the diff. Read the relevant hunks with \`${diffCmd}\` and open the files where you need more than the hunk shows.

${group.map((r) => `- ${r.id}: "${r.quote}"\n  how to check: ${r.how_to_check}\n  expected around: ${(r.files_expected || []).join(', ') || 'unknown'}`).join('\n')}

For each, exactly one verdict: implemented (cite file:line) | partial (name precisely what is missing) | missing | contradicted.

Code that exists but is never reached is "partial" at best — a function defined and never called, a middleware written and never registered, a flag parsed and never read. Cite the call site or state there is none.

Also list behaviour in the diff no requirement asked for (out_of_scope) with file:line. A rename or added logging is not out of scope; a new endpoint, a new dependency or a changed default is.

Under 250 words total.`,
        { schema: SPEC_SCHEMA, model: mdl('spec'), effort: eff('spec'), label: `spec:${group[0].id}`, phase: 'Lanes' },
      ),
    )
  }
}

// Lane C — defect hunt
if (lanes.defects !== false) {
  for (const lens of finderLenses) {
    push('defects', `find:${lens}`, () =>
      agent(
        `${CONTEXT}

Lens: ${LENSES[lens]}

Read \`${diffCmd}\`, paying particular attention to these risk areas: ${riskText}

Report only defects in code this change ADDED or MODIFIED. A pre-existing problem the diff merely touched is out of scope unless the change made it reachable.

For each finding: file, line, defect in one sentence, failure_scenario, severity (blocking | major | minor), suggested_fix.

failure_scenario must be concrete — the input or state that triggers it and what goes wrong. "This could cause issues" is not a finding; if you cannot write the scenario, drop it. Style, naming and formatting are out of scope — a linter owns those.

blocking = wrong output, data loss, crash on a realistic path, security hole, or a promised requirement that does not work.
major = fails on a plausible but narrower path, or missing error handling on a path that will be hit.
minor = real but small.

At most 8 findings, ranked. Under 400 words.`,
        { schema: FINDINGS_SCHEMA, model: mdl('finders'), effort: eff('finders'), label: `find:${lens}`, phase: 'Lanes' },
      ),
    )
  }
}

// Lane D — behaviour proof (behaviorMode is resolved above, before the matrix)
if (behaviorMode !== 'off') {
  for (const b of matrix.behaviors) {
    push('behavior', `prove:${b.id}`, () =>
      agent(
        `${CONTEXT}

Claim to prove: ${b.claim}
Proof procedure: ${b.how_to_prove}

Do it for real. Start the server and hit it, run the CLI with real arguments, execute the script, invoke the single test that covers it. Capture the actual command and its actual output.

Never report proven "true" from reading the code. "blocked" is a legitimate and useful answer when there is no database, no credentials or no network — say what blocked you.

You are in a disposable worktree: you may create fixture files and run things. Do not commit.

Return behavior_id "${b.id}".`,
        {
          schema: BEHAVIOR_SCHEMA,
          model: mdl('finders'),
          effort: eff('finders'),
          label: `prove:${b.id}`,
          phase: 'Lanes',
          isolation: 'worktree',
        },
      ),
    )
  }

  if (behaviorMode === 'full') {
    push('behavior', 'prove:red-green', () =>
      agent(
        `${CONTEXT}

Red-green audit. A test written alongside a fix and never seen to fail proves the code compiles, not that it works.

For each test file added or modified by \`${diffCmd}\`:
1. Identify the source hunk that test is supposed to cover.
2. Revert that hunk IN THIS WORKTREE ONLY.
3. Run that single test.
4. Restore the worktree before the next test.

Record per test: red_green = "pass" (it failed as it should), "never_red" (it still passed — the test does not exercise the change), or "skipped" (could not isolate the hunk; give the reason). Include the reverted hunk.

You are in a disposable worktree. Never touch the user's working tree. Do not commit.

Return behavior_id "red-green" and proven "true" if every audited test went red, else "false".`,
        {
          schema: BEHAVIOR_SCHEMA,
          model: mdl('finders'),
          effort: eff('finders'),
          label: 'prove:red-green',
          phase: 'Lanes',
          isolation: 'worktree',
        },
      ),
    )
  }
}

// Lane E — peer crosscheck. Opt-in only (`peer: true`), never inherited from a
// partial `lanes` object: it spends a second vendor's tokens, and a lane that
// costs money elsewhere may not switch itself on by defaulting.
//
// It is not a finder. It contributes candidates like any other lane and they
// face the same skeptics in Phase 3 — a second model's opinion is still an
// opinion, and law 2 has no vendor exemption.
if (lanes.peer === true) {
  push('peer', 'peer:crosscheck', () =>
    agent(
      `${CONTEXT}

Consult the other CLI agent for an independent second opinion on this diff, then report what it said.

1. Read ${skillDir}/references/crosscheck.md. Build the diff brief exactly as written there, substituting the repo root, the fixed point and the intended change. Write it to ${reportDir}/peer-prompt.txt.
2. Run, from ${cwd}:

   node ${skillDir}/scripts/peer-run.mjs --host ${A.host || 'unresolved'} --mode diff --cwd ${cwd} --prompt ${reportDir}/peer-prompt.txt --schema ${skillDir}/scripts/schema-diff.json --out ${reportDir}/peer

3. Read the JSON it prints on stdout. It has already dropped every finding whose citation did not hold up; those are listed in \`rejected_citations\` and you must not resurrect them.

If the host above reads "unresolved", Phase 0 could not say which agent this is running inside. The script will refuse it. Do not substitute a guess: asking a CLI to consult itself is not a crosscheck, and reporting one that did not happen is the single thing this lane must never do.

Return \`peer_status\` exactly as the script reported it, plus \`reason\` when it is not "ok".

If \`status\` is anything other than "ok", return an empty findings array. Do not retry, do not fall back to reviewing the diff yourself, and do not describe your own reading as a peer opinion — the lane reporting nothing is the correct outcome, and the report says the crosscheck did not happen.

If \`status\` is "ok", translate each surviving finding into this shape, changing nothing about its substance: file = location.path, line = location.line, defect = claim, failure_scenario, severity ("blocking" stays blocking, "material" becomes "major"), suggested_fix.

Report only what the peer actually returned. You are a courier here, not a reviewer: do not add findings of your own, drop ones you disagree with, or soften a claim. A skeptic judges them next.`,
      { schema: PEER_SCHEMA, model: mdl('finders'), effort: eff('finders'), label: 'peer:crosscheck', phase: 'Lanes' },
    ),
  )
}

const laneResults = await parallel(tasks)

const gateResults = []
const specVerdicts = []
const outOfScope = []
const behaviors = []
const redGreen = []
let candidates = []
// Null when lane E never ran, so an ordinary run says nothing about a
// crosscheck nobody asked for.
let peerStatus = lanes.peer === true ? 'peer_unavailable' : null
let peerReason = lanes.peer === true ? 'the lane returned nothing' : ''

// A lane that died is not a lane that found nothing. Track the failures so the
// report names them instead of quietly showing an empty section.
const laneFailures = []

laneResults.forEach((res, i) => {
  if (!res) {
    laneFailures.push({ kind: kinds[i], label: labels[i] })
    return
  }
  const kind = kinds[i]
  if (kind === 'gates') {
    gateResults.push(...(res.results || []))
  } else if (kind === 'spec') {
    specVerdicts.push(...(res.verdicts || []))
    outOfScope.push(...(res.out_of_scope || []))
  } else if (kind === 'defects' || kind === 'peer') {
    if (kind === 'peer') {
      peerStatus = res.peer_status || 'peer_output_invalid'
      peerReason = res.reason || ''
      // A peer that could not be reached returns no candidates. Anything the
      // lane still carries in that case did not come from the peer.
      if (peerStatus !== 'ok') return
    }
    candidates.push(...(res.findings || []).map((f) => ({ ...f, found_by: [kinds[i]] })))
  } else if (kind === 'behavior') {
    behaviors.push(res)
    redGreen.push(...(res.red_green || []))
  }
})

// Failed gates and missing requirements are findings too — they are evidence-backed,
// so they enter the pool already carrying their proof.
// Whether a gate's failure is allowed to turn the whole run red. Used both for
// the severity of its finding and for gatesGreen, which must agree — otherwise a
// non-blocking gate stops sinking the verdict one way and keeps sinking it the
// other.
const blockingById = new Map(matrix.gates.map((g) => [g.id, g.blocking !== false]))

for (const g of gateResults) {
  // `not_run` sinks gatesGreen below, so leaving it out of the pool produced a
  // FAIL with zero findings and nothing to show — the emptiest possible
  // failure, and the likeliest one on a repo whose dependencies are not
  // installed. A gate that could not run is a finding that names the command.
  if (g.status === 'fail' || g.status === 'timeout' || g.status === 'not_run') {
    const couldNotRun = g.status === 'not_run'
    candidates.push({
      // Keyed per gate: a shared `file` lets dedupe below collapse a red
      // typecheck and a red test into one finding, and the fix round then reads
      // "fix these defects in gate".
      file: `gate:${g.id}`,
      line: 0,
      defect: couldNotRun
        ? `Gate ${g.id} could not run: \`${g.cmd}\``
        : `Gate ${g.id} (${g.cmd}) ${g.status} with exit ${g.exit_code}`,
      failure_scenario: couldNotRun
        ? `\`${g.cmd}\` did not execute, so this gate proves nothing. ${(g.first_failing_lines || '').slice(0, 300)}`.trim()
        : (g.first_failing_lines || '').slice(0, 500),
      severity: blockingById.get(g.id) === false ? 'major' : 'blocking',
      from_gate: g.id,
      found_by: ['gates'],
    })
  }
}

// A behaviour disproven by running it is the strongest evidence the pipeline
// produces. A run beats an argument, so it enters as machine truth and never
// faces a skeptic.
for (const b of behaviors) {
  if (b && b.proven === 'false') {
    candidates.push({
      file: b.command ? `behaviour: ${b.command}`.slice(0, 120) : `behaviour ${b.behavior_id}`,
      line: 0,
      defect: `Behaviour ${b.behavior_id} was run and does not work`,
      failure_scenario: (b.output_excerpt || 'The proof procedure produced the wrong result.').slice(0, 500),
      severity: 'blocking',
      from_behavior: b.behavior_id,
      found_by: ['behavior'],
    })
  }
}

for (const v of specVerdicts) {
  if (v.verdict === 'missing' || v.verdict === 'contradicted') {
    candidates.push({
      file: v.evidence_file || planPath || 'plan',
      line: v.evidence_line || 0,
      defect: `Requirement ${v.requirement_id} is ${v.verdict}: "${(v.quote || '').slice(0, 160)}"`,
      failure_scenario: v.missing_detail || 'The promise is not met by the change.',
      severity: 'blocking',
      from_spec: v.requirement_id,
      found_by: ['spec'],
    })
  }
}

for (const rg of redGreen) {
  if (rg.red_green === 'never_red') {
    candidates.push({
      file: rg.test_file,
      line: 0,
      defect: `Test "${rg.test_name || rg.test_file}" still passes with the change reverted — it does not exercise the change`,
      failure_scenario: `Reverted ${rg.reverted_hunk || 'the covered hunk'} and the test stayed green, so a regression here would ship unnoticed.`,
      severity: 'major',
      found_by: ['red-green'],
    })
  }
}

// An exit code is not an opinion, and a behaviour that was run and failed is not
// an argument to be refuted. Declared here because dedupe below needs it, and a
// const is not hoisted.
const isMachineTruth = (f) => Boolean(f.from_gate || f.from_behavior)

// Dedup: two lenses finding one bug is confidence, not two bugs.
//
// Machine truth is exempt. A gate result and a disproven behaviour are not
// opinions that can agree with each other — they are separate executed
// commands, each with its own exit code, and merging two of them destroys the
// evidence for one.
function dedupe(items) {
  const out = []
  for (const f of items) {
    if (isMachineTruth(f)) {
      out.push({ ...f })
      continue
    }
    const twin = out.find(
      (o) => !isMachineTruth(o) && o.file === f.file && Math.abs((o.line || 0) - (f.line || 0)) <= 3,
    )
    if (twin) {
      twin.found_by = [...new Set([...(twin.found_by || []), ...(f.found_by || [])])]
      const rank = { blocking: 3, major: 2, minor: 1 }
      if (rank[f.severity] > rank[twin.severity]) twin.severity = f.severity
    } else {
      out.push({ ...f })
    }
  }
  return out
}

candidates = dedupe(candidates).map((f, i) => ({ ...f, id: `F${i + 1}` }))
log(
  `lanes done: ${gateResults.length} gates run · ${candidates.length} candidate findings${laneFailures.length ? ` · ${laneFailures.length} lane(s) FAILED: ${laneFailures.map((l) => l.label).join(', ')}` : ''}`,
)

// ---------------------------------------------------------- phase 3: judge

phase('Judge')

const ANGLES = [
  'Is it reachable? Trace from a real entry point. If no caller can produce that state, the claim dies.',
  'Is it already handled? Look upstream for validation, a type that makes the state impossible, a caller that guards it, or a test that covers exactly this.',
  'Does the scenario actually produce that outcome? Follow the described input through the code and check the claimed consequence really follows.',
]

// Machine truth does not face a skeptic: an exit code is not an opinion, and a
// behaviour that was run and failed is not an argument to be refuted.
const machineTruth = candidates.filter(isMachineTruth)
const toJudge = candidates.filter((f) => !isMachineTruth(f))

const judged = await parallel(
  toJudge.map((f) => () => {
    // A panel is the most expensive thing this workflow does: N agents per
    // finding, each reading the code. The tier decides how much of that a
    // blocking claim is worth — never fewer than one skeptic, per law 2.
    const panel = Math.max(
      1,
      Number(f.severity === 'blocking' ? judgeCfg.panel_blocking : judgeCfg.panel) || 1,
    )
    const skeptics = []
    for (let i = 0; i < panel; i++) {
      const angle = panel > 1 ? ANGLES[i % ANGLES.length] : 'Find the reason this claim is wrong.'
      skeptics.push(() =>
        agent(
          `${CONTEXT}

A reviewer claims this is a defect:
- File: ${f.file}:${f.line}
- Defect: ${f.defect}
- Failure scenario: ${f.failure_scenario}

Your job is to REFUTE it. Angle: ${angle}

Read the actual code — the file, its callers, its tests, the types involved. Claims collapse for ordinary reasons: input validated upstream, type makes the state unreachable, a caller already handles it, the branch is dead, a test covers it, the reviewer misread which variable is in scope, the behaviour is intentional.

Answer refuted: true with the reason and the file:line that proves it — or refuted: false with the shortest concrete path from a real entry point to the failure. If you cannot write that path, the claim is unproven: return refuted true, reason "no reachable path".

Default to refuted when uncertain. A defect nobody can reach is not a defect.

You may return severity_adjustment to DOWNGRADE a real but narrower finding. Never upgrade.`,
          {
            schema: VERDICT_SCHEMA,
            model: mdl('judges'),
            effort: eff('judges'),
            label: `judge:${f.file}:${f.line}`,
            phase: 'Judge',
          },
        ),
      )
    }
    return parallel(skeptics).then((votes) => {
      const valid = votes.filter(Boolean)
      // Majority of the panel that actually returned. A finding needs survivors,
      // so agents that died do not count as votes to keep it.
      const survives = valid.filter((v) => !v.refuted).length >= Math.ceil(panel / 2)
      const down = valid.map((v) => v.severity_adjustment).find((s) => s && s !== 'none')
      return {
        ...f,
        survives,
        severity: survives && down ? down : f.severity,
        votes: valid,
      }
    })
  }),
)

const judgedOk = judged.filter(Boolean)

const survivors = [
  ...machineTruth.map((f) => ({ ...f, survives: true, votes: [] })),
  ...judgedOk.filter((f) => f.survives),
]

const refuted = judgedOk.filter((f) => !f.survives)

const RANK = { blocking: 0, major: 1, minor: 2 }
survivors.sort((a, b) => RANK[a.severity] - RANK[b.severity])

log(`judged: ${survivors.length} findings survived · ${refuted.length} refuted`)

// --------------------------------------------------------- phase 4: report

phase('Report')

function counts(list) {
  return {
    blocking: list.filter((f) => f.severity === 'blocking').length,
    major: list.filter((f) => f.severity === 'major').length,
    minor: list.filter((f) => f.severity === 'minor').length,
  }
}

const requirementSummary = {
  implemented: specVerdicts.filter((v) => v.verdict === 'implemented').length,
  partial: specVerdicts.filter((v) => v.verdict === 'partial').length,
  missing: specVerdicts.filter((v) => v.verdict === 'missing').length,
  contradicted: specVerdicts.filter((v) => v.verdict === 'contradicted').length,
  out_of_scope: outOfScope.length,
}

const keepRuns = (cfg.report && cfg.report.keep_runs) || 10

const runState = {
  mode,
  tier,
  judges: judgeCfg,
  promise_source: matrix.promise_source,
  matrix,
  detected_gates: A.gates || {},
  lane_failures: laneFailures,
  // A lane E that answered "unavailable" did not die, so `lane_failures` stays
  // empty and the reporter would have no way to know the crosscheck never
  // happened. The conversation says so; without this the file on disk would not.
  peer_crosscheck: peerStatus ? { status: peerStatus, reason: peerReason } : null,
  gates: gateResults,
  requirements: { summary: requirementSummary, verdicts: specVerdicts, out_of_scope: outOfScope },
  behaviors,
  red_green: redGreen,
  findings: survivors,
  refuted,
  counts: counts(survivors),
}

// Nothing survived and no lane died, so there is no detail to write down: the
// verdict, the tier and the gate table are the whole report, and the main
// context writes those itself for free. Provably final here — with no
// survivors, pending() is empty, the fix loop never starts, and nothing below
// can change the outcome. Keyed on evidence rather than on the tier, because a
// green `deep` run has just as little to say.
const reportWorthWriting = survivors.length > 0 || laneFailures.length > 0

if (reportWorthWriting)
  await agent(
    `Write this verification run to disk. Four files, nothing else, no commentary.

1. ${reportDir}/REPORT.md — the full report in Markdown:
   - Verdict line and counts. State the tier (\`tier\` in the data below) on that line: a PASS at a cheap tier bought less evidence than a PASS at a deep one, and a report that does not say which ran hides that.
   - EVIDENCE: every gate as a row — id, command, status, exit code, and its first failing lines verbatim for anything that did not pass.
   - FINDINGS: every survivor, grouped blocking / major / minor, each with file:line, the defect, the failure scenario, the suggested fix, and which lenses found it.
   - REQUIREMENTS: the per-requirement verdict table, plus out-of-scope items.
   - BEHAVIOUR: what was proven by running, what was blocked and why. Red-green results if present.
   - REFUTED: each refuted candidate with the skeptic's reason, so a wrong kill is auditable.
   - RESIDUAL RISK: what was NOT verified and why — gates not run, behaviours blocked, lanes that FAILED (see lane_failures — a lane that died found nothing because it never ran, and that is not the same as a clean result), lanes disabled, requirements checked only by reading. If peer_crosscheck is present and its status is not "ok", say the run was NOT crosschecked and give the reason: that lane answered, so it is absent from lane_failures, and silence here would read as a peer that looked and agreed.

2. ${reportDir}/findings.json — the object below, verbatim, as JSON.
3. ${reportDir}/matrix.json — the matrix field of that object, as JSON.
4. ${reportDir}/gates.json — the detected_gates field of that object, as JSON.

Then prune: keep only the ${keepRuns} most recent run directories under ${reportDir}/.. and delete the older ones.

Create the directory if needed. Report back only the four paths.

DATA:
${JSON.stringify(runState).slice(0, 400000)}`,
    { model: mdl('reporter'), effort: eff('reporter'), label: 'report', phase: 'Report' },
  )

// ------------------------------------------------------------ phase 5: fix

const iterations = []
let stoppedBy = null

const wantsLoop = mode === 'loop' && loopCfg.enabled !== false
const fixSeverity = loopCfg.fix_severity || 'blocking'
const maxIter = loopCfg.max_iterations || 3

function toFix(list) {
  if (fixSeverity === 'all') return list
  if (fixSeverity === 'major') return list.filter((f) => f.severity !== 'minor')
  return list.filter((f) => f.severity === 'blocking')
}

// Drive the loop on what it is configured to repair, not on blockers alone —
// otherwise `fix_severity: "major"` never enters the loop when nothing blocks.
const pending = () => toFix(survivors).filter((f) => !f.resolved)

if (wantsLoop && pending().length) phase('Fix')

let iteration = 0
while (wantsLoop && pending().length && iteration < maxIter && !stoppedBy) {
  iteration++

  const target = pending()
  const byFile = {}
  for (const f of target) {
    const key = f.file || 'unknown'
    byFile[key] = byFile[key] || []
    byFile[key].push(f)
  }

  const fileKeys = Object.keys(byFile)
  const fixes = await parallel(
    fileKeys.map((file) => () =>
      agent(
        `${CONTEXT}

Fix these defects in ${file} and nothing else:

${byFile[file].map((f) => `- [${f.id}] ${f.file}:${f.line} — ${f.defect}\n  fails when: ${f.failure_scenario}\n  direction: ${f.suggested_fix || 'none given'}`).join('\n')}

Make the smallest change that makes each failure scenario impossible. Match the surrounding code's style. Do not commit.

YOU MAY NOT: skip, delete, weaken or .only a test; change an expected value to match what the code produces; add @ts-ignore, @ts-expect-error, eslint-disable, # type: ignore or # noqa; widen a type to any or "unknown as"; swallow an error in an empty catch; edit a gate command, a CI workflow, a Makefile target, or the plan file.

If the only way to satisfy the gate is one of those, STOP and return fixed: false with blocked_by describing what would be required. That answer is correct and useful — a silenced checker is not a fix.

Return fixed: true only if you actually changed code that resolves every defect listed above.`,
        { schema: FIX_SCHEMA, model: mdl('fixer'), effort: eff('fixer'), label: `fix:${file}`, phase: 'Fix' },
      ),
    ),
  )

  // A fixer that failed, returned null, or reported fixed:false has NOT fixed
  // its findings. Stamping them resolved anyway is how a loop returns PASS over
  // a defect that is still in the code.
  const fixedFiles = new Set()
  fixes.forEach((res, i) => {
    if (res && res.fixed === true) fixedFiles.add(fileKeys[i])
  })

  const validFixes = fixes.filter(Boolean)
  const blockedFix = validFixes.find((f) => !f.fixed && f.blocked_by)

  // The guard runs regardless of what the fixers claim they did.
  const guard = await agent(
    `Run exactly this and return its JSON output:

node ${skillDir}/scripts/forbidden-repairs.mjs --since ${baseline}${planPath ? ` --plan ${planPath}` : ''} --pretty

Set verdict from the output's "verdict" field and copy its violations. Do not edit any file. Do not interpret — transcribe.`,
    { schema: GUARD_SCHEMA, model: mdl('gates'), effort: 'low', label: 'guard', phase: 'Fix' },
  )

  if (guard && guard.verdict === 'FORBIDDEN') {
    await agent(
      `The fix round introduced forbidden repairs. Revert exactly these hunks and nothing else, leaving the legitimate parts of the round in place:

${JSON.stringify(guard.violations, null, 2)}

Use \`git checkout -p\` or restore the file and re-apply the clean hunks. Report what you reverted.`,
      { model: mdl('fixer'), label: 'revert-forbidden', phase: 'Fix' },
    )
    stoppedBy = `forbidden-repair: ${guard.violations.map((v) => `${v.rule} @ ${v.file}`).join(', ')}`
    iterations.push({ iteration, fixes: validFixes, guard, stopped: stoppedBy })
    break
  }

  if (blockedFix) {
    stoppedBy = `unfixable-without-design-change: ${blockedFix.blocked_by}`
    iterations.push({ iteration, fixes: validFixes, guard, stopped: stoppedBy })
    break
  }

  // Re-run the gates the fixes could have touched, and re-check each finding.
  const recheck = await agent(
    `${CONTEXT}

A fix round just ran against these defects:
${target.map((f) => `- [${f.id}] ${f.file}:${f.line} — ${f.defect}\n  fails when: ${f.failure_scenario}`).join('\n')}

1. Re-run these gates and report each result honestly:
${matrix.gates.map((g) => `- ${g.id}: ${g.cmd}`).join('\n')}

2. For EACH defect id above, decide whether it is genuinely gone — by reading the new code, and by running a command where one proves it. Report gone: false when the code is unchanged, when the change does not address the failure scenario, or when you cannot tell. "I could not verify" is gone: false.

Fix nothing yourself. A gate you did not run to completion is never "pass".`,
    { schema: RECHECK_SCHEMA, model: mdl('gates'), effort: eff('gates'), label: `regate:${iteration}`, phase: 'Fix' },
  )

  const gateRows = recheck && recheck.results ? recheck.results : []
  const stillFailing = gateRows.filter((g) => g.status === 'fail' || g.status === 'timeout')
  const goneById = {}
  for (const r of (recheck && recheck.findings) || []) goneById[r.id] = r.gone === true

  // Resolved requires BOTH: the fixer said it fixed the file, and the recheck
  // confirms the defect is gone. Either alone is a claim, not evidence.
  for (const f of target) {
    f.attempts = (f.attempts || 0) + 1
    const claimed = fixedFiles.has(f.file || 'unknown')
    const confirmed = f.from_gate ? !stillFailing.some((g) => g.id === f.from_gate) : goneById[f.id] === true
    f.resolved = claimed && confirmed
  }

  const unresolved = target.filter((f) => !f.resolved)

  // New gate failures the round introduced enter as fresh machine truth.
  const known = new Set(survivors.filter((f) => f.from_gate).map((f) => f.from_gate))
  const regressions = stillFailing
    .filter((g) => !known.has(g.id))
    .map((g, i) => ({
      id: `G${iteration}-${i + 1}`,
      file: 'gate',
      line: 0,
      defect: `Gate ${g.id} (${g.cmd}) ${g.status} with exit ${g.exit_code} after the fix round`,
      failure_scenario: (g.first_failing_lines || '').slice(0, 500),
      severity: 'blocking',
      from_gate: g.id,
      found_by: ['gates'],
    }))
  survivors.push(...regressions)

  iterations.push({
    iteration,
    fixes: validFixes,
    guard,
    gates: gateRows,
    resolved: target.filter((f) => f.resolved).map((f) => f.id),
    unresolved: unresolved.map((f) => f.id),
    regressions: regressions.map((f) => f.from_gate),
  })

  log(
    `iteration ${iteration}/${maxIter} — ${target.length - unresolved.length}/${target.length} resolved · ${unresolved.length} still open · ${regressions.length} new · ${gateRows.map((g) => `${g.id} exit ${g.exit_code}`).join(', ')}`,
  )

  // Thrashing: a finding attempted twice and still not gone will not be gone on
  // the third try. Stop and say so rather than burning the iteration budget.
  const stuck = unresolved.filter((f) => f.attempts >= 2)
  if (stuck.length) {
    stoppedBy = `not-resolved-after-${stuck[0].attempts}-attempts: ${stuck.map((f) => `${f.file}:${f.line}`).join(', ')}`
  }
}

// The final gate run is fresh and complete. Partial evidence is how a loop
// convinces itself it is green.
let finalGates = gateResults
if (wantsLoop && iteration > 0 && !stoppedBy && !pending().length && matrix.gates.length) {
  const final = await agent(
    `${CONTEXT}

Final verification run. Run EVERY gate below from scratch, to completion, in order. Nothing incremental, nothing cached, no fixing.

${matrix.gates.map((g) => `- ${g.id}: ${g.cmd}`).join('\n')}

Report each honestly. A command you did not run to completion is never "pass".`,
    { schema: GATES_SCHEMA, model: mdl('gates'), effort: eff('gates'), label: 'final-gates', phase: 'Fix' },
  )
  if (final && final.results) finalGates = final.results
}

const finalBlocking = survivors.filter((f) => f.severity === 'blocking' && !f.resolved)

// A gate the detector marked non-blocking — e2e by default — must not sink the
// verdict on its own. Its failure is still reported as a finding, at `major`;
// it just does not turn the run red. Without this, `blocking` was a field
// nothing read, and the planner's filtering was the only thing hiding that.
const gatesGreen = finalGates.every(
  (g) => g.status === 'pass' || blockingById.get(g.id) === false,
)

// Law 1, enforced rather than assumed: with no gate that ran to completion and
// no behaviour proven by running, there is nothing to call this green with.
// "Nothing broke" and "nothing was checked" must not print the same word.
const ranSomething =
  finalGates.some((g) => g.status === 'pass' || g.status === 'fail') ||
  behaviors.some((b) => b && b.proven === 'true')

const verdict = stoppedBy || finalBlocking.length || !gatesGreen
  ? 'FAIL'
  : ranSomething
    ? 'PASS'
    : 'UNPROVEN'

// Named so the caller can print it, and so a cheap run cannot pass silently as
// a thorough one. A lane that was switched off found nothing because nobody
// looked, which is not the same as a clean result.
const residualRisk = [
  ...(lanes.spec === false ? ['plan conformance — lane not run'] : []),
  ...(lanes.defects === false ? ['defect hunt — lane not run'] : []),
  ...(behaviorMode === 'off' ? ['behaviour proof — nothing was run to prove it works'] : []),
  // Asked for and not delivered. Silence here would let a run that never
  // reached the peer be read as one the peer signed off on.
  ...(peerStatus && peerStatus !== 'ok'
    ? [`peer crosscheck did not happen (${peerStatus}${peerReason ? `: ${peerReason}` : ''}) — this run was not crosschecked`]
    : []),
  ...(synthesizeMatrix
    ? ['gates were not filtered to the diff — an unrelated pre-existing failure fails this run']
    : []),
  ...finalGates.filter((g) => g.status === 'not_run').map((g) => `gate ${g.id} could not run`),
]

return {
  verdict,
  tier,
  // null means nobody wrote a file — the caller must write its own short report
  // rather than print a path to something that does not exist.
  report_path: reportWorthWriting ? `${reportDir}/REPORT.md` : null,
  residual_risk: residualRisk,
  stopped_by: stoppedBy,
  lane_failures: laneFailures,
  counts: counts(survivors.filter((f) => !f.resolved)),
  refuted_count: refuted.length,
  gates: finalGates,
  findings: survivors.filter((f) => !f.resolved),
  fixed: survivors.filter((f) => f.resolved).map((f) => `${f.file}:${f.line} — ${f.defect}`),
  requirements: requirementSummary,
  requirement_detail: specVerdicts,
  out_of_scope: outOfScope,
  behaviors: behaviors.map((b) => ({
    id: b.behavior_id,
    proven: b.proven,
    reason: b.reason_if_blocked,
  })),
  red_green: redGreen,
  promise_source: matrix.promise_source,
  iterations,
}

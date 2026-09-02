export const meta = {
  name: 'build',
  description:
    'Execute an approved plan step by step: one implementer per step in dependency waves, a reviewer and the forbidden-repairs guard on each, then hand off to verify',
  whenToUse: 'After a blueprint plan is approved. Invoked by the build skill; never on its own.',
  phases: [
    { title: 'Steps', detail: 'implement each S-xxx in dependency waves, review it, run its Verify command' },
    { title: 'Guard', detail: 'forbidden-repairs on the diff after every step — a cheat stops the build' },
    { title: 'Handoff', detail: 'the step table, and the /verify call that proves the whole' },
  ],
}

// ---------------------------------------------------------------- inputs

// Everything here was resolved by Phase 0. The workflow receives values, not
// policy: the steps come from plan-steps.mjs, the waves too, the worktree
// exists, the baseline is a stash SHA. Nothing below re-derives any of it.
const A = args || {}
const cwd = A.cwd || '.'
const planPath = A.planPath || ''
const steps = Array.isArray(A.steps) ? A.steps : []
const waves = Array.isArray(A.waves) && A.waves.length ? A.waves : steps.map((s) => [s.id])
const skillDir = A.skillDir || '.'
const runDir = A.runDir || '.agents/build/run'
const baseline = A.baseline || 'HEAD'
const mode = A.mode === 'peer' ? 'peer' : 'workflow'
const host = A.host || null
const cfg = A.config || {}
const models = cfg.models || {}
const efforts = cfg.effort || {}
const peerTimeoutMs = (cfg.peer && cfg.peer.timeout_ms) || 900000
// One retry with the reviewer's issues, then blocked. A step that two attempts
// could not land is a step the plan under-specified, and a third try is a
// third guess.
const maxAttempts = (cfg.steps && cfg.steps.max_attempts) || 2

function mdl(stage) {
  const m = models[stage]
  return !m || m === 'inherit' ? undefined : m
}
function eff(stage) {
  return efforts[stage] || undefined
}

const byId = new Map(steps.map((s) => [s.id, s]))
const state = new Map()
for (const s of steps)
  state.set(s.id, {
    id: s.id,
    title: s.title,
    status: 'pending',
    verify_cmd: s.verifyCmd,
    exit_code: null,
    attempts: 0,
    files_touched: [],
    notes: null,
  })
const skipped = []
let stoppedBy = null
let peerFailure = null

const CONTEXT = [
  `Repo — an isolated worktree, the only place you may write: ${cwd}`,
  `Plan — the promise this build is held to: ${planPath}`,
  `Run every command from ${cwd}. Do not commit.`,
].join('\n')

const FORBIDDEN = `YOU MAY NOT: skip, delete, weaken or .only a test; change an expected value to match what the code produces; add @ts-ignore, @ts-expect-error, eslint-disable, # type: ignore or # noqa; widen a type to any or "unknown as"; swallow an error in an empty catch; edit a gate command, a CI workflow, a Makefile target, or the plan file; commit; renumber or rename a step.

If the step cannot be completed without one of those, STOP and return done_claimed: false with blocked_by describing what would be required. That answer is correct and useful — a step landed by silencing its own proof is not landed.`

// --------------------------------------------------------------- schemas

const STEP_SCHEMA = {
  type: 'object',
  required: ['done_claimed', 'files_touched', 'verify_cmd', 'verify_exit_code', 'verify_output'],
  properties: {
    done_claimed: { type: 'boolean' },
    files_touched: { type: 'array', items: { type: 'string' } },
    verify_cmd: { type: 'string' },
    verify_exit_code: { type: 'number' },
    verify_output: { type: 'string' },
    notes: { type: 'string' },
    blocked_by: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['spec_ok', 'quality_ok', 'verify_exit_code', 'verify_output', 'issues'],
  properties: {
    spec_ok: { type: 'boolean' },
    quality_ok: { type: 'boolean' },
    verify_exit_code: { type: 'number' },
    verify_output: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'issue', 'kind'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          issue: { type: 'string' },
          kind: { type: 'string', enum: ['spec', 'quality', 'scope'] },
        },
      },
    },
    summary: { type: 'string' },
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
        required: ['rule', 'file', 'line'],
        properties: {
          rule: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          text: { type: 'string' },
        },
      },
    },
  },
}

const PEER_STEP_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ok', 'peer_unavailable', 'peer_output_invalid'] },
    reason: { type: 'string' },
    files_touched: { type: 'array', items: { type: 'string' } },
    duration_ms: { type: 'number' },
    last_message: { type: 'string' },
  },
}

// ---------------------------------------------------------------- briefs

function implBrief(step, feedback) {
  return `${CONTEXT}

Implement exactly this step of the plan, and nothing else. The plan is the promise; this step is your whole scope.

${step.raw}

Rules:
- Touch only the files the step names under Files:. A file it does not name belongs to another step.
- Never guess a path or a symbol — open the file. The plan cites what it depends on; if a cited fact is wrong, say so in notes and stop rather than improvising.
- When the change is in, run the Verify command exactly as written, from ${cwd}:
    ${step.verifyCmd}
  Expected: ${step.verifyExpected || 'see the step'}
- Report its exit code and the first 15 lines of its output verbatim. A command you did not run to completion has no exit code: report -1 and say why in notes.
- done_claimed is true only if the Verify command exited 0 AND every bullet under Change is in place.

${FORBIDDEN}${
    feedback
      ? `

A reviewer rejected the previous attempt. Address every item below; do not argue with it in prose, change the code:
${feedback}`
      : ''
  }`
}

function reviewBrief(step) {
  const files = step.files && step.files.length ? step.files.map((f) => `"${f}"`).join(' ') : '.'
  return `${CONTEXT}

Review the change just made for this step. You may read anything and run commands; you may not edit a file.

${step.raw}

1. Spec — read the diff (\`git diff ${baseline} -- ${files}\` plus any untracked file under those paths; untracked files appear in no diff, so list them with \`git status --porcelain\`). For every bullet under Change: is it present? Is everything under Preserve untouched? Was any file outside Files: modified for this step?
2. Quality — does the change follow the surrounding code's conventions, handle the failure cases the step implies, and leave no debug output, TODO, or dead code behind?
3. Proof — run the Verify command yourself, exactly as written, from ${cwd}:
    ${step.verifyCmd}
   Report its exit code and the first 15 lines of its output. The implementer's own report is a claim; your run is the evidence.

spec_ok is true only when every Change bullet is present and Preserve holds. quality_ok is true only when nothing under 2 needs fixing. Every issue carries file:line and a kind (spec | quality | scope). Fix nothing.`
}

function guardBrief() {
  return `Run exactly this from ${cwd} and return its JSON output:

node ${skillDir}/scripts/forbidden-repairs.mjs --since ${baseline}${planPath ? ` --plan ${planPath}` : ''} --pretty

Set verdict from the output's "verdict" field and copy its violations. Do not edit any file. Do not interpret — transcribe.`
}

function revertBrief(guard) {
  return `${CONTEXT}

The last step introduced forbidden repairs. Revert exactly these hunks and nothing else, leaving the legitimate parts of the step in place:

${JSON.stringify(guard.violations, null, 2)}

Use \`git checkout -p\` or restore the file and re-apply the clean hunks. Report what you reverted.`
}

function peerBrief(step) {
  return `Run exactly this from ${cwd} and return its JSON output verbatim:

node ${skillDir}/scripts/peer-build.mjs --host ${host} --cwd ${cwd} --plan ${planPath} --step ${step.id} --out ${runDir}/peer/${step.id} --timeout-ms ${peerTimeoutMs}

Do not edit any file yourself. Do not interpret — transcribe. If the command itself cannot be started, return status "peer_unavailable" with the error as reason.`
}

// ------------------------------------------------------------- one step

async function runStep(id) {
  const step = byId.get(id)
  const rec = state.get(id)
  let feedback = null

  while (rec.attempts < maxAttempts && !stoppedBy) {
    rec.attempts++
    let implExit = null

    if (mode === 'peer') {
      // The peer writes; it does not get to say whether it succeeded. The
      // reviewer runs the Verify command and the guard scans the diff, exactly
      // as for a host implementer — a second vendor's claim is still a claim.
      const p = await agent(peerBrief(step), {
        schema: PEER_STEP_SCHEMA,
        effort: 'low',
        label: `peer:${id}`,
        phase: 'Steps',
      })
      if (!p || p.status !== 'ok') {
        peerFailure = (p && p.reason) || 'the peer returned nothing'
        rec.status = 'peer_unavailable'
        rec.notes = peerFailure
        stoppedBy = `peer-unavailable: ${peerFailure}`
        return
      }
      rec.files_touched = p.files_touched || []
    } else {
      const impl = await agent(implBrief(step, feedback), {
        schema: STEP_SCHEMA,
        model: mdl('implementer'),
        effort: eff('implementer'),
        label: rec.attempts > 1 ? `impl:${id}:retry` : `impl:${id}`,
        phase: 'Steps',
      })
      if (impl && impl.blocked_by) {
        rec.status = 'blocked'
        rec.notes = `implementer: ${impl.blocked_by}`
        return
      }
      implExit = impl && typeof impl.verify_exit_code === 'number' ? impl.verify_exit_code : null
      rec.files_touched = (impl && impl.files_touched) || []
    }

    const rev = await agent(reviewBrief(step), {
      schema: REVIEW_SCHEMA,
      model: mdl('reviewer'),
      effort: eff('reviewer'),
      label: `review:${id}`,
      phase: 'Steps',
    })

    // The guard runs regardless of what anyone claimed — after every step, on
    // the whole diff since the baseline. One forbidden hunk anywhere stops the
    // build: a step landed by silencing a checker poisons every step after it.
    const guard = await agent(guardBrief(), {
      schema: GUARD_SCHEMA,
      model: mdl('guard'),
      effort: 'low',
      label: `guard:${id}`,
      phase: 'Guard',
    })
    if (guard && guard.verdict === 'FORBIDDEN') {
      await agent(revertBrief(guard), { model: mdl('implementer'), label: 'revert-forbidden', phase: 'Guard' })
      stoppedBy = `forbidden-repair: ${guard.violations.map((v) => `${v.rule} @ ${v.file}`).join(', ')}`
      rec.status = 'blocked'
      rec.notes = stoppedBy
      return
    }

    // Done needs all three: the implementer's run passed (host mode), the
    // reviewer's own run passed, and the reviewer accepted the spec and the
    // quality. A reviewer that returned nothing accepted nothing.
    const reviewExit = rev && typeof rev.verify_exit_code === 'number' ? rev.verify_exit_code : null
    rec.exit_code = reviewExit !== null ? reviewExit : implExit
    const proven = (mode === 'peer' || implExit === 0) && reviewExit === 0
    const accepted = !!rev && rev.spec_ok === true && rev.quality_ok === true
    if (proven && accepted) {
      rec.status = 'done'
      rec.notes = null
      return
    }

    const issues = ((rev && rev.issues) || []).map((i) => `- ${i.file}:${i.line} [${i.kind}] ${i.issue}`)
    if (implExit !== null && implExit !== 0) issues.unshift(`- the Verify command exited ${implExit} for the implementer`)
    if (reviewExit !== 0) issues.unshift(`- the Verify command exited ${reviewExit === null ? 'without a result' : reviewExit} for the reviewer`)
    feedback = issues.join('\n') || '- the reviewer did not accept the step and gave no detail'
    rec.notes = feedback
    log(`${id} attempt ${rec.attempts}/${maxAttempts} not accepted: ${issues.length} issue(s)`)
  }

  if (rec.status === 'pending') rec.status = 'blocked'
}

// ------------------------------------------------------------- the waves

// Deterministic, and no agent before the first implementer: the plan was
// approved, the steps were parsed, the schedule was computed. A question here
// would be a question the plan already answered.
phase('Steps')

for (const wave of waves) {
  if (stoppedBy) break
  const runnable = []
  for (const id of wave) {
    const step = byId.get(id)
    if (!step) continue
    const rec = state.get(id)
    const unmet = (step.dependsOn || []).find((d) => !state.get(d) || state.get(d).status !== 'done')
    if (unmet) {
      rec.status = 'skipped'
      rec.notes = `depends on ${unmet}, which is ${state.get(unmet) ? state.get(unmet).status : 'unknown'}`
      skipped.push({ id, because: unmet })
      continue
    }
    runnable.push(id)
  }
  if (mode === 'peer') {
    // One worktree, one peer process at a time.
    for (const id of runnable) if (!stoppedBy) await runStep(id)
  } else {
    await parallel(runnable.map((id) => () => runStep(id)))
  }
}

// Whatever never ran because the build stopped is skipped by name, not left
// "pending" as if it might still happen.
for (const rec of state.values()) {
  if (rec.status === 'pending') {
    rec.status = 'skipped'
    rec.notes = stoppedBy ? `build stopped: ${stoppedBy}` : 'never scheduled'
    skipped.push({ id: rec.id, because: stoppedBy || 'never scheduled' })
  }
}

// --------------------------------------------------------------- handoff

phase('Handoff')

const table = [...state.values()]
const status = peerFailure
  ? 'peer_unavailable'
  : stoppedBy || table.some((r) => r.status !== 'done')
    ? 'blocked'
    : 'built'

const residualRisk = [
  'build proves each step by its own Verify command; the whole is proven by /verify, which has not run yet.',
]
if (mode === 'peer') residualRisk.push("the peer's own reports were not used as evidence — every step was re-run by the reviewer.")
if (stoppedBy) residualRisk.push(`the build stopped: ${stoppedBy}`)

const summary = {
  status,
  mode,
  plan: planPath,
  worktree: cwd,
  baseline,
  steps: table,
  skipped,
  stopped_by: stoppedBy,
  residual_risk: residualRisk,
}

await agent(
  `Write ${runDir}/BUILD.md — the build record, in Markdown, and nothing else. Create the directory if needed.

- A status line: ${status}, plan ${planPath}, worktree ${cwd}, mode ${mode}.
- STEPS: one row per step — id, title, status, attempts, Verify command, exit code, files touched.
- SKIPPED: each skipped step and the dependency that blocked it.
- STOPPED BY, if set.
- RESIDUAL RISK: the list in the data.
- NEXT: ${status === 'built' ? `run /verify ${planPath}` : 'the blocked steps above, then /build again on the same plan'}.

Report back only the path.

DATA:
${JSON.stringify(summary)}`,
  { model: mdl('reporter'), effort: 'low', label: 'summary', phase: 'Handoff' },
)

return {
  ...summary,
  run_dir: runDir,
  next: status === 'built' ? `/verify ${planPath}` : null,
}

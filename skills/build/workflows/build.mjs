export const meta = {
  name: 'build',
  description: 'Execute an approved plan: a small-tier implementer per step in dependency waves, a medium-tier reviewer that reruns Verify and the guard, escalation on failure',
  whenToUse: 'After a blueprint plan is approved. Invoked by the build skill; never on its own.',
  phases: [
    { title: 'Steps', detail: 'implement, review, guard — per S-xxx, in dependency waves' },
  ],
}

// Every input was resolved by Phase 0 (plan-steps.mjs). Nothing here re-reads
// the plan or decides a model: `models` maps a tier to a name, or to null for
// the session's own model.
const A = args || {}
const cwd = A.cwd || '.'
const planPath = A.planPath || ''
const steps = Array.isArray(A.steps) ? A.steps : []
const waves = Array.isArray(A.waves) && A.waves.length ? A.waves : steps.map((s) => [s.id])
const skillDir = A.skillDir || '.'
const baseline = A.baseline || 'HEAD'
const host = A.host || null
const namespace = A.namespace || null
const models = A.models || {}
// small, small with the reviewer's issues, then medium once. Then blocked.
const attempts = Array.isArray(A.attempts) && A.attempts.length ? A.attempts : ['small', 'small', 'medium']
const REVIEW_TIER = 'medium'
const model = (tier) => models[tier] || undefined

function skillCall(name, rest) {
  if (host === 'codex') return `$${name} ${rest}`
  if (host === 'claude') return `/${namespace ? `${namespace}:` : ''}${name} ${rest}`
  return `invoke the ${name} skill with ${rest}`
}

const byId = new Map(steps.map((s) => [s.id, s]))
const state = new Map(steps.map((s) => [s.id, { id: s.id, status: 'pending', exit: null, tier: null, notes: null }]))
let stoppedBy = null

const CONTEXT = `Worktree (the only place you may write; run every command here; do not commit): ${cwd}
Plan: ${planPath}`

const FORBIDDEN = `YOU MAY NOT: skip, delete, weaken or .only a test; change an expected value to match the output; add @ts-ignore, @ts-expect-error, eslint-disable, # type: ignore or # noqa; widen a type to any; swallow an error in an empty catch; edit a gate command, CI workflow, Makefile target or the plan; commit. If the step needs one of those, stop and set blocked_by.`

const IMPL_SCHEMA = {
  type: 'object',
  required: ['done', 'files', 'exit', 'out'],
  properties: {
    done: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    exit: { type: 'number' },
    out: { type: 'string' },
    blocked_by: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['ok', 'exit', 'guard', 'issues'],
  properties: {
    ok: { type: 'boolean' },
    exit: { type: 'number' },
    guard: { type: 'string', enum: ['CLEAN', 'FORBIDDEN'] },
    violations: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', maxItems: 5, items: { type: 'string' } },
  },
}

function implBrief(step, feedback) {
  return `${CONTEXT}

Implement exactly this step and nothing else:

${step.raw}

- Touch only the files under Files:. Open a file before editing it; never guess a path or a symbol.
- Then run, from the worktree: ${step.verifyCmd}  (expected: ${step.verifyExpected || 'see the step'})
- Return JSON: done (Verify exited 0 and every Change bullet is in), files (relative paths), exit (-1 if it did not finish), out (at most 10 lines of its output).

${FORBIDDEN}${feedback ? `\n\nThe previous attempt was rejected. Fix every item:\n${feedback}` : ''}`
}

function reviewBrief(step) {
  const files = step.files && step.files.length ? step.files.join(' ') : '.'
  return `${CONTEXT}

Review the change for this step. Read and run anything; edit nothing.

${step.raw}

1. Read \`git diff ${baseline} -- ${files}\` and any untracked file there (\`git status --porcelain\`). Every Change bullet present, Preserve untouched, no file outside Files:, no debug output or dead code.
2. Run: ${step.verifyCmd}
3. Run: node ${skillDir}/scripts/forbidden-repairs.mjs --since ${baseline}${planPath ? ` --plan ${planPath}` : ''}
Return JSON: ok (1 holds), exit (of 2), guard (the "verdict" of 3), violations (3's violations as "rule file:line"), issues (at most 5, each "file:line — problem").`
}

// An agent that never returned judged nothing: the step is `unproven`, it buys
// no retry, and it is not a pass.
async function runStep(id) {
  const step = byId.get(id)
  const rec = state.get(id)
  let feedback = null
  for (let i = 0; i < attempts.length && !stoppedBy; i++) {
    const tier = attempts[i]
    rec.tier = tier
    const impl = await agent(implBrief(step, feedback), {
      schema: IMPL_SCHEMA,
      model: model(tier),
      label: `impl:${id}:${i + 1}`,
      phase: 'Steps',
    })
    if (!impl) return Object.assign(rec, { status: 'unproven', notes: 'implementer never returned' })
    if (impl.blocked_by) {
      rec.notes = `blocked_by: ${impl.blocked_by}`
      // A small model that says it cannot is worth one look from the medium
      // one; a medium model that says it cannot means the plan is short.
      const last = attempts.length - 1
      if (i >= last || attempts[last] === tier) return Object.assign(rec, { status: 'blocked' })
      feedback = `- the previous implementer stopped: ${impl.blocked_by}`
      i = last - 1
      continue
    }
    const rev = await agent(reviewBrief(step), {
      schema: REVIEW_SCHEMA,
      model: model(REVIEW_TIER),
      label: `review:${id}:${i + 1}`,
      phase: 'Steps',
    })
    if (!rev) return Object.assign(rec, { status: 'unproven', notes: 'reviewer never returned' })
    // One forbidden hunk anywhere stops the build: a step landed by silencing
    // a checker poisons every step after it.
    if (rev.guard !== 'CLEAN') {
      const v = (rev.violations || []).join(', ') || 'unspecified'
      await agent(`${CONTEXT}\n\nRevert exactly these forbidden hunks and nothing else: ${v}. Use \`git checkout -p\` or restore and re-apply the clean hunks. Return the reverted files.`, {
        model: model('small'),
        label: `revert:${id}`,
        phase: 'Steps',
      })
      stoppedBy = `forbidden repair in ${id}: ${v}`
      return Object.assign(rec, { status: 'blocked', notes: stoppedBy })
    }
    rec.exit = rev.exit
    if (impl.exit === 0 && rev.exit === 0 && rev.ok) return Object.assign(rec, { status: 'done', notes: null })
    const issues = (rev.issues || []).slice(0, 5).map((s) => `- ${s}`)
    if (rev.exit !== 0) issues.unshift(`- Verify exited ${rev.exit} for the reviewer`)
    feedback = issues.join('\n') || '- rejected without detail'
    rec.notes = feedback.replace(/\n/g, ' ')
    log(`${id} attempt ${i + 1}/${attempts.length} (${tier}) rejected`)
  }
  if (rec.status === 'pending') rec.status = 'blocked'
}

phase('Steps')
for (const wave of waves) {
  if (stoppedBy) break
  const runnable = []
  for (const id of wave) {
    const step = byId.get(id)
    if (!step) continue
    const unmet = (step.dependsOn || []).find((d) => !state.get(d) || state.get(d).status !== 'done')
    if (unmet) Object.assign(state.get(id), { status: 'skipped', notes: `needs ${unmet}` })
    else runnable.push(id)
  }
  await parallel(runnable.map((id) => () => runStep(id)))
}
for (const rec of state.values())
  if (rec.status === 'pending') Object.assign(rec, { status: 'skipped', notes: stoppedBy ? 'build stopped' : 'never scheduled' })

const table = [...state.values()]
const status = stoppedBy || table.some((r) => r.status === 'blocked')
  ? 'blocked'
  : table.some((r) => r.status === 'unproven')
    ? 'unproven'
    : table.every((r) => r.status === 'done')
      ? 'built'
      : 'blocked'

return {
  status,
  worktree: cwd,
  lines: table.map((r) => [r.id, r.status, r.exit ?? '-', r.tier ?? '-', r.notes || ''].join(' ').trim()),
  stopped_by: stoppedBy,
  next: status === 'built' ? skillCall('verify', planPath) : null,
}

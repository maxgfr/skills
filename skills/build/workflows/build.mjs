export const meta = {
  name: 'build',
  description: 'Execute an approved plan: a small-tier implementer per step in dependency waves, one medium-tier reviewer per wave that reruns every Verify and the guard, escalation on failure',
  whenToUse: 'After a blueprint plan is approved. Invoked by the build skill; never on its own.',
  phases: [
    { title: 'Steps', detail: 'implement each S-xxx, then one review + guard per wave' },
  ],
}

// Every input was resolved by Phase 0 (plan-steps.mjs). Nothing here re-reads
// the plan or decides a model: `tiers` maps a tier to { model, effort }, null
// meaning the session's own, and names the tier of each attempt and of review.
const A = args || {}
const cwd = A.cwd || '.'
const planPath = A.planPath || ''
const steps = Array.isArray(A.steps) ? A.steps : []
const waves = Array.isArray(A.waves) && A.waves.length ? A.waves : steps.map((s) => [s.id])
const skillDir = A.skillDir || '.'
const baseline = A.baseline || 'HEAD'
const tiers = A.tiers || {}
// By default: small, small with the reviewer's issues, then medium once. Then blocked.
const attempts = Array.isArray(tiers.attempts) && tiers.attempts.length ? tiers.attempts : ['small', 'small', 'medium']
const REVIEW_TIER = tiers.review || 'medium'
// The agent() options for a tier: what is unset is inherited from the session.
const on = (tier) => ({ model: (tiers[tier] && tiers[tier].model) || undefined, effort: (tiers[tier] && tiers[tier].effort) || undefined })

const byId = new Map(steps.map((s) => [s.id, s]))
const state = new Map(steps.map((s) => [s.id, { id: s.id, status: 'pending', exit: null, tier: null, notes: null }]))
let stoppedBy = null

const CONTEXT = `Work and run commands only in ${cwd}; do not commit.`

const FORBIDDEN = `Never skip, weaken or delete a test, fit an expected value to the output, add a suppression comment, widen a type to any, swallow an error, or edit a gate, CI or the plan; if the step needs that, stop and return blocked_by.`

const IMPL_SCHEMA = {
  type: 'object',
  required: ['exit'],
  properties: {
    exit: { type: 'number' },
    blocked_by: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['guard', 'steps'],
  properties: {
    guard: { type: 'string', enum: ['CLEAN', 'FORBIDDEN'] },
    violations: { type: 'array', items: { type: 'string' } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'ok', 'exit'],
        properties: {
          id: { type: 'string' },
          ok: { type: 'boolean' },
          exit: { type: 'number' },
          issues: { type: 'array', maxItems: 3, items: { type: 'string' } },
        },
      },
    },
  },
}

function implBrief(step, feedback) {
  return `${CONTEXT}

Implement this step, nothing more:

${step.raw}

Touch only its Files, run its Verify once, use few tool calls.
${FORBIDDEN}
Return JSON: exit (Verify's exit code, -1 if not run), blocked_by (only if you stopped).${feedback ? `\n\nThe previous attempt was rejected. Fix every item:\n${feedback}` : ''}`
}

// One reviewer per round of a wave: it judges every step just implemented,
// reruns each Verify, and runs the guard once on the whole diff. Everything it
// needs comes out of one shell call: every extra tool call re-sends the
// agent's whole context, which is where a subagent's tokens go.
function reviewScript(list) {
  const files = list.flatMap((s) => s.files || [])
  const paths = files.length ? files.join(' ') : '.'
  return [
    `git diff ${baseline} -- ${paths}`,
    `for f in $(git ls-files -o --exclude-standard -- ${paths}); do git diff --no-index /dev/null "$f"; done`,
    ...list.map((s) => `out=$( (${s.verifyCmd}) 2>&1 ); e=$?; printf '%s\\n' "$out" | tail -15; echo "${s.id} exit=$e"`),
    `node ${skillDir}/scripts/forbidden-repairs.mjs --brief --since ${baseline}${planPath ? ` --plan ${planPath}` : ''}`,
  ].join('\n')
}

function reviewBrief(ids) {
  const list = ids.map((id) => byId.get(id))
  return `${CONTEXT} Edit nothing.

Review these steps:

${list.map((s) => s.raw).join('\n\n')}

Run this once, as a single shell call:

${reviewScript(list)}

Per step: every Change in, Preserve kept, nothing outside its Files, no debug or dead code. Open a file only if the diff leaves a doubt.
Return JSON: guard (CLEAN or FORBIDDEN), violations (the guard's lines), steps (per step: id, ok, exit (its exit=N), issues (at most 3, "file:line — problem")).`
}

// An agent that never returned judged nothing: the step is `unproven`, it buys
// no retry, and it is not a pass.
const unproven = (rec, why) => Object.assign(rec, { status: 'unproven', notes: why })

async function runWave(wave, w) {
  const at = new Map(wave.map((id) => [id, 0])) // each step's index into attempts
  const feedback = new Map()
  let pending = wave.slice()
  for (let round = 1; pending.length && !stoppedBy; round++) {
    const impls = await parallel(
      pending.map((id) => () => {
        const tier = attempts[at.get(id)]
        state.get(id).tier = tier
        return agent(implBrief(byId.get(id), feedback.get(id)), { schema: IMPL_SCHEMA, ...on(tier), label: `impl:${id}:${at.get(id) + 1}`, phase: 'Steps' })
      }),
    )
    const implExit = new Map()
    const review = []
    const next = []
    pending.forEach((id, k) => {
      const rec = state.get(id)
      const impl = impls[k]
      if (!impl) return unproven(rec, 'implementer never returned')
      if (!impl.blocked_by) {
        implExit.set(id, impl.exit)
        return review.push(id)
      }
      rec.notes = `blocked_by: ${impl.blocked_by}`
      // A small model that says it cannot is worth one look from the last
      // tier; the last tier saying it cannot means the plan is short.
      const last = attempts.length - 1
      if (at.get(id) >= last || attempts[last] === rec.tier) return Object.assign(rec, { status: 'blocked' })
      feedback.set(id, `- the previous implementer stopped: ${impl.blocked_by}`)
      at.set(id, last)
      next.push(id)
    })
    if (review.length) {
      const rev = await agent(reviewBrief(review), { schema: REVIEW_SCHEMA, ...on(REVIEW_TIER), label: `review:w${w}:${round}`, phase: 'Steps' })
      if (!rev) review.forEach((id) => unproven(state.get(id), 'reviewer never returned'))
      else if (rev.guard !== 'CLEAN') {
        // One forbidden hunk anywhere stops the build: a step landed by
        // silencing a checker poisons every step after it.
        const all = rev.violations || []
        await agent(`${CONTEXT}\n\nRevert exactly these forbidden hunks and nothing else: ${all.join(', ') || 'unspecified'}. Use \`git checkout -p\` or restore and re-apply the clean hunks.`, {
          ...on(attempts[0]),
          label: `revert:w${w}`,
          phase: 'Steps',
        })
        // The output is one line per step: name the first few, count the rest.
        stoppedBy = `forbidden repair: ${all.slice(0, 3).join(', ') || 'unspecified'}${all.length > 3 ? ` +${all.length - 3} more` : ''}`
        review.forEach((id) => Object.assign(state.get(id), { status: 'blocked', notes: stoppedBy }))
      } else
        for (const id of review) {
          const rec = state.get(id)
          const v = (rev.steps || []).find((x) => x.id === id)
          if (!v) {
            unproven(rec, 'the reviewer did not judge it')
            continue
          }
          rec.exit = v.exit
          if (implExit.get(id) === 0 && v.exit === 0 && v.ok) {
            Object.assign(rec, { status: 'done', notes: null })
            continue
          }
          const issues = (v.issues || []).slice(0, 3).map((x) => `- ${x}`)
          if (v.exit !== 0) issues.unshift(`- Verify exited ${v.exit} for the reviewer`)
          feedback.set(id, issues.join('\n') || '- rejected without detail')
          rec.notes = feedback.get(id).replace(/\n/g, ' ')
          log(`${id} attempt ${at.get(id) + 1}/${attempts.length} (${rec.tier}) rejected`)
          at.set(id, at.get(id) + 1)
          if (at.get(id) >= attempts.length) rec.status = 'blocked'
          else next.push(id)
        }
    }
    pending = next
  }
  for (const id of pending) Object.assign(state.get(id), { status: 'blocked', notes: state.get(id).notes || 'build stopped' })
}

phase('Steps')
for (const [w, wave] of waves.entries()) {
  if (stoppedBy) break
  const runnable = []
  for (const id of wave) {
    const step = byId.get(id)
    if (!step) continue
    const unmet = (step.dependsOn || []).find((d) => !state.get(d) || state.get(d).status !== 'done')
    if (unmet) Object.assign(state.get(id), { status: 'skipped', notes: `needs ${unmet}` })
    else runnable.push(id)
  }
  if (runnable.length) await runWave(runnable, w + 1)
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

// The orchestrator runs verify itself on `built`: it knows its own host.
return {
  status,
  worktree: cwd,
  lines: table.map((r) => [r.id, r.status, r.exit ?? '-', r.tier ?? '-', r.notes || ''].join(' ').trim()),
  stopped_by: stoppedBy,
}

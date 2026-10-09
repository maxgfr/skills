# Running the steps as a workflow

For a host whose workflow tool runs a script of subagents with `agent()`. Write the script below to a file once, then run the tool with that file as its script path (or, if it takes no path, with the script text verbatim) and the `args` below; the repair rounds reuse the file:

~~~sh
awk '/^```js$/{f=1;next} /^```$/{f=0} f' "<this skill's directory>/references/workflow.md" > "<a scratch directory>/build-steps.js"
~~~

`args`:

- `worktree`: the worktree's absolute path; `plan`: the plan's absolute path.
- `tiers`: `{ small, medium, large }`, each `{ model, effort }` or a bare model name, read as `references/tiers.md` says, leaving out a key the tier inherits from you.
- To build, `steps`: per step, in `Depends on` order, `{ id, waits, files, tier, reviewTier, security }`, where `waits` is its `Depends on` ids written out one by one (a range such as `S-001…S-009` expanded), `files` the paths in its Files, and `reviewTier` one of `small`, `medium`, `large`: the `review` tier of `references/tiers.md`, or `large` for a security step. Each subagent reads its step from the plan.
- To repair instead, `repair`: `{ round, groups }`, where `groups` is `[{ file, lines }]`, verify's failing `gate` lines (exit code not 0) and its `finding` lines, never a passing gate, grouped by the file they name, with `file` set to `-` for the lines that name none. Its fixers run one after another: the groups with a file in their order, then `-`.

A build returns `{ steps: [{ id, status, exit, by, note }], forbidden }` and a repair `{ fixes: [{ file, fixed, note, by }] }`. Revert each `forbidden` hunk yourself.

```js
export const meta = {
  name: 'build-steps',
  description: 'Implement plan steps with tiered subagents and a reviewer each, or repair what verify found',
  phases: [{ title: 'Implement' }, { title: 'Review' }, { title: 'Repair' }],
}

const RULE =
  'skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan'
const UP = { small: 'medium', medium: 'large', large: 'large' }
const TRIES = 3

// A tier is { model, effort } or a bare model name; a key left out inherits the session's.
const on = (tier) => {
  const value = (args.tiers || {})[tier]
  const opts = typeof value === 'string' ? { model: value } : value || {}
  return Object.fromEntries(Object.entries(opts).filter(([, setting]) => setting))
}

const IMPLEMENTED = {
  type: 'object',
  properties: { exit: { type: 'integer' }, blocked_by: { type: 'string' }, escalate: { type: 'string' } },
  required: ['exit'],
}
const REVIEWED = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    exit: { type: 'integer' },
    issues: { type: 'array', items: { type: 'string' } },
    forbidden: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'exit', 'issues', 'forbidden'],
}
const FIXED = {
  type: 'object',
  properties: { fixed: { type: 'boolean' }, note: { type: 'string' } },
  required: ['fixed'],
}

const implementerPrompt = (step, tier, issues, handoff) => `Work and run commands only in ${args.worktree}; do not commit.

Implement this step, nothing more: the \`### ${step.id}\` block of ${args.plan}.

Other steps are built in this worktree at the same time: touch only its Files. Run its Verify once, use few tool calls.
Never ${RULE}; if the step needs that, stop and return blocked_by.${
  tier === 'large'
    ? ''
    : '\nIf the step needs more judgment than you have (a design choice, state across calls, a security decision), do not try: return escalate with the reason in one line, and the largest model takes it.'
}
Return JSON: exit (Verify's exit code, -1 if not run), blocked_by (only if you stopped), escalate (only if you hand the step on).${
  handoff ? `\n\nA smaller model handed this step to you: ${handoff}` : ''
}${
  issues.length
    ? `\n\nThe previous attempt was rejected. Fix every item:\n${issues.map((issue) => `- ${issue}`).join('\n')}`
    : ''
}`

const reviewerPrompt = (step) => `Work and run commands only in ${args.worktree}; do not commit. Edit nothing.

Review this step: the \`### ${step.id}\` block of ${args.plan}.

Other steps are built in this worktree at the same time: look only at its Files and ignore every other change. Read their diff once: \`git diff HEAD -- ${step.files.join(' ')}\`, and \`git status --short -- ${step.files.join(' ')}\` for the new ones. Rerun its Verify once.
Check every Change is in, Preserve is kept, no debug or dead code.${
  step.security
    ? ' It touches security: list as issues any injection, path traversal, missing authorization or validation, and leaked secret.'
    : ''
}
A change that tries to ${RULE} is forbidden.
Return JSON: ok, exit (Verify's exit code), issues (at most 3, "file:line — problem"), forbidden (each "file:line — what").`

const fixerPrompt = (group) => `Work and run commands only in ${args.worktree}; do not commit.

The plan ${args.plan} is built there, and verify failed on ${group.file === '-' ? 'these checks' : group.file}:

${group.lines.join('\n')}

Fix the cause, within what the plan asks. For a bug, first add a test that fails without the fix. Touch only ${
  group.file === '-' ? 'what these checks point at' : `${group.file} and its tests`
}; if the fix needs another file, stop and say which in note. Rerun the failing check once.
Never ${RULE}.
Return JSON: fixed (true when the check passes or the scenario no longer happens), note (one line).`

if (args.repair) {
  const tier = args.repair.round > 1 ? 'large' : 'medium'
  const groups = args.repair.groups
  // One fixer at a time: fixers of different files may add tests to the same test file, and the fixer
  // with no file may edit any file, so it comes last.
  const queue = [...groups.filter((group) => group.file !== '-'), ...groups.filter((group) => group.file === '-')]
  const answers = new Map()
  for (const group of queue)
    answers.set(
      group,
      await agent(fixerPrompt(group), { label: `fix ${group.file}`, phase: 'Repair', schema: FIXED, ...on(tier) }).catch(
        (error) => ({ fixed: false, note: String(error?.message ?? error) }),
      ),
    )
  return {
    fixes: groups.map((group) => ({
      file: group.file,
      fixed: !!answers.get(group)?.fixed,
      note: answers.get(group) ? answers.get(group).note ?? '' : 'no answer',
      by: tier,
    })),
  }
}

const steps = args.steps
const byId = new Map(steps.map((step) => [step.id, step]))
const started = new Map()
const forbidden = []

// A step that waits on itself is kept so: it is never ordered, and is reported on a loop.
const dependsOn = new Map(steps.map((step) => [step.id, [...new Set(step.waits)]]))

// Checked before any agent runs: an unknown id or a loop would leave a step waiting forever.
const invalid = new Map()
for (const step of steps) {
  const unknown = dependsOn.get(step.id).find((id) => !byId.has(id))
  if (unknown) invalid.set(step.id, `unknown step ${unknown} in Depends on`)
}
// Kahn's algorithm over the Depends on of known ids: the order the steps can run in.
const pending = new Map(steps.map((step) => [step.id, dependsOn.get(step.id).filter((id) => byId.has(id)).length]))
const order = steps.filter((step) => pending.get(step.id) === 0).map((step) => step.id)
for (let index = 0; index < order.length; index++)
  for (const step of steps)
    if (dependsOn.get(step.id).includes(order[index])) {
      pending.set(step.id, pending.get(step.id) - 1)
      if (pending.get(step.id) === 0) order.push(step.id)
    }
// A step left out of the order is on a loop when its Depends on lead back to it; otherwise it only waits on one,
// and is skipped as any step after a blocked one.
const onLoop = (id) => {
  const seen = new Set()
  const next = [...dependsOn.get(id)]
  while (next.length) {
    const other = next.pop()
    if (other === id) return true
    if (seen.has(other) || !byId.has(other)) continue
    seen.add(other)
    next.push(...dependsOn.get(other))
  }
  return false
}
for (const step of steps)
  if (!order.includes(step.id) && !invalid.has(step.id) && onLoop(step.id)) invalid.set(step.id, 'Depends on loops')

// A step waits for its Depends on and for any step earlier in that order that shares one of its files.
const waitsOf = (step) => {
  const earlier = order.includes(step.id) ? order.slice(0, order.indexOf(step.id)).map((id) => byId.get(id)) : []
  const sharing = earlier.filter((other) => other.files.some((file) => step.files.includes(file)))
  return [...new Set([...dependsOn.get(step.id), ...sharing.map((other) => other.id)])]
}
const waits = new Map(steps.map((step) => [step.id, waitsOf(step)]))

const result = (id) => {
  if (!started.has(id))
    started.set(
      id,
      (invalid.has(id)
        ? Promise.resolve({ id, status: 'blocked', exit: '-', by: '-', note: invalid.get(id) })
        : build(byId.get(id))
      ).catch((error) => ({
        id,
        status: 'unproven',
        exit: '-',
        by: '-',
        note: String(error?.message ?? error),
      })),
    )
  return started.get(id)
}

async function build(step) {
  const before = await Promise.all(waits.get(step.id).map(result))
  const failed = before.find((other) => other.status !== 'done')
  if (failed) return { id: step.id, status: 'skipped', exit: '-', by: '-', note: `needs ${failed.id}` }
  let tier = step.tier
  let issues = []
  let handoff = ''
  let last = { exit: -1, by: tier }
  for (let tryNo = 1; tryNo <= TRIES; tryNo++) {
    if (forbidden.length)
      return { id: step.id, status: 'skipped', exit: '-', by: '-', note: 'stopped on a forbidden change' }
    const implemented = await agent(implementerPrompt(step, tier, issues, handoff), {
      label: `${step.id} ${tier}`,
      phase: 'Implement',
      schema: IMPLEMENTED,
      ...on(tier),
    })
    if (!implemented) return { id: step.id, status: 'unproven', exit: '-', by: tier, note: 'implementer never answered' }
    // A smaller model that judges the step beyond it, or that a rule stops, hands it to the largest at once, and that
    // try is not counted; the largest stopped by a rule blocks the step.
    const reason = implemented.escalate || implemented.blocked_by
    if (reason && tier !== 'large') {
      handoff = reason
      tier = 'large'
      tryNo--
      continue
    }
    if (implemented.blocked_by)
      return { id: step.id, status: 'blocked', exit: implemented.exit, by: tier, note: implemented.blocked_by }
    const review = await agent(reviewerPrompt(step), {
      label: `review ${step.id}`,
      phase: 'Review',
      schema: REVIEWED,
      ...on(step.reviewTier),
    })
    if (!review)
      return { id: step.id, status: 'unproven', exit: implemented.exit, by: tier, note: 'reviewer never answered' }
    last = { exit: review.exit, by: tier }
    if (review.forbidden.length) {
      forbidden.push(...review.forbidden)
      return { id: step.id, status: 'blocked', exit: review.exit, by: tier, note: review.forbidden[0] }
    }
    if (implemented.exit === 0 && review.exit === 0 && review.ok)
      return { id: step.id, status: 'done', exit: 0, by: tier }
    issues = review.issues.length ? review.issues : [`Verify exited ${review.exit}`]
    tier = UP[tier]
  }
  return { id: step.id, status: 'blocked', exit: last.exit, by: last.by, note: issues[0] }
}

return { steps: await Promise.all(steps.map((step) => result(step.id))), forbidden }
```

---
status: approved
---

# build délègue chaque étape à des subagents en parallèle, puis répare ce que verify trouve

## Goal
build ne code plus jamais lui-même quand l'hôte a des subagents :
- un implémenteur par étape et un reviewer par implémentation ;
- chaque étape démarre dès que les étapes qu'elle attend sont `done`, donc tout ce qui est indépendant tourne en même temps ;
- chaque étape reçoit le tier dont elle a besoin : `large` pour l'UI, au moins `medium` pour la sécurité, `small` sinon ;
- un modèle plus petit qui juge l'étape au-dessus de ses moyens la passe directement à `large`.

Dans Claude Code, tout ça tourne dans un script Workflow déterministe. Sur les autres hôtes, la même boucle se fait à la main avec l'outil de subagent.

Après un `FAIL` de verify, build répare :
- un correcteur par fichier, en parallèle ;
- au tier `medium`, puis `large` ;
- puis verify est relancé, jusqu'à `PASS`, pendant trois tours au plus.

## Locked constraints
- Q-001 — Toujours déléguer. Chaque étape a son tier : `large` pour l'UI (le design est meilleur sur un gros modèle), au moins `medium` et un reviewer `large` pour la sécurité, `small` pour le reste. Le solo ne reste que si l'hôte n'a aucun subagent → S-002, S-004, S-006.
- Q-002 — Exploiter au mieux l'hôte, ses subagents avant tout. Avec un outil de workflow scripté (`agent()`, `parallel()`), build lance le script de `references/workflow.md`. Sinon il suit `references/dispatch.md` avec l'outil de subagent → S-001, S-003, S-004.
- Q-003 — Tout doit passer verify, et build corrige. verify reste en lecture seule. build fait la réparation, puis relance verify, trois tours au plus → S-001, S-004, S-005.
- Q-004 — Paralléliser au maximum : quinze étapes, c'est quinze subagents. Le README explique comment monter « Dynamic workflow size » dans Claude Code → S-004, S-009.
- Q-005 (délégué) — La release est un `feat:` (minor). Les lignes d'étape gardent leur forme. La colonne « who built it » donne maintenant toujours un tier → message de commit, laissé à l'utilisateur.
- Q-007 — Un implémenteur `small` ou `medium` juge lui-même si l'étape mérite le plus gros modèle. Il peut répondre `escalate` sans essayer : l'étape passe à `large` sans consommer d'essai. `large` n'a pas cette option → S-001, S-002, S-003, S-007, S-009.
- Q-006 (délégué) — On ne modifie pas le `CLAUDE.md` global de l'utilisateur. La ligne d'opt-in à y ajouter lui sera seulement proposée → non-goal.

## Grounded facts
- `skills/build/SKILL.md:16` — la session choisit entre coder seule et déléguer, et penche vers le solo (« cheaper and faster » quand les étapes sont couplées). C'est la cause du run #1718 entièrement codé en solo.
- `skills/build/SKILL.md:27` — build enchaîne sur verify, puis s'arrête. Rien ne traite un `FAIL`.
- `skills/verify/SKILL.md:11` — « Never repair. »
- `skills/build/references/dispatch.md:3` — comment on lit les tiers dans `models.json`. `:5-10` — la boucle par vagues, un reviewer par vague, et la montée de tier en cas d'échec. `:12-40` — les briefs implémenteur et reviewer, qui contiennent chacun la règle interdite.
- `scripts/validate-skills.mjs:38` — sous `skills/`, seuls `SKILL.md`, `references/*.md` et `agents/openai.yaml` sont autorisés. `:43` — 50 lignes au plus par `SKILL.md`. `:47` — aucun nom de modèle sous `skills/`. `:206` — toute référence doit être citée dans `SKILL.md`.
- `tests/skills-contract.test.mjs:14` — la chaîne `RULE`. `:21-25` — elle doit apparaître exactement 1 fois dans `build/SKILL.md`, 2 fois dans `dispatch.md` et 1 fois dans `audit.md`. `:35-43` — `solo` est interdit dans `dispatch.md`, `verify/SKILL.md` et `README.md`. `:55-58` — `done`, `blocked`, `skipped` et `unproven` doivent apparaître dans `SKILL.md` ou `dispatch.md`.
- `README.md:19` — section « Use ». `:23-31` — le tableau « How the work is split ».
- `AGENTS.md:14-15` — Markdown seulement, et aucune syntaxe propre à un hôte.
- `skills/blueprint/references/artifact.md:34-37` — les 4 règles de découpage d'une étape.
- Outil Workflow de Claude Code (doc de l'outil) :
  - `agent(prompt, { label, phase, schema, model, effort })` renvoie l'objet validé par `schema`, ou `null` si l'agent meurt.
  - `parallel(thunks)` attend tous les thunks et met `null` à la place de ceux qui ont échoué.
  - Le corps du script peut faire un `return` au niveau racine. `args` est passé tel quel.
  - Le script ne peut pas lire de fichier. `Date.now()` et `Math.random()` y sont interdits.
- `npm run check` passe sur `main` (6.0.2).

## Non-goals
- verify ne répare toujours rien lui-même.
- On ne touche ni au `CLAUDE.md` global de l'utilisateur ni à son `models.json`. On propose seulement la ligne à ajouter.
- Pas de commit, de PR ni de release : build ne commite jamais.
- Pas d'intégration propre à Codex ou OpenCode au-delà de `dispatch.md`.
- Pas de changement au grill de blueprint ni au format d'une étape (`Files`, `Depends on`, `Change`, `Preserve`, `Verify`).

## Steps

### S-001 — Écrire le script Workflow de build
- **Files:** Create `skills/build/references/workflow.md`
- **Depends on:** none
- **Change:** Write exactly this content (the outer `~~~~` fence is not part of the file):

~~~~markdown
# Running the steps as a workflow

For a host whose workflow tool runs a script of subagents with `agent()` and `parallel()`. Pass the script below verbatim, and as `args`:

- `worktree`: the worktree's absolute path; `plan`: the plan's absolute path.
- `tiers`: `{ small, medium, large }`, each `{ model, effort }` read as `references/tiers.md` says, leaving out a key the tier inherits from you.
- To build, `steps`: per step, in `Depends on` order, `{ id, block, waits, files, tier, reviewTier, security }`, where `block` is its `### S-xxx` block verbatim, `waits` its `Depends on` ids and `files` the paths in its Files.
- To repair instead, `repair`: `{ round, groups }`, where `groups` is `[{ file, lines }]`, verify's `gate` and `finding` lines grouped by the file they name, with `file` set to `-` for the lines that name none.

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

// A tier's { model, effort }; a key left out inherits the session's.
const on = (tier) =>
  Object.fromEntries(Object.entries((args.tiers || {})[tier] || {}).filter(([, value]) => value))

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

Implement this step, nothing more:

${step.block}

Touch only its Files, run its Verify once, use few tool calls.
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

Review this step:

${step.block}

Read its diff once: \`git diff HEAD -- ${step.files.join(' ')}\` plus its new files. Rerun its Verify once.
Check every Change is in, Preserve is kept, nothing is outside its Files, no debug or dead code.${
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
  const fixes = await parallel(
    args.repair.groups.map((group) => () =>
      agent(fixerPrompt(group), { label: `fix ${group.file}`, phase: 'Repair', schema: FIXED, ...on(tier) }),
    ),
  )
  return {
    fixes: args.repair.groups.map((group, index) => ({
      file: group.file,
      fixed: !!fixes[index]?.fixed,
      note: fixes[index] ? fixes[index].note ?? '' : 'no answer',
      by: tier,
    })),
  }
}

const steps = args.steps
const byId = new Map(steps.map((step) => [step.id, step]))
const started = new Map()
const forbidden = []

// A step waits for its Depends on and for any earlier step that shares one of its files.
const waitsOf = (step) => {
  const earlier = steps.slice(0, steps.indexOf(step))
  const sharing = earlier.filter((other) => other.files.some((file) => step.files.includes(file)))
  return [...new Set([...step.waits, ...sharing.map((other) => other.id)])].filter(
    (id) => byId.has(id) && id !== step.id,
  )
}

const result = (id) => {
  if (!started.has(id))
    started.set(
      id,
      build(byId.get(id)).catch((error) => ({
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
  const before = await Promise.all(waitsOf(step).map(result))
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
    // A smaller model that judges the step beyond it hands it to the largest at once; that try is not counted.
    if (implemented.escalate && tier !== 'large') {
      handoff = implemented.escalate
      tier = 'large'
      tryNo--
      continue
    }
    last = { exit: implemented.exit, by: tier }
    if (implemented.blocked_by) issues = [implemented.blocked_by]
    else {
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
    }
    tier = UP[tier]
  }
  return { id: step.id, status: 'blocked', exit: last.exit, by: last.by, note: issues[0] }
}

return { steps: await Promise.all(steps.map((step) => result(step.id))), forbidden }
```
~~~~

- **Preserve:** the file names no model; the `RULE` string appears exactly once, character for character as in `tests/skills-contract.test.mjs:14`.
- **Verify:** `node -e "const t=require('fs').readFileSync('skills/build/references/workflow.md','utf8');const s=t.match(/\x60\x60\x60js\n([\s\S]*?)\n\x60\x60\x60/)[1].replace(/^export const meta/m,'const meta');new (Object.getPrototypeOf(async function(){}).constructor)('agent','parallel','pipeline','phase','log','args','budget',s);console.log('ok')"` → prints `ok`

### S-002 — Écrire les règles de tier par étape
- **Files:** Create `skills/build/references/tiers.md`
- **Depends on:** none
- **Change:** Write exactly this content:

~~~~markdown
# Tiers

Read `~/.agents/models.json`, then `<repo>/.agents/models.json`, which wins key by key. Under your host's name (`claude`, `codex`, `opencode`…), `small`, `medium` and `large` are `{ "model", "effort" }` or a bare model name, and `review` is the reviewers' tier (default `medium`). A missing tier, a bare name's effort, or a tool that takes no model means your own model and effort.

Give each step the tier its work needs; when two lines fit, take the larger:

- `large` for a step that builds or restyles a UI: components, pages, styles, layout, text on screen.
- At least `medium` for a step that touches security: authentication, authorization, sessions, uploads and file paths, parsing user input, SQL and migrations, secrets, crypto, outbound requests. Mark it `security`; its reviewer is `large`.
- `medium` for a step whose logic spans calls or state: a form saved twice, a cache, a retry.
- `small` for the rest.

A failed try moves the step one tier up, from `small` to `medium` to `large`, three tries at most. A `small` or `medium` implementer that judges the step beyond it hands it straight to `large`, without spending a try. A repair runs at `medium` in its first round and at `large` after.
~~~~

- **Preserve:** no model name in the file.
- **Verify:** `grep -c '^- ' skills/build/references/tiers.md` → `4`

### S-003 — Réécrire dispatch.md pour un hôte sans workflow scripté
- **Files:** Modify `skills/build/references/dispatch.md:1-40` (replace the whole file)
- **Depends on:** none
- **Change:** Replace the whole file with exactly this content:

~~~~markdown
# Delegating with a subagent tool

For a host with a subagent tool but no scripted workflow: run by hand the loop the script of `references/workflow.md` codes, with the prompts its `implementerPrompt`, `reviewerPrompt` and `fixerPrompt` build, each subagent on the model and effort of its tier (`references/tiers.md`).

1. In one message, launch an implementer for every step whose waits are all `done`. A step waits for its `Depends on` and for any earlier step that shares a file.
2. As each implementer answers, launch its reviewer, and launch every step that just became ready, without waiting for the others.
3. Reviewer `forbidden` not empty: revert those hunks yourself, mark the step `blocked`, launch nothing more.
4. Implementer and reviewer `exit` 0 and `ok`: `done`. Otherwise retry one tier up, the reviewer's issues listed after `The previous attempt was rejected. Fix every item:`, three tries at most, then `blocked`. A `blocked_by` retries one tier up with it as the issue. An `escalate` hands the step straight to `large` with its reason, and that try does not count.
5. A step waiting for one that is not `done` is `skipped`. An agent that never answered, or a step its reviewer left out, is `unproven`, which is not a pass.

A repair round: one fixer per group, all in one message, at the round's tier.
~~~~

- **Preserve:** the file never contains the word `solo` and does not restate the forbidden-change rule (the prompts of `workflow.md` carry it).
- **Verify:** `grep -c 'references/workflow.md\|references/tiers.md' skills/build/references/dispatch.md` → `1`

### S-004 — Réécrire build/SKILL.md : toujours déléguer, puis réparer
- **Files:** Modify `skills/build/SKILL.md:1-27` (replace the whole file)
- **Depends on:** S-001, S-002, S-003
- **Change:** Replace the whole file with exactly this content:

~~~~markdown
---
name: build
description: Implement an approved plan in a worktree with one subagent per step on the tier the step needs and a reviewer for each, then run verify and repair until it passes. Use when a plan was just approved, including on leaving plan mode, or when an approved docs/plans/ plan exists and the user wants it implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan in a git worktree with subagents, never committing. Argument: none (the newest `status: approved` plan in `docs/plans/`) or `<path>`.

1. Read the plan. A plan approved in plan mode but not in `docs/plans/` yet: save it there first, `status: approved`, one `### S-xxx — title` per step with `Files`, `Depends on`, `Change`, `Preserve` and `Verify`. Stop in one line if the plan is not approved, a step has no Verify command, or `Depends on` loops.
2. From the repo root, with `<slug>` the plan's file name without its date: `git worktree add -b build/<slug> ../<repo>-build-<slug> HEAD`. Work only there. If the tree is dirty beyond the plan file, say those changes are not in the build.
3. Order the steps by `Depends on` and give each its tier (`references/tiers.md`).
4. Delegate every step; never code one yourself. One implementer per step and one reviewer per implementation, each step starting as soon as the steps it waits for are `done`, so independent steps run at the same time: fifteen steps is fifteen implementers, launch them all. With a workflow tool that runs a script of subagents (`agent()`, `parallel()`), run `references/workflow.md`; otherwise use your subagent tool as `references/dispatch.md` says. Only with no subagent tool at all, build each step yourself (`solo`).
5. A step after a failed one is `skipped`. Read the whole diff (`git diff` plus new files). Never: skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Revert any such hunk, and every `forbidden` one, and stop.

Print one line per step:

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

The columns are the step, its status, Verify's exit code and the tier that built it. Then one line: `worktree <path> <branch>`. Print these lines before anything else. Not all `done`: name the step that stopped, and stop.

All `done`: invoke the verify skill with the plan's absolute path and the worktree as the repo. On `FAIL`, repair the way step 4 built (the `repair` args of `references/workflow.md`, the fixer prompt in `references/dispatch.md`, or yourself when `solo`):

1. Group verify's `gate` and `finding` lines by the file they name; the lines naming none form one group.
2. Launch one fixer per group, all at once, at the round's tier; `solo`, fix the groups one after another.
3. Print `repair <round> <fixed>/<groups>`, then invoke verify again.

Stop on `PASS`, after three rounds, or when a round fixes nothing. End with verify's last verdict: a run that ends on `FAIL` or `UNPROVEN` is not done, and its lines say what is left.
~~~~

- **Preserve:** the step-line format and the `worktree <path> <branch>` line; the forbidden-change rule appears exactly once; the file stays at 50 lines or fewer.
- **Verify:** `npm run validate` → exit 0, `✓ 3 skill(s) valid`

### S-005 — verify laisse la réparation à build
- **Files:** Modify `skills/verify/SKILL.md:11`
- **Depends on:** none
- **Change:** In line 11, replace the sentence `Never repair.` with `Never repair: when the build skill invoked you, the build skill repairs and invokes you again.` Leave the rest of the line unchanged.
- **Preserve:** the rest of the file, especially `PASS`, `FAIL` and `UNPROVEN` in the description and the body.
- **Verify:** `grep -c 'the build skill repairs' skills/verify/SKILL.md` → `1`

### S-006 — blueprint isole l'UI et la sécurité dans leurs propres étapes
- **Files:** Modify `skills/blueprint/references/artifact.md:37`
- **Depends on:** none
- **Change:** After line 37 (`4. Verify is one command …`), add the line `5. UI work and security-sensitive work each get steps of their own: build gives them a larger tier than the rest.`
- **Preserve:** the plan skeleton (the fields `Files`, `Depends on`, `Change`, `Preserve`, `Verify`) and rules 1 to 4.
- **Verify:** `grep -c '^5\. UI work' skills/blueprint/references/artifact.md` → `1`

### S-007 — Tester le script Workflow comme du code
- **Files:** Test `tests/build-workflow.test.mjs` (create)
- **Depends on:** S-001
- **Change:** Write exactly this content:

~~~~js
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
// implement, review or fix. Every call is recorded in launch order.
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
    return reply(kind, id)
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

test('a repair runs one fixer per group at once, medium first and large after', async () => {
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
~~~~

- **Preserve:** the other test files.
- **Verify:** `node --test tests/build-workflow.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'` → `ℹ pass 11` and `ℹ fail 0`

### S-008 — Mettre le test de contrat à jour
- **Files:** Modify `tests/skills-contract.test.mjs:21-25,55-58`
- **Depends on:** S-001, S-003, S-004, S-005
- **Change:**
  - L23: replace `assert.equal(count(read('skills/build/references/dispatch.md'), RULE), 2, 'skills/build/references/dispatch.md')` with two lines: `assert.equal(count(read('skills/build/references/workflow.md'), RULE), 1, 'skills/build/references/workflow.md')` and `assert.equal(count(read('skills/build/references/dispatch.md'), RULE), 0, 'skills/build/references/dispatch.md')`.
  - L21: rename the test to `'the forbidden-change rule is stated where build, its workflow prompts and the audit enforce it'`.
  - L55-56: rename the test to `'build, its dispatch and its workflow name every step status'`, and change `text` to `read('skills/build/SKILL.md') + read('skills/build/references/dispatch.md') + read('skills/build/references/workflow.md')`.
  - At the end of the file, add:
    ```js
    test('build delegates every step and repairs after verify, and verify leaves the repair to build', () => {
      const build = read('skills/build/SKILL.md')
      for (const ref of ['references/workflow.md', 'references/dispatch.md', 'references/tiers.md'])
        assert.ok(build.includes(ref), ref)
      assert.match(build, word('repair'))
      assert.match(read('skills/verify/SKILL.md'), /the build skill repairs/)
    })
    ```
- **Preserve:** the other tests, `RULE` (L14), and the `solo` check on `dispatch.md`, `verify/SKILL.md` and `README.md` (L35-43).
- **Verify:** `node --test tests/skills-contract.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'` → `ℹ pass 6` and `ℹ fail 0`

### S-009 — README et AGENTS.md
- **Files:** Modify `README.md:19,25-29` · Modify `AGENTS.md:14`
- **Depends on:** none
- **Change:**
  - `README.md` L19: replace `build and verify follow on their own, and you get one line per step,` with `build and verify follow on their own, build repairs what verify finds, and you get one line per step,`.
  - `README.md` L25-29: replace the table with:
    ```
    | Job | Who |
    |---|---|
    | Plan | your session |
    | Build | one subagent per step, in parallel: `small` by default, `large` for a UI step, `medium` or more for a security step; a reviewer per step (`review`, `large` for security); a smaller implementer can hand its step to `large`; a failed try retries one tier up |
    | Repair | after a verify `FAIL`, one fixer per file, `medium` then `large`, three rounds at most |
    | Final audit | `large` |
    ```
  - `README.md`: after the paragraph that starts `verify never prints a verdict` (L31), add an empty line and then this paragraph: `In Claude Code, build runs the steps as a Workflow, the deterministic script in skills/build/references/workflow.md. A plan of fifteen steps launches fifteen implementers at once, past the default workflow size: raise "Dynamic workflow size" in /config. Other hosts run the same loop with their subagent tool.`
  - `AGENTS.md`: after line 14 (`- **Markdown only.** …`), add the bullet `- **One script.** skills/build/references/workflow.md holds the build loop as a workflow script in a fenced js block, the only host-specific syntax under skills/: it stays Markdown, and tests/build-workflow.test.mjs runs it with stub subagents.`
- **Preserve:** the rest of the README (Install, Models, Make blueprint fire, Run only on request). The words `small`, `medium`, `large`, `review` and `audit` stay in the README, and `solo` never appears in it.
- **Verify:** `grep -c 'Dynamic workflow size' README.md` → `1`

### S-010 — Vérification globale
- **Files:** none
- **Depends on:** S-001…S-009
- **Change:** none.
- **Preserve:** —
- **Verify:** `npm run check` → exit 0

## Addendum — review issues of the first pass (added by the orchestrator after review)

### S-011 — Make the workflow script safe on bad input, and keep repair groups from colliding
- **Files:** Modify `skills/build/references/workflow.md` · Test `tests/build-workflow.test.mjs`
- **Depends on:** S-001, S-007
- **Change:**
  - In the `args` bullets: `waits` is its `Depends on` ids written out one by one (a range such as `S-001…S-009` expanded); `reviewTier` is one of `small`, `medium`, `large`: the `review` tier of `references/tiers.md`, or `large` for a security step; `groups` holds verify's failing `gate` lines (exit code not 0) and its `finding` lines, never a passing gate.
  - In the script, before anything runs, check the waits graph (its `Depends on` plus the file-sharing waits of `waitsOf`): a step whose waits name an id not in `args.steps` returns `{ id, status: 'blocked', exit: '-', by: '-', note: 'unknown step <id> in Depends on' }` without launching any agent; every step left unordered by a topological sort (Kahn's algorithm) of the graph of known ids returns `{ id, status: 'blocked', exit: '-', by: '-', note: 'Depends on loops' }` without launching any agent. Steps waiting on such a step end `skipped` as today. No step may recurse into `result()` for a looping or unknown step.
  - In repair mode, run the groups whose `file` is not `-` with `parallel()`, then, once they all answered, the `-` group (if any), so a fixer with no file never edits at the same time as the per-file fixers. The returned `fixes` keep the order of `args.repair.groups`.
  - Add tests in `tests/build-workflow.test.mjs`: (1) a step waiting on `S-404` is `blocked` with note `unknown step S-404 in Depends on`, no agent is launched for it, and a step waiting on it is `skipped`; (2) `S-001` waits `S-002` and `S-002` waits `S-001`: both `blocked` with note `Depends on loops`, zero agent calls, an independent `S-003` is `done`; (3) in a repair with groups `src/a.ts`, `-`, `src/b.ts`, the `-` fixer is launched after both file fixers answered, and `fixes` are in the groups' order.
- **Preserve:** every existing test still passes unchanged; the `RULE` string appears exactly once in workflow.md; no model name.
- **Verify:** `node --test tests/build-workflow.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'` → `ℹ pass 14` and `ℹ fail 0`

### S-012 — Make the repair loop and the host choice unambiguous on every host
- **Files:** Modify `skills/build/SKILL.md` · Modify `skills/build/references/dispatch.md`
- **Depends on:** S-003, S-004
- **Change:**
  - `SKILL.md` step 4: if the workflow tool refuses the run or is not allowed, use the subagent tool as `references/dispatch.md` says. In the solo case the tier column reads `solo`.
  - `SKILL.md` repair section: the fixers use `fixerPrompt` of `references/workflow.md` (through its `repair` args with a workflow tool, launched as `references/dispatch.md` says with a subagent tool, or yourself when `solo`); group only verify's failing `gate` lines and its `finding` lines; the group with no file runs after the per-file fixers. The loop: verify → on `FAIL` a repair round → print `repair <round> <fixed>/<groups>` → if the round fixed nothing, stop (the last verdict stands), else invoke verify again. Stop on `PASS`, on `UNPROVEN` (repair cannot help it), after three rounds, or when a round fixes nothing. End with verify's last verdict: a run that ends on `FAIL` or `UNPROVEN` is not done.
  - `dispatch.md`: the prompts are the template literals of `implementerPrompt`, `reviewerPrompt` and `fixerPrompt` in `references/workflow.md`, `${…}` filled in by hand. A host whose subagent tool returns only when every call of a message answered runs in waves: each message launches every ready implementer, then every reviewer of the ones that answered. On a `forbidden`: launch no new implementer; implementers already running finish and are reviewed. Drop "or a step its reviewer left out". The repair round: fixers of the groups with a file in one message, then the group with no file. Keep the `escalate` rule.
- **Preserve:** SKILL.md stays at 50 lines or fewer, keeps the forbidden-change rule exactly once and the words `Files`, `Depends on`, `Change`, `Preserve`, `Verify`, `repair`, and the three references; dispatch.md never says `solo` nor restates the rule; dispatch.md and SKILL.md together still name `done`, `blocked`, `skipped`, `unproven`.
- **Verify:** `npm run check` → exit 0

### Addendum 2 — second review (orchestrator decisions, retries of S-011 and S-012)
- Only the steps on a loop are `blocked` 'Depends on loops'; a step that only waits on one is `skipped` 'needs <id>'.
- File-sharing waits follow the `Depends on` topological order, not the order of `args.steps`, so a plan without a loop never reports one.
- Repair fixers of one round run one after another (the groups with a file, then `-`): fixers of different files may add tests to the same test file. This supersedes "with `parallel()`" in S-011 and "all at once" in S-012.
- SKILL.md: verify runs after every round that fixed something, the third included; step 1 also stops when `Depends on` names a step that does not exist, and ranges are written out; solo runs the loop of `references/dispatch.md` one step at a time.
- dispatch.md: after a `forbidden`, a step never launched or not allowed to retry is `skipped` 'stopped on a forbidden change'.

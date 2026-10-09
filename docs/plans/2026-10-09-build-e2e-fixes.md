---
status: approved
---

# build : corriger ce que le premier vrai run Workflow a montré

## Goal
Un build lancé par l'outil Workflow de Claude Code fait les choses suivantes :
- Il ne rejette plus une étape correcte à cause du travail que d'autres étapes font en même temps dans le même worktree.
- Il ne dépense plus trois implémenteurs pour une étape que le plan rend impossible.
- Il accepte un tier donné sous forme de nom de modèle nu.
- Il ne demande plus à la session de recopier chaque bloc d'étape dans `args`, ni de réémettre le script à chaque appel.

Le même comportement vaut sur un hôte qui n'a que l'outil de subagent.

## Locked constraints
- Q-001 (délégué) — Un `blocked_by` émis en dessous de `large` passe l'étape directement à `large`, avec sa raison, sans compter d'essai. C'est la même règle que pour `escalate`. Un `blocked_by` émis en `large` bloque l'étape tout de suite. Dans le run réel, S-004 (le test contredit le plan) a consommé trois implémenteurs qui ont tous rendu le même `blocked_by` → S-001, S-002, S-003.
- Q-002 (délégué) — Le reviewer d'une étape ne juge que les Files de cette étape et ignore les autres changements du worktree. La session cherche les changements faits hors de tout Files une seule fois, en lisant le diff entier → S-001, S-003.
- Q-003 (délégué) — Chaque subagent lit son étape dans le plan à partir de son id, et `args` n'a plus de champ `block`. La session écrit le script dans un fichier et passe `scriptPath` à l'outil, puis réutilise ce fichier pour les tours de réparation → S-001, S-002.

## Grounded facts
- Run réel `wf_879f562a-234`, sur un dépôt jetable à 4 étapes avec les tiers haiku max, sonnet et opus. Résultats : S-001 `done` en `medium`, S-002 et S-003 `done` en `small`, S-004 `blocked` en `large`. Le journal en détaille deux :
  - Le premier reviewer de S-001 a rejeté avec ces raisons : « README.md:2 — modified outside the step's Files » et « src/legacy.js:1 — new file outside the step's Files ». Or ces deux changements étaient le travail de S-003 et de S-004.
  - S-004 a reçu trois `blocked_by` identiques, en small, medium puis large.
- Run réel `wf_39a7ceb8-527` : en mode réparation, un correcteur sonnet a corrigé `mean([])` et ajouté un test.
- L'outil Workflow a accepté `scriptPath` vers un fichier extrait de `workflow.md` avec `awk '/^```js$/{f=1;next} /^```$/{f=0} f'` (224 lignes).
- Run réel `wf_180048cf-464`, avec le script de ce plan appliqué à blanc. Il passe le tier `medium` sous la forme du nom nu `"sonnet"`, et chaque étape est lue dans le plan. Résultats : S-001, S-002 et S-003 `done` en `small`, sans faux rejet ; S-004 `blocked` en `large` après 2 agents. Au total 8 agents au lieu de 11, 78 s au lieu de 116 s, 339 k tokens au lieu de 469 k.
- Chaque agent coûte environ 40 k tokens de base : 469 k pour 11 agents dans le premier run.
- `skills/build/references/workflow.md:3-8` — les `args`, dont `block` copié mot pour mot.
- `skills/build/references/workflow.md:25-26` — `on()` applique `Object.entries` sur le tier. Avec un nom nu (`"haiku"`), on obtient `{0:'h',…}` et le modèle de session.
- `skills/build/references/workflow.md:49-55` — le prompt implémenteur insère `${step.block}`. `:69-76` — le prompt reviewer insère `${step.block}`, lit « plus its new files » et vérifie « nothing is outside its Files ».
- `skills/build/references/workflow.md:203-212` — la gestion de `escalate` et de `blocked_by`.
- `skills/build/references/tiers.md:12`, `skills/build/references/dispatch.md:8`, `skills/build/SKILL.md:16-17`, `README.md:29`.
- `tests/build-workflow.test.mjs:18-26` — `step()` construit un `block`. `:79` — vérifie `### S-001 — demo step`. `:109-118` — le test actuel du `blocked_by`.

## Non-goals
- On ne déplace pas le worktree. Il reste dans `../<repo>-build-<slug>`. Dans un mode de permissions autre que bypass, une modification hors du projet peut demander une validation ; c'est seulement signalé à l'utilisateur.
- On ne regroupe pas les reviewers : un reviewer par étape reste la règle.
- Aucun changement dans verify ni dans blueprint.

## Steps

### S-001 — Corriger le script et la doc des args de workflow.md
- **Files:** Modify `skills/build/references/workflow.md`
- **Depends on:** none
- **Change:** Make exactly these replacements (each "old" text appears once):
  1. Replace line 3 (`For a host whose workflow tool runs a script of subagents with \`agent()\` and \`parallel()\`. Pass the script below verbatim, and as \`args\`:`) with these lines:
     ~~~~markdown
     For a host whose workflow tool runs a script of subagents with `agent()`. Write the script below to a file once, then run the tool with that file as its script path (or, if it takes no path, with the script text verbatim) and the `args` below; the repair rounds reuse the file:

     ~~~sh
     awk '/^```js$/{f=1;next} /^```$/{f=0} f' "<this skill's directory>/references/workflow.md" > "<a scratch directory>/build-steps.js"
     ~~~

     `args`:
     ~~~~
  2. In the `tiers` bullet, replace `each \`{ model, effort }\` read as` with `each \`{ model, effort }\` or a bare model name, read as`.
  3. In the `steps` bullet, replace `\`{ id, block, waits, files, tier, reviewTier, security }\`, where \`block\` is its \`### S-xxx\` block verbatim, \`waits\` its` with `\`{ id, waits, files, tier, reviewTier, security }\`, where \`waits\` is its`. At the end of that bullet, add the sentence ` Each subagent reads its step from the plan.`
  4. Replace the two lines `// A tier's { model, effort }; a key left out inherits the session's.` and `const on = (tier) =>` and the next line (`  Object.fromEntries(…)`) with:
     ~~~~js
     // A tier is { model, effort } or a bare model name; a key left out inherits the session's.
     const on = (tier) => {
       const value = (args.tiers || {})[tier]
       const opts = typeof value === 'string' ? { model: value } : value || {}
       return Object.fromEntries(Object.entries(opts).filter(([, setting]) => setting))
     }
     ~~~~
  5. In `implementerPrompt`, replace these four lines:
     ~~~~text
     Implement this step, nothing more:

     ${step.block}

     Touch only its Files, run its Verify once, use few tool calls.
     ~~~~
     with these three lines (the backticks inside the template literal escaped as `\``):
     ~~~~text
     Implement this step, nothing more: the \`### ${step.id}\` block of ${args.plan}.

     Other steps are built in this worktree at the same time: touch only its Files. Run its Verify once, use few tool calls.
     ~~~~
  6. In `reviewerPrompt`, replace these six lines:
     ~~~~text
     Review this step:

     ${step.block}

     Read its diff once: \`git diff HEAD -- ${step.files.join(' ')}\` plus its new files. Rerun its Verify once.
     Check every Change is in, Preserve is kept, nothing is outside its Files, no debug or dead code.${
     ~~~~
     with:
     ~~~~text
     Review this step: the \`### ${step.id}\` block of ${args.plan}.

     Other steps are built in this worktree at the same time: look only at its Files and ignore every other change. Read their diff once: \`git diff HEAD -- ${step.files.join(' ')}\`, and \`git status --short -- ${step.files.join(' ')}\` for the new ones. Rerun its Verify once.
     Check every Change is in, Preserve is kept, no debug or dead code.${
     ~~~~
  7. In `build()`, replace everything from the line `    // A smaller model that judges the step beyond it hands it to the largest at once; that try is not counted.` up to (not including) the line `  return { id: step.id, status: 'blocked', exit: last.exit, by: last.by, note: issues[0] }` with:
     ~~~~js
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
     ~~~~
- **Preserve:**
  - The `RULE` string appears exactly once.
  - No `block` is left anywhere in the script, and no model name appears.
  - The repair mode, the graph checks (`invalid`, Kahn, `onLoop`) and the `escalate` text of the implementer prompt are unchanged.
- **Verify:** `node -e "const t=require('fs').readFileSync('skills/build/references/workflow.md','utf8');const s=t.match(/\x60\x60\x60js\n([\s\S]*?)\n\x60\x60\x60/)[1];new (Object.getPrototypeOf(async function(){}).constructor)('agent','parallel','pipeline','phase','log','args','budget',s.replace(/^export const meta/m,'const meta'));if(/step\.block/.test(s))throw 'block left';console.log('ok')"` → prints `ok`

### S-002 — Mettre les tests du script à jour
- **Files:** Modify `tests/build-workflow.test.mjs`
- **Depends on:** S-001
- **Change:**
  1. In `step()` (L18-26), remove the `block` property.
  2. L79: replace `assert.match(first.prompt, /### S-001 — demo step/)` with `assert.match(first.prompt, /the `### S-001` block of \/plan\.md/)`.
  3. Replace the whole test at L109-118 (`'a blocked_by retries one tier up with it as the issue, without a review'`) with this test:
     ~~~~js
     test('a blocked_by below large hands the step to large without spending a try or a review', async () => {
       let tries = 0
       const { result, calls } = await run({ steps: [step('S-001')] }, (kind) =>
         kind === 'implement' && tries++ === 0 ? { exit: -1, blocked_by: 'the test contradicts the plan' } : pass(kind),
       )
       assert.deepEqual(result.steps[0], { id: 'S-001', status: 'done', exit: 0, by: 'large' })
       const [small, large] = calls.filter((call) => call.kind === 'implement')
       assert.equal(small.opts.model, 'tiny')
       assert.equal(large.opts.model, undefined)
       assert.match(large.prompt, /A smaller model handed this step to you: the test contradicts the plan/)
       assert.equal(calls.filter((call) => call.kind === 'review').length, 1)
     })

     test('a blocked_by on the large tier blocks the step at once', async () => {
       const { result, calls } = await run({ steps: [step('S-001', { tier: 'large' })] }, (kind) =>
         kind === 'implement' ? { exit: 1, blocked_by: 'the test contradicts the plan' } : pass(kind),
       )
       assert.deepEqual(result.steps[0], {
         id: 'S-001',
         status: 'blocked',
         exit: 1,
         by: 'large',
         note: 'the test contradicts the plan',
       })
       assert.equal(calls.length, 1)
     })
     ~~~~
  4. At the end of the file, add:
     ~~~~js
     test('a tier given as a bare model name runs on that model', async () => {
       const { calls } = await run({ tiers: { small: 'tiny', medium: 'mid' }, steps: [step('S-001')] }, pass)
       assert.deepEqual(calls[at(calls, 'implement', 'S-001')].opts.model, 'tiny')
       assert.equal(calls[at(calls, 'implement', 'S-001')].opts[0], undefined)
       assert.equal(calls[at(calls, 'review', 'S-001')].opts.model, 'mid')
     })

     test('the reviewer looks only at its own Files, since other steps share the worktree', async () => {
       const { calls } = await run({ steps: [step('S-001', { files: ['a.md', 'b.md'] })] }, pass)
       const review = calls[at(calls, 'review', 'S-001')].prompt
       assert.match(review, /look only at its Files and ignore every other change/)
       assert.match(review, /git status --short -- a\.md b\.md/)
       assert.doesNotMatch(review, /nothing is outside its Files/)
     })
     ~~~~
- **Preserve:** every other test unchanged.
- **Verify:** `node --test tests/build-workflow.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'` → `ℹ pass 20` and `ℹ fail 0`

### S-003 — Aligner SKILL.md, dispatch.md et tiers.md
- **Files:** Modify `skills/build/SKILL.md:16-17` · Modify `skills/build/references/dispatch.md:8` · Modify `skills/build/references/tiers.md:12`
- **Depends on:** none
- **Change:**
  - `SKILL.md` L16: replace `(\`agent()\`, \`parallel()\`)` with `(\`agent()\`)`.
  - `SKILL.md` L17: replace `Read the whole diff (\`git diff\` plus new files).` with `Read the whole diff (\`git diff\` plus new files) and revert any change to a file no step lists.`
  - `dispatch.md` L8: replace `A \`blocked_by\` retries one tier up with it as the issue. An \`escalate\` hands the step straight to \`large\` with its reason, and that try does not count.` with `An \`escalate\`, or a \`blocked_by\` below \`large\`, hands the step straight to \`large\` with its reason, and that try does not count; a \`blocked_by\` on \`large\` blocks the step.`
  - `dispatch.md` L5: after `A step waits for its \`Depends on\` and for any earlier step that shares a file.`, add ` Each prompt names its step by id; the subagent reads it from the plan.`
  - `tiers.md` L12: replace `A \`small\` or \`medium\` implementer that judges the step beyond it hands it straight to \`large\`, without spending a try.` with `A \`small\` or \`medium\` implementer that judges the step beyond it, or that a rule stops, hands it straight to \`large\` without spending a try; \`large\` stopped by a rule blocks the step.`
- **Preserve:**
  - `SKILL.md` stays at 50 lines or fewer, and the forbidden-change rule appears in it exactly once.
  - `dispatch.md` never says `solo` and does not restate the rule.
- **Verify:** `npm run validate 2>&1 | tail -1` → `✓ 3 skill(s) valid: blueprint, build, verify`

### S-004 — README
- **Files:** Modify `README.md:29`
- **Depends on:** none
- **Change:** Replace `one fixer per file, \`medium\` then \`large\`, three rounds at most` with `one fixer per file, one after another, \`medium\` then \`large\`, three rounds at most`.
- **Preserve:** the rest of the README; `solo` never appears in it.
- **Verify:** `grep -c 'one fixer per file, one after another' README.md` → `1`

### S-005 — Vérification globale
- **Files:** none
- **Depends on:** S-001, S-002, S-003, S-004
- **Change:** none.
- **Preserve:** —
- **Verify:** `npm run check` → exit 0

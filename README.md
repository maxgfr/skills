# skills

My agent skills. One install, one place to keep them.

They are process skills: they change how an agent works rather than what it knows. Small, composable, and meant to be hacked on — install them, read them, make them yours.

The set grows. Today it is one loop, closed: an agent plans against a repo it half-remembered and a decision you never made, builds something else, and tells you it is done. `blueprint` asks until the decision is yours and grounds the plan in the repo. `build` executes that plan, one proven step at a time, in a worktree, without asking again. `verify` turns completion into an evidence-backed verdict. All three are manual: nothing runs until you invoke a skill by name, and [one setting per host](#manual-or-automatic) turns that around if you want it.

## Install

**Codex plugin** — managed install with updates:

```bash
codex plugin marketplace add maxgfr/skills
codex plugin add maxgfr@maxgfr-skills
```

**Claude Code plugin** — the same managed plugin:

```text
/plugin marketplace add maxgfr/skills
/plugin install maxgfr
```

**Standalone skills** — copies editable skill files into the host's skills
directory:

```bash
npx skills add maxgfr/skills
```

Pick one installation path per host. The skill names are host syntax, not a
setting:

| Host | Example |
|---|---|
| Codex | `$verify light docs/plans/x.md` |
| Claude plugin | `/maxgfr:verify light docs/plans/x.md` |
| Standalone Claude skill | `/verify light docs/plans/x.md` |

Every installation keeps the skills explicit-only, and
[Manual or automatic](#manual-or-automatic) is where you change that. The plugin
registers no session or stop hooks. From a checkout, `node hooks/session-start.mjs --plain`
prints an optional router for an instructions file; `hooks/stop-guard.mjs` is an
optional guard you can wire yourself.

[skills.sh](https://skills.sh) builds its directory from recorded installs, so the listing for this repo appears on its own once there are some. Neither command depends on it — `npx skills add` reads the repository directly.

Installing takes the whole set, or pick what you want:

```bash
npx skills add maxgfr/skills --list          # browse first
npx skills add maxgfr/skills --skill verify  # take one — each is self-contained
```

## Skills

| Skill | What it does |
|---|---|
| [`blueprint`](./skills/blueprint) | Interrogates you, grounds the design in the repo, and writes the plan the other two hold the work to. |
| [`build`](./skills/build) | Executes an approved plan step by step in a worktree — one implementer per step, a reviewer and a cheat guard on each — and hands off to `verify`. Can delegate the coding to the other CLI agent. |
| [`verify`](./skills/verify) | Runs the repo's gates once by default; explicit richer tiers analyze the change and repair blockers. |

One loop. `blueprint` writes the promise to `docs/plans/<date>-<slug>.md`;
`build` reads that file as its schedule; `verify light` reads it as the promise
it checks the diff against. Three skills, one file, nothing to configure.

```text
$blueprint                 # grill → ground → write the plan → approve
$build docs/plans/…        # worktree → one agent per step → review → guard → step table
$verify light docs/plans/… # gates, conformance, defect hunt → fix the blockers

$blueprint auto            # all three from one call: approve, build, then verify light
```

Examples below use Codex syntax; use the table above on Claude.

`build` and `verify` are **fire-and-forget**: one invocation, deterministic
routing, and the enabled work launches in the same turn. No clarifying question,
no summary, no "shall I proceed". `build` and plan-backed richer verification
still require the approved plan they were given.

**Name the plan on a richer `verify light` call.** It ranks your host's own
plan-mode artifact above `docs/plans/`, so leaving the path implicit can pick up
a newer scratch file from the same session instead of what `blueprint` wrote.

Both ends can be **crosschecked**: one read-only consultation of the *other* CLI
agent — Codex when you are in Claude Code, Claude when you are in Codex. It is
the one thing a bigger budget on your own model cannot buy, and the only part of
this repo that depends on something other than Node. `build peer` goes one step
further and lets that other agent write the code.

---

### blueprint

```text
$blueprint              # the full pass
$blueprint grill        # the interview only — no design, no artifact
$blueprint crosscheck   # + the other agent challenges the plan before you approve it
$blueprint <path>       # harden a plan that already exists
```

Plans fail in two ways: they answer a question you never agreed to, or they
assert something about the repo that is not true. The skill is built against
both.

The interview is a **design tree**. Its frontier is every decision whose
prerequisites are already settled — those get asked *now*, as one numbered round
with a recommended answer on each, so a round can be answered in a line. Answers
push the frontier outward. It stops when the frontier is empty, which is a
structural condition rather than a judgement about having asked enough. Finding
facts is never your job: a question the repository can answer is one the skill
goes and reads.

Every answer becomes a locked `Q-xxx` constraint in the artifact, every fact a
cited `path:line`, and every step a `S-xxx` with an exact command and a binary
completion criterion. The plan is written to be executed by an agent that was
not in the conversation — which is what makes `/clear` before implementing safe,
and the skill checks that it really is self-contained before suggesting it.

The interview owes its shape to [Matt Pocock's `grilling`](https://github.com/mattpocock/skills);
the artifact owes its task blocks to superpowers' `writing-plans`.

---

### build

```text
$build                  # the newest approved plan under docs/plans/
$build <path>           # that plan
$build peer             # the other CLI agent writes the code, one step at a time
$build then verify      # after `built`, run verify light on the same plan, same turn
```

A plan is a promise; a build is the promise kept one step at a time, with the
proof for each step run before the next starts. `build` exists so the model
that planned the change *manages* the work instead of doing it in its own
context — and so "I implemented the plan" becomes a table of exit codes.

Phase 0 is a script. [`plan-steps.mjs`](./skills/build/scripts/plan-steps.mjs)
finds the plan, refuses in one line if it is not `status: approved`, and turns
its `S-xxx` steps into **dependency waves**: steps run in order, and steps in
the same wave run in parallel — unless two of them name the same file, or one
names none, in which case they are serialised, because implementers share one
worktree and "they probably won't collide" is not a schedule. Then a worktree is
made, a baseline is taken, and the Workflow is called. Nothing is asked.

Per step, three agents:

- an **implementer** gets the step verbatim, touches only its `Files:`, runs
  its `Verify:` command and reports the exit code;
- a **reviewer** reads the diff against the step's Change and Preserve, judges
  quality, and **runs the Verify command again** — the implementer's report is
  a claim, the reviewer's run is the evidence;
- the **guard** — the same
  [`forbidden-repairs.mjs`](./skills/verify/scripts/forbidden-repairs.mjs)
  `verify` uses — scans the whole diff. One forbidden hunk is reverted and the
  build stops; nothing after it runs.

A step is `done` only when all three agree. Otherwise one retry with the
reviewer's issues, then `blocked`, and its dependents are `skipped` by name,
never attempted. What comes back is the step table, the worktree, a record in
`.agents/build/<timestamp>/BUILD.md`, and the host-correct `verify light
<plan>` handoff that analyzes the change and repairs blockers. Bare `verify`
remains the explicit gates-only check.

**`peer` mode** replaces the implementer with the other CLI agent, running in
the worktree with a write sandbox and nothing more: `--sandbox workspace-write`
for Codex, `acceptEdits` for Claude, no bypass flag on either, and the flags are
pinned by tests. The peer writes; it does not get to say whether it succeeded —
the reviewer and the guard run exactly as before, and its own report is used by
nobody. An unavailable peer stops the build as `peer_unavailable`; the host does
not quietly take over the work it was asked to delegate.

What it will not do: plan, verify the whole, renumber a step, build on your
branch, commit, or ask. Full documentation: [`skills/build/`](./skills/build).

---

### verify

```text
$verify              # every detected gate once; no diff analysis or repair
$verify light        # gates + plan + defect hunt → fix blockers → re-verify
$verify normal       # + behaviour proof, panels of three on blockers
$verify deep         # every lens, panels throughout, red-green audit
$verify ultralight   # explicit spelling of the one-shot default
$verify report       # read-only verdict, no writes
$verify crosscheck   # + lane E — a second opinion from the other CLI agent
$verify main         # explicit fixed point
```

The no-argument default resolves configuration first, detects the repo's gates,
and runs them once with at most one low-effort agent. It does not read the diff
or promise, build a matrix, judge model-authored findings, invoke a reporter, or
repair a failure. A green result means the blocking commands passed, not that
the code is right; non-blocking failures remain visible evidence. With no gate
it returns `UNPROVEN` without escalating. Use `verify light`
when the change itself needs analysis and repair.

Explicit analysis tiers cost more because every candidate finding gets a
skeptic and blocking claims may get a panel. A `light` run costs ~7 agents when
it finds nothing and ~16 when it surfaces nine candidates, even if all nine are
refuted. `deep` on a large diff can reach the forties.

What no tier touches: the gates always run, and every candidate still faces at
least one skeptic. The verdict line always names the tier, so a cheap PASS can
never be read as a thorough one.

Every stage runs on your session's model by default — a verification is never
spawned on a bigger model than the work that produced it.

The richer pipeline runs enabled lanes in parallel, in sub-agents, so the noise never reaches your session:

- **Gates** — the repo's real commands. Not the ones an agent imagines: the ones derived from your lockfile, your manifests, and your CI workflow, because the CI is what actually defines green.
- **Plan conformance** — every clause of the plan it was given, marked implemented / partial / missing / contradicted, plus anything in the diff that nobody asked for. Code that exists but is never called is `partial`, not done.
- **Defect hunt** — six finders with distinct lenses (correctness, failure handling, state & async, trust & input, wiring, leftovers). Diverse beats redundant: three copies of the same reviewer find the same easy bug three times.
- **Behaviour proof** — it *runs the thing*. Starts the server and hits it, executes the CLI with real arguments. In `--behavior full` it also reverts each fix and re-runs the test that covers it: a test that stays green with the fix removed proves nothing, and gets reported.

Then every candidate finding faces a skeptic **whose instruction is to refute it**. Blocking claims face a panel of three and need two survivors. What reaches you has already been attacked; what died is a count, auditable in the report file.

Three laws hold the whole thing up:

1. **No verdict without an executed command.** A gate that could not run is reported as *not run*, never as passing.
2. **No finding without a refutation attempt.**
3. **No repair that only silences the checker.** When enabled, the fix loop may not skip a test, add `@ts-ignore`, widen to `any`, swallow an error, edit CI, or rewrite the plan to match the code. This is enforced by [a script](./skills/verify/scripts/forbidden-repairs.mjs) that scans the diff the loop just produced. If the only path to green is a suppression, the loop stops and says so.

Output is a compact verdict — `PASS`, `FAIL`, or `UNPROVEN` when nothing was
actually checked — an evidence table and an explicit list of what was not
verified. Richer runs add ranked findings and requirement coverage. The default
report explicitly says that diff, promise, defect, behaviour, and repair work
did not run. Reports go to `.agents/verify/<timestamp>/`.

Every enabled stage uses the session model unless configured otherwise. The
default only enables the low-effort gates stage. In richer tiers, planner and
reporter can use a cheaper model; pinning finders or judges down is riskier
because a wrong decision costs repair and re-verification.

```json
{
  "tier":   "light",
  "models": { "planner": "fable", "reporter": "fable" },
  "lanes":  { "behavior": "full" },
  "loop":   { "max_iterations": 3, "fix_severity": "blocking" }
}
```

Drop that in `.agents/verify.json` for the repo, `$CODEX_HOME/verify.json` for
Codex, or `~/.claude/verify.json` for Claude. Full reference:
[`references/config.md`](./skills/verify/references/config.md).

Full documentation lives with the skill: [`skills/verify/`](./skills/verify).

---

### crosscheck

Not a skill — an option on both of them.

```text
$blueprint crosscheck   # the other agent challenges the plan before you approve it
$verify crosscheck      # the other agent gets a second look at the diff
```

Every other lens either skill offers is the same model looking at the same work
differently. This one is a **different model looking at it at all**, in a
read-only sandbox, with no ability to write, approve, or consult a peer of its
own.

What makes it worth the tokens is that the peer has to *read the repository* and
cite what it read. A second model reasoning from the same prose is a second
autocomplete; one that has to produce a path, a line, and the text at that line
is doing something your own model cannot do for you. Every citation is checked
before you ever see the objection — path resolves, line exists, quoted text is
actually there — and an objection whose citation does not hold up is dropped
rather than shown with a caveat.

The peer never renders a verdict. In `blueprint` its objections are adjudicated
against your locked constraints and the repo, and an accepted one has to change
the plan visibly. In `verify` they are candidates like any other and face the
same skeptics.

It needs the other CLI installed and authenticated, which is the one dependency
here that is not Node. When it is missing, unauthenticated, or slow, the run
completes anyway and says it was **not** crosschecked — in the report file as
well as on screen. That word is the whole point; a run that never reached the
peer must not read as one the peer signed off on.

Costs one agent plus a skeptic per surviving objection, and roughly 8–25k tokens.
Skip it for a local reversible change with one obvious target: it earns its keep
when a wrong plan means expensive rework — migrations, auth, public contracts,
concurrency, or a repo you do not know well.

---

### Optional hook helpers

[`hooks/hooks.json`](./hooks/hooks.json) is intentionally empty. The plugin does
not inject routing context and does not block a turn that has not run `verify`.

Users who want local automation can wire the helpers themselves:

- [`session-start.mjs`](./hooks/session-start.mjs) renders
  [`router.md`](./hooks/router.md) with the active host's invocation syntax.
- [`stop-guard.mjs`](./hooks/stop-guard.mjs) checks whether source changed after
  the newest verify report and can return a one-per-session block response.

Both helpers are dependency-free, always exit 0, and are tested as standalone
processes. Manual wiring is local configuration, outside the plugin contract.

---

## House style

What every skill here follows, and what a new one has to earn:

- **The description is the trigger.** It decides whether the skill fires at all, so it says *when to use this* in the words someone would actually type. CI rejects one that does not.
- **Anything with a right answer is a script, not a prompt.** Detecting commands, scanning a diff for forbidden patterns — those are dependency-free `.mjs` with tests. A model asked to be a linter is a linter that sometimes hallucinates.
- **`SKILL.md` routes; `references/` holds the detail.** A model reads the whole SKILL.md every time it triggers, and a reference only when it needs that phase.
- **Each one says what it will not do.** A skill that lists its refusals is one you can hand a loop.

The engines ship with the skills and run on their own:

```bash
node skills/verify/scripts/detect-gates.mjs --cwd . --pretty   # what "green" means here
git diff | node skills/verify/scripts/forbidden-repairs.mjs    # did that fix cheat?
node skills/verify/scripts/resolve-config.mjs --cwd . --host codex -- deep
node skills/build/scripts/plan-steps.mjs --cwd . --pretty      # which plan, which waves
node skills/build/scripts/orchestration-policy.mjs --pretty   # shared retry/acceptance laws
node skills/build/scripts/fallback-plan.mjs --cwd . --host codex
node skills/verify/scripts/fallback-plan.mjs --cwd . --host codex -- deep
node skills/blueprint/scripts/peer-run.mjs --host claude …     # ask the other agent
node skills/build/scripts/peer-build.mjs --host claude …       # let it write one step
node scripts/doctor.mjs --host codex                            # installation diagnosis
```

All of them are deterministic, dependency-free, and covered by tests. They work outside the skill too — `forbidden-repairs.mjs` on a PR diff is a reasonable CI step on its own.

Some ship in more than one skill, byte-identical — `peer-run.mjs` in three,
`forbidden-repairs.mjs` in two — so that `--skill build` installs something
complete. A test fails if the copies drift. What `peer-run.mjs` owns is
everything with a right answer: which binary, which read-only flags, how long to
wait — and whether the `path:line` the peer cited actually contains the text it
quoted. A citation that does not resolve drops its objection before anyone
argues about it, because a fabricated line does not get better by being
mentioned with a caveat.

## My other skills

Not everything belongs here. A skill built around a substantial engine — a taint analyser, an indexer, a translation pipeline — gets its own repo and its own release cycle. This one is for process skills, which are mostly prose and a script or two.

The current catalogue of separately published skills lives on my [GitHub profile](https://github.com/maxgfr).

## Development

```bash
npm ci
npm run validate   # frontmatter, naming, line budget, dead references, manifests, hooks, script syntax
npm test           # the engines, both workflows and both hooks, against fixtures
npm run test:e2e:hosts  # both hosts: discovery, routing matrix, refusals, full chain fixture
npm run check      # everything, as CI runs it
```

The default host test is authentication-free and CI-safe. It covers explicit
English/French discovery, implicit non-selection, one refusal per skill, and a
three-skill fixture whose source, refs, worktrees, and reports are snapshotted
before and after. Run `node scripts/e2e-hosts.mjs --live` to add an
isolated Codex marketplace install and Claude's native plugin validation.

The skills ship dependency-free; `npm ci` installs the release tooling only.
Releases are cut by semantic-release from conventional commits on `main` — `fix:`
for a patch, `feat:` for a minor — which versions `package.json` and
both `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` together,
writes the changelog and tags.

`npm run validate` is opinionated on purpose: model-invoked skills need a clear
trigger, while explicit-only skills may use a human-facing summary. A skill
pointing at a file that does not exist also fails the build.

Adding a skill: [CONTRIBUTING.md](./CONTRIBUTING.md) · writing one well: [AGENTS.md](./AGENTS.md).

## License

MIT

## Manual or automatic

`blueprint`, `build` and `verify` ship **explicit-only**, and every installation
path keeps them that way: they run when you invoke them, never when the agent
feels like it. Use `$name` in Codex, `/name` in Claude Code or OpenCode, and
`/maxgfr:name` when installed as a Claude plugin.

Letting the agent choose a skill is one setting per host, applied to the
**installed** copy of that skill:

| Host | Shipped, manual | Automatic |
| --- | --- | --- |
| Claude Code | `disable-model-invocation: true` in `SKILL.md` | delete that line, or set it to `false` |
| Codex | `allow_implicit_invocation: false` under `policy:` in `agents/openai.yaml` | set it to `true` |
| OpenCode | `metadata.opencode/autoinvoke: 'false'` in `SKILL.md` | delete that entry, or set it to `'true'` |

Claude Code can do it without touching the file: put
`"skillOverrides": { "verify": "on" }` in `settings.json`, where
`"user-invocable-only"` forces manual mode back. Plugin installs ignore
`skillOverrides`, so edit the frontmatter of the plugin copy instead. Updating
or reinstalling restores the shipped default, so reapply the change afterwards.

OpenCode V1 reads no `autoinvoke` metadata. Keep them manual with
`permission.skill` in `~/.config/opencode/opencode.json` or the project
configuration, retaining unrelated permissions; dropping an entry, or setting
`"allow"`, is what lets the agent reach that skill:

```json
{
  "permission": {
    "skill": {
      "blueprint": "deny",
      "build": "deny",
      "verify": "deny"
    }
  }
}
```

On OpenCode 1.18.30 those rules hide the skills from the agent and reject
skill-tool loading, while the explicit `/name` commands still work. Installation
with `skills add` does not write this OpenCode V1 configuration.

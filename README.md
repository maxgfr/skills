# skills

My agent skills. One install, one place to keep them.

They are process skills: they change how an agent works rather than what it knows. Small, composable, and meant to be hacked on — install them, read them, make them yours.

The set grows. Today it is one loop, closed: an agent plans against a repo it half-remembered and a decision you never made, builds something else, and tells you it is done. `blueprint` asks until the decision is yours and grounds the plan in the repo. `build` executes that plan, one proven step at a time, in a worktree, without asking again. `verify` refuses to call it done until the evidence says so. A session-start hook puts the three in front of the model before its first message; a stop hook refuses to end a turn that changed source and never verified it.

## Install

**Any agent** — copies editable files into your repo:

```bash
npx skills add maxgfr/skills
```

**Claude Code** — as a managed plugin that updates when I ship:

```
/plugin marketplace add maxgfr/skills
/plugin install maxgfr
```

Pick one. Installing both leaves you with every skill twice.

The two paths name the skills differently, and that is the plugin's doing rather than a setting: a plugin namespaces what it ships, so `verify` is invoked as **`/maxgfr:verify`**. The `npx` path copies the files into `.claude/skills/`, where the same skill is plain **`/verify`**. Both run the identical skill; only the name you type changes.

They differ in one more way: **the plugin ships the hooks** that make the skills fire on their own (see [automatic](#automatic)). The `npx` path copies skills only. To get the same effect there, add the router to your instructions file — `node hooks/session-start.mjs --plain >> AGENTS.md` from a checkout — and, if you want the stop guard, wire `hooks/stop-guard.mjs` as a `Stop` hook in your settings.

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
| [`verify`](./skills/verify) | Proves that work just produced actually works, then fixes the blockers. |
| [`using-maxgfr`](./skills/using-maxgfr) | The router the session-start hook injects: when each of the three fires, and what it yields to other skills. |

One loop. `blueprint` writes the promise to `docs/plans/<date>-<slug>.md`;
`build` reads that file as its schedule; `verify` reads it as the promise it
checks the diff against. Three skills, one file, nothing to configure.

```
/blueprint                 # grill → ground → write the plan → approve
/build docs/plans/…        # worktree → one agent per step → review → guard → step table
/verify docs/plans/…       # gates, conformance, defect hunt → fix the blockers

/blueprint auto            # all three from one call: approve, then build, then verify
```

`build` and `verify` are **fire-and-forget**: one invocation, a deterministic
Phase 0, and the Workflow launches in the same turn. No clarifying question, no
summary, no "shall I proceed" — the approval was the plan file. The only refusal
is a missing or unapproved plan, in one line.

**Name the plan on the `verify` call.** It ranks your host's own plan-mode
artifact above `docs/plans/`, so a bare `/verify` can pick up a scratch file
from the same session — newer, and not what `blueprint` wrote.

Both ends can be **crosschecked**: one read-only consultation of the *other* CLI
agent — Codex when you are in Claude Code, Claude when you are in Codex. It is
the one thing a bigger budget on your own model cannot buy, and the only part of
this repo that depends on something other than Node. `build peer` goes one step
further and lets that other agent write the code.

---

### blueprint

```
/blueprint              # the full pass
/blueprint grill        # the interview only — no design, no artifact
/blueprint crosscheck   # + the other agent challenges the plan before you approve it
/blueprint <path>       # harden a plan that already exists
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

```
/build                  # the newest approved plan under docs/plans/
/build <path>           # that plan
/build peer             # the other CLI agent writes the code, one step at a time
/build then verify      # after `built`, run verify on the same plan, same turn
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
`.agents/build/<timestamp>/BUILD.md`, and the `/verify <plan>` call that proves
the whole.

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

```
/verify              # gates + plan + defect hunt → fix the blockers → re-verify
/verify normal       # + behaviour proof, panels of three on blockers
/verify deep         # every lens, panels throughout, red-green audit
/verify ultralight   # gates only — no defect hunt, no plan check
/verify report       # read-only verdict, no writes
/verify crosscheck   # + lane E — a second opinion from the other CLI agent
/verify main         # explicit fixed point
```

A run costs agents, and most of them are skeptics — one per candidate finding,
a panel per blocking one. So the cost scales with what the finders turn up, not
with the tier alone: the default costs ~7 agents when it finds nothing and ~16
when it surfaces nine, even if all nine are refuted and the verdict is `PASS`.
`ultralight` is 1 flat; `deep` on a large diff is where this reaches the forties.

**The default verifies the change.** It reads the diff for defects, checks it
against the promise, and refutes every candidate before you see it. What it
defers to `normal` is the behaviour proof — the lane that starts servers and runs
CLIs — and the three-skeptic panel on blocking claims.

`ultralight` is the odd one out and deliberately so: it runs your gates and
nothing else, produces no model-authored finding, and so has nothing to be wrong
about. A green `ultralight` means the commands passed, not that the code is
right. Use it when the gates really are the question; it is not a merge gate.

What no tier touches: the gates always run, and every candidate still faces at
least one skeptic. The verdict line always names the tier, so a cheap PASS can
never be read as a thorough one.

Every stage runs on your session's model by default — a verification is never
spawned on a bigger model than the work that produced it.

At `normal` and above it runs four lanes in parallel, in sub-agents, so the noise never reaches your session:

- **Gates** — the repo's real commands. Not the ones an agent imagines: the ones derived from your lockfile, your manifests, and your CI workflow, because the CI is what actually defines green.
- **Plan conformance** — every clause of the plan it was given, marked implemented / partial / missing / contradicted, plus anything in the diff that nobody asked for. Code that exists but is never called is `partial`, not done.
- **Defect hunt** — six finders with distinct lenses (correctness, failure handling, state & async, trust & input, wiring, leftovers). Diverse beats redundant: three copies of the same reviewer find the same easy bug three times.
- **Behaviour proof** — it *runs the thing*. Starts the server and hits it, executes the CLI with real arguments. In `--behavior full` it also reverts each fix and re-runs the test that covers it: a test that stays green with the fix removed proves nothing, and gets reported.

Then every candidate finding faces a skeptic **whose instruction is to refute it**. Blocking claims face a panel of three and need two survivors. What reaches you has already been attacked; what died is a count, auditable in the report file.

Three laws hold the whole thing up:

1. **No verdict without an executed command.** A gate that could not run is reported as *not run*, never as passing.
2. **No finding without a refutation attempt.**
3. **No repair that only silences the checker.** The fix loop may not skip a test, add `@ts-ignore`, widen to `any`, swallow an error, edit CI, or rewrite the plan to match the code. This is enforced by [a script](./skills/verify/scripts/forbidden-repairs.mjs) that scans the diff the loop just produced — not by asking the model nicely. If the only path to green is a suppression, the loop stops and says so.

Output is a compact verdict — `PASS`, `FAIL`, or `UNPROVEN` when nothing broke because nothing was actually checked — an evidence table, ranked findings with concrete failure scenarios, and an explicit list of what could **not** be verified, including any lane that errored. Full detail goes to `.claude/verify/<timestamp>/`.

Every stage's model is configurable, and by default every stage is the same one:
whatever your session is running. Pinning is opt-in. The pin worth knowing is the
**scaffolding split** — the planner decides what gets verified and the reporter
writes down what happened, so both can drop to a cheap model without losing
anything. Pinning the finders or the judges *down* is the false economy: a wrong
finding costs a fix round, a re-verification and your attention.

```json
{
  "tier":   "normal",
  "models": { "planner": "fable", "reporter": "fable" },
  "lanes":  { "behavior": "full" },
  "loop":   { "max_iterations": 3, "fix_severity": "blocking" }
}
```

Drop that in `.claude/verify.json` (this repo) or `~/.claude/verify.json` (everywhere). Full reference: [`references/config.md`](./skills/verify/references/config.md).

Full documentation lives with the skill: [`skills/verify/`](./skills/verify).

---

### crosscheck

Not a skill — an option on both of them.

```
/blueprint crosscheck   # the other agent challenges the plan before you approve it
/verify crosscheck      # the other agent gets a second look at the diff
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

### automatic

A skill the model never thinks to look up is a skill that never fires. The
plugin ships two hooks, in [`hooks/hooks.json`](./hooks/hooks.json), so that it
does not have to think of it:

**Session start** (`startup`, `/clear`, and after a compaction) injects
[`using-maxgfr`](./skills/using-maxgfr/SKILL.md) — a sixty-line router that
says when each of the three skills fires, in the words you would type (English
and French), that `build` and `verify` are launched rather than discussed, and
that TDD, debugging, review and brainstorming belong to whichever *other* skill
you have installed for them. It names only these three, so it sits beside
superpowers or Matt Pocock's set without arguing with either.

**Stop** runs [`stop-guard.mjs`](./hooks/stop-guard.mjs): two git commands, a
few stats, no model. If a source file was modified or added and no verify
report is newer than it, the turn is blocked — **once per session** — with the
reason. Plans, reports, notes and prose never trigger it; a run of `verify`
clears it. Switch it off with `MAXGFR_NO_STOP_GUARD=1`, or `"stop_guard":
false` in `~/.claude/verify.json` or the repo's `.agents/verify.json`.

Both scripts are dependency-free, always exit 0, finish well inside the hook
budget, and are tested as processes against throwaway repositories. The
validator checks that every command `hooks.json` names actually exists — a
hook the host cannot start is a plugin that silently never became automatic.

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
node skills/build/scripts/plan-steps.mjs --cwd . --pretty      # which plan, which waves
node skills/blueprint/scripts/peer-run.mjs --host claude …     # ask the other agent
node skills/build/scripts/peer-build.mjs --host claude …       # let it write one step
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
npm run check      # everything, as CI runs it
```

To see the hooks fire for real: `claude --plugin-dir .` from a checkout, and the
router appears in the first message's context.

The skills ship dependency-free; `npm ci` installs the release tooling only.
Releases are cut by semantic-release from conventional commits on `main` — `fix:`
for a patch, `feat:` for a minor — which versions `package.json` and
`.claude-plugin/plugin.json` together, writes the changelog and tags.

`npm run validate` is opinionated on purpose: a skill whose description does not say *when to use it* never triggers, and a skill pointing at a file that does not exist wastes a real agent's turn discovering that. Both fail the build.

Adding a skill: [CONTRIBUTING.md](./CONTRIBUTING.md) · writing one well: [AGENTS.md](./AGENTS.md).

## License

MIT

# skills

My agent skills. One install, one place to keep them.

They are process skills: they change how an agent works rather than what it knows. Small, composable, and meant to be hacked on — install them, read them, make them yours.

The set grows. Today it is the two ends of one loop: an agent tells you it is done, is wrong often enough that you check anyway — and is wrong at least as often *before* that, having planned against a repo it half-remembered and a decision you never made.

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

[skills.sh](https://skills.sh) builds its directory from recorded installs, so the listing for this repo appears on its own once there are some. Neither command depends on it — `npx skills add` reads the repository directly.

Installing takes the whole set, or pick what you want:

```bash
npx skills add maxgfr/skills --list          # browse first
npx skills add maxgfr/skills --skill verify  # take one — each is self-contained
```

## Skills

| Skill | What it does |
|---|---|
| [`blueprint`](./skills/blueprint) | Interrogates you, grounds the design in the repo, and writes the plan `verify` will hold the work to. |
| [`verify`](./skills/verify) | Proves that work just produced actually works, then fixes the blockers. |

They are two ends of one loop. `blueprint` writes the promise to
`docs/plans/<date>-<slug>.md`; `verify` reads that same file as the promise it
checks the diff against. Neither needs configuring to find the other.

```
/blueprint            # grill → ground → write the plan → approve
                      # then /clear, and implement from the file
/verify docs/plans/…  # gates, conformance, defect hunt → fix the blockers
```

Both can be **crosschecked**: one read-only consultation of the *other* CLI
agent — Codex when you are in Claude Code, Claude when you are in Codex. That is
the one thing a bigger budget on your own model cannot buy.

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
node skills/blueprint/scripts/peer-run.mjs --host claude …     # ask the other agent
```

All three are deterministic, dependency-free, and covered by tests. They work outside the skill too — `forbidden-repairs.mjs` on a PR diff is a reasonable CI step on its own.

`peer-run.mjs` ships **twice**, byte-identical in both skills, so that
`--skill blueprint` and `--skill verify` each install something complete. A test
fails if the copies drift. What it owns is everything with a right answer: which
binary, which read-only flags, how long to wait — and whether the `path:line` the
peer cited actually contains the text it quoted. A citation that does not resolve
drops its objection before anyone argues about it, because a fabricated line does
not get better by being mentioned with a caveat.

## My other skills

Not everything belongs here. A skill built around a substantial engine — a taint analyser, an indexer, a translation pipeline — gets its own repo and its own release cycle. This one is for process skills, which are mostly prose and a script or two.

| | |
|---|---|
| [ultrasec](https://github.com/maxgfr/ultrasec) | Cross-file security audit: source→sink taint, CVE correlation, adversarially verified findings |
| [ultraeval](https://github.com/maxgfr/ultraeval) | Evaluate a skill or codebase, grounded in real `file:line`, into a TDD fix backlog |
| [ultraindex](https://github.com/maxgfr/ultraindex) | Turn a large repo into a navigable, citation-checked encyclopedia |
| [ultradoc](https://github.com/maxgfr/ultradoc) | Answer precise questions about an open-source project from its real source |
| [ultrasearch](https://github.com/maxgfr/ultrasearch) | Cited, tiered reports of what the web actually says |
| [ultrai18n](https://github.com/maxgfr/ultrai18n) | Change a repo's language and prove nothing was missed |
| [ultra11y](https://github.com/maxgfr/ultra11y) · [review-a11y](https://github.com/maxgfr/ultra11y) | WCAG 2.2 AA audits, and a11y review of a diff |
| [construct](https://github.com/maxgfr/construct) · [reconstruct](https://github.com/maxgfr/reconstruct) | Idea → grounded SRD suite; repo → reconstruction PRDs |
| [secretgate](https://github.com/maxgfr/secretgate) | Local secrets firewall — redact credentials before they reach the LLM |

## Development

```bash
npm ci
npm run validate   # frontmatter, naming, dead references, plugin manifest, script syntax
npm test           # the engines and the workflow, against fixtures
npm run check      # everything, as CI runs it
```

The skills ship dependency-free; `npm ci` installs the release tooling only.
Releases are cut by semantic-release from conventional commits on `main` — `fix:`
for a patch, `feat:` for a minor — which versions `package.json` and
`.claude-plugin/plugin.json` together, writes the changelog and tags.

`npm run validate` is opinionated on purpose: a skill whose description does not say *when to use it* never triggers, and a skill pointing at a file that does not exist wastes a real agent's turn discovering that. Both fail the build.

Adding a skill: [CONTRIBUTING.md](./CONTRIBUTING.md) · writing one well: [AGENTS.md](./AGENTS.md).

## License

MIT

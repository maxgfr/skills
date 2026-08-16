# skills

My agent skills. One install, one place to keep them.

They are process skills: they change how an agent works rather than what it knows. Small, composable, and meant to be hacked on — install them, read them, make them yours.

The set grows. Today it is one skill, chosen because it closes the loop that costs the most: an agent tells you it is done, is wrong often enough that you check anyway, and finds something every time you ask for another pass.

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
npx skills add maxgfr/skills --skill verify  # take one
```

## Skills

| Skill | What it does |
|---|---|
| [`verify`](./skills/verify) | Proves that work just produced actually works, then fixes the blockers. |

---

### verify

```
/verify              # verify → fix the blockers → re-verify (default)
/verify report       # read-only verdict, no writes
/verify main         # explicit fixed point
/verify --behavior full   # add the red-green audit of produced tests
```

It runs four lanes in parallel, in sub-agents, so the noise never reaches your session:

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

Every stage's model is configurable. The default split follows what each stage is: **Fable is the scaffolding** — it decides what gets verified and writes down what happened — and **Opus does the verifying**. A cheap model in the lanes saves nothing, because a wrong finding costs a fix round, a re-verification and your attention.

```json
{
  "models": { "planner": "fable", "reporter": "fable", "finders": "opus", "judges": "opus" },
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
```

Both are deterministic, dependency-free, and covered by tests. They work outside the skill too — `forbidden-repairs.mjs` on a PR diff is a reasonable CI step on its own.

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

# skills

[![skills.sh](https://skills.sh/b/maxgfr/skills)](https://skills.sh/maxgfr/skills)

Process skills for agent-driven engineering.

An agent will tell you it is done. It will be wrong often enough that you check anyway — and every time you ask for another pass, it finds something. That loop is the expensive part of working with an agent, and these skills are about closing it.

## Install

**Any agent** — copies editable files into your repo:

```bash
npx skills add maxgfr/skills
```

**Claude Code** — as a managed plugin that updates when I ship:

```
/plugin marketplace add maxgfr/skills
/plugin install maxgfr-skills
```

Pick one. Installing both leaves you with every skill twice.

## Skills

| Skill | What it does |
|---|---|
| [`verify`](./skills/verify) | Proves that work just produced actually works, then fixes the blockers. |

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

## Tooling in these skills

The two engines ship with the skill and need nothing but Node:

```bash
node skills/verify/scripts/detect-gates.mjs --cwd . --pretty   # what "green" means here
git diff | node skills/verify/scripts/forbidden-repairs.mjs    # did that fix cheat?
```

Both are deterministic, dependency-free, and covered by tests. They work outside the skill too — `forbidden-repairs.mjs` on a PR diff is a reasonable CI step on its own.

## My other skills

These live in their own repos, each with its own engine and release cycle:

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
npm install
npm run validate   # frontmatter, naming, dead references, plugin manifest, script syntax
npm test           # the engines, against fixtures
npm run check      # everything, as CI runs it
```

`npm run validate` is opinionated on purpose: a skill whose description does not say *when to use it* never triggers, and a skill pointing at a file that does not exist wastes a real agent's turn discovering that. Both fail the build.

## License

MIT

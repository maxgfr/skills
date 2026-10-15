---
name: verify
description: Run the repository's own checks once and return PASS, FAIL or UNPROVEN; audit the diff when given a plan. Use when work is finished and should be checked, or the user asks whether it passes.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# verify

Run the repo's own checks once and print a short verdict; with a plan path or `audit [<ref>]`, one auditor also reads the change. Never repair: when the build skill invoked you, the build skill repairs.

1. **Checks.** Find what the repo calls green: its test, lint, typecheck and build scripts (`package.json`, `pyproject.toml`, `Makefile`…) and the commands its CI runs on push or pull request. If one script already runs the others (`npm run check`), run only that one. Skip installs, deploys and anything that writes or only works on a CI runner. Run each once from the repo root, under bash. If `git status` shows a tracked file changed by a check, say which. No check found: `UNPROVEN`. No argument: stop here.
2. **Diff.** With `<ref>`: `git diff <ref>`. Else, if `git status` shows any change, untracked files included: `git diff HEAD`. Else: `git diff $(git merge-base HEAD origin/HEAD)`. Always add the untracked files. Unknown ref: say so and stop. Nothing changed at all: no audit.
3. **Audit.** With a `scan` role set and a workflow tool, run the audit as one workflow: one reader per changed file on the `scan` role, with the audit brief scoped to that file, plus, with a plan, one reader on the `review` role with the audit brief scoped to the whole diff, so every step's Change is checked against the plan; then each finding to an independent refuter on the `review` role, with the refute brief; report only the findings it fails to refute, at most 5, worst first. No workflow tool or no `scan` role: one subagent with `references/audit.md`, on the `review` role. No subagent tool: audit yourself.

A role comes from `.agents/models.json` in the repo, else `~/.agents/models.json` (the repo wins role by role), under your agent's key (`claude`, `codex`…). It is `{ "model", "effort" }` or a model name; pass what it sets to the subagent tool when it takes them, and leave the rest to the session.

`FAIL`: a check failed or the audit found something. Else `UNPROVEN`: no check ran, or no auditor or reader answered. Otherwise `PASS`. Print only:

```
FAIL
gate npm run lint 1 src/a.ts:3 'x' is unused
gate npm test 0
finding src/a.ts:12 — <issue> · <failure scenario>
```

One `gate` line per check you ran, with its exit code and, on failure, the line that says why; one `finding` line per finding; one `note` line for anything else the user must know (a file a check changed, a check skipped). Without an audit, end with `not audited`.

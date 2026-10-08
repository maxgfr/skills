---
name: verify
description: Run the repository's own checks once and return PASS, FAIL or UNPROVEN; audit the diff when given a plan. Use when work is finished and should be checked, or the user asks whether it passes.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# verify

Run the repo's own checks once and print a short verdict; with a plan path or `audit [<ref>]`, one auditor also reads the change. Never repair.

1. **Checks.** Find what the repo calls green: its test, lint, typecheck and build scripts (`package.json`, `pyproject.toml`, `Makefile`…) and the commands its CI runs on push or pull request. If one script already runs the others (`npm run check`), run only that one. Skip installs, deploys and anything that writes or only works on a CI runner. Run each once from the repo root, under bash. If `git status` shows a tracked file changed by a check, say which. No check found: `UNPROVEN`. No argument: stop here.
2. **Diff.** With `<ref>`: `git diff <ref>`. Else, if `git status` shows any change, untracked files included: `git diff HEAD`. Else: `git diff $(git merge-base HEAD origin/HEAD)`. Always add the untracked files. Unknown ref: say so and stop. Nothing changed at all: no audit.
3. **Audit.** One subagent with `references/audit.md`. Its tier is `audit` (default `large`) under your host's name in `~/.agents/models.json` or `<repo>/.agents/models.json` (the repo wins); that tier's `{ "model", "effort" }` sits in the same entry. Nothing set: your own model. No subagent tool: audit yourself.

`FAIL`: a check failed or the audit found something. `UNPROVEN`: no check ran, or the auditor never answered. Otherwise `PASS`. Print only:

```
FAIL
gate npm run lint 1 src/a.ts:3 'x' is unused
gate npm test 0
finding src/a.ts:12 — <issue> · <failure scenario>
```

One `gate` line per check you ran, with its exit code and, on failure, the line that says why; one `finding` line per finding; one `note` line for anything else the user must know (a file a check changed, a check skipped). Without an audit, end with `not audited`.

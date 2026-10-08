---
name: verify
description: Run the repository's own gates once and return PASS, FAIL or UNPROVEN; audit the diff when given a plan. Use when work is finished and should be checked, or the user asks whether it passes.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# verify

Run the repo's gates once and print a short verdict; with a plan path or `audit [<ref>]`, one auditor also reads the change. Never repair. Paths are relative to this skill.

1. `node scripts/detect-gates.mjs --cwd <repo> --run` runs each gate once and prints `ok` and per gate `cmd`, `exit`, `out`. Do not rerun. No argument: stop here.
2. Diff: `git diff <ref>` if given, `git diff HEAD` if dirty, else against `git merge-base HEAD origin/HEAD` (or `main`), plus untracked files. Unknown ref: say so and stop. Empty diff: no audit.
3. `node scripts/models.mjs --cwd <repo> --host <host>` (the CLI you run in) names the `audit` tier. Send one subagent `references/audit.md` on that tier's `model` and `effort`, or audit yourself and mark the output `inline`.

`FAIL`: a blocking gate failed or the audit found something. `UNPROVEN`: no gate ran (`ok: null`) or the auditor never answered. Else `PASS`. Print only:

```
FAIL
gate npm run lint 1 src/a.ts:3 'x' is unused
gate npm test 0
finding src/a.ts:12 — <issue> · <failure scenario>
```

Without an audit, end with `not audited`.

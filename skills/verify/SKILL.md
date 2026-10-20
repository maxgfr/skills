---
name: verify
description: Run the repository's own checks once and return PASS, FAIL or UNPROVEN; audit the diff when given a plan. Use when work is finished and should be checked, or the user asks whether it passes.
license: MIT
---

# verify

Run the repo's own checks once and print a short verdict; with a plan path or `audit [<ref>]`, also review the change once. Never repair: when the build skill invoked you, the build skill repairs.

1. **Checks.** Find what the repo calls green: its test, lint, typecheck and build scripts (`package.json`, `pyproject.toml`, `Makefile`…) and the commands its CI runs on push or pull request. If one script already runs the others (`npm run check`), run only that one. Skip installs, deploys and anything that writes or only works on a CI runner. Run each once from the repo root, under bash, its output sent to a file: read only the exit code and, on failure, the line that says why. If `git status` shows a tracked file changed by a check, say which. No check found: `UNPROVEN`. No argument: stop here.
2. **Diff.** Pick the diff command, never reading the diff yourself unless you audit. With `<ref>`: `git diff <ref>`. Else, if `git status` shows any change, untracked files included: `git diff HEAD`. Else: `git diff $(git merge-base HEAD origin/HEAD)`. Always add the untracked files. Unknown ref: say so and stop. Nothing changed at all: no audit.
3. **Audit.** One pass with `references/audit.md`, by one subagent on the `review` role; no subagent tool: audit yourself. Never a second pass.

A role comes from `.agents/models.json` in the repo, else `~/.agents/models.json` (the repo wins role by role), under your agent's key (`claude`, `codex`…). It is `{ "model", "effort" }` or a model name; pass what it sets to the subagent tool when it takes them. A role left unset runs on the lightest model the subagent tool offers, else on the session's.

`FAIL`: a check failed or the audit found something. Else `UNPROVEN`: no check ran, or the auditor never answered. Otherwise `PASS`. Print only:

```
FAIL
gate npm run lint 1 src/a.ts:3 'x' is unused
gate npm test 0
finding src/a.ts:12 — <issue> · <failure scenario>
```

One `gate` line per check you ran, with its exit code and, on failure, the line that says why; one `finding` line per finding; one `note` line for anything else the user must know (a file a check changed, a check skipped). Without an audit, end with `not audited`.

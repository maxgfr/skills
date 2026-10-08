---
name: verify
description: Use when the user explicitly invokes verify to check completed work with repository gates and evidence.
disable-model-invocation: true
license: MIT
metadata:
  opencode/autoinvoke: 'false'
---

# verify

Run the repository's gates, then have one `large`-tier auditor read the change.
The output is a verdict and its evidence. Paths are relative to this skill's directory.

## Laws

1. **No verdict without an executed command.** A gate that could not run is a failure to prove, never a pass.
2. **No finding without `file:line` and a concrete failure scenario.** No style, no speculation.
3. **verify repairs nothing.** It reports. Fixing is the user's call, or `build`'s.

## Invocations

`$verify` (Codex), `/maxgfr:verify` (Claude plugin), `/verify` (standalone). Arguments:
none, `<plan>` (an existing `.md` path: the promise to hold the change to), `<ref>` (a fixed point: `main`, a SHA, `HEAD~3`).

## Steps

1. **Diff.** With `<ref>`: `git diff <ref>`. With a dirty tree: `git diff HEAD`. With a clean tree: `git diff $(git merge-base HEAD origin/HEAD)`, or `main` when `origin/HEAD` is unset. Always add the untracked files from `git status --porcelain`. A ref that does not resolve: say so and stop.
2. **Gates.** `node scripts/detect-gates.mjs --cwd <repo> --run`. It runs every detected gate once and prints compact JSON (`ok`, and for each gate `cmd`, `exit`, and `out` on failure). Do not rerun the gates yourself.
3. **Audit.** `node scripts/models.mjs --cwd <repo> --host <host>`, where `host` is the CLI you run in. Pass it, never guess it. Dispatch one subagent with model `large` (`null` means inherit) and the brief in `references/audit.md`. With no subagent tool, do the audit yourself and mark the output `inline`. With an empty diff, skip the audit.

## Verdict

| Verdict | When |
|---|---|
| `FAIL` | A blocking gate failed (`ok: false`), or the audit returned a finding. |
| `UNPROVEN` | No gate ran (`ok: null`), or the auditor never returned. Not a pass. |
| `PASS` | Every blocking gate passed and the audit found nothing. |

## Output

Exactly this, no prose, no report file:

```
FAIL
gate npm run lint 1 src/a.ts:3 'x' is unused
gate npm test 0
finding src/a.ts:12 — <issue> · <failure scenario>
```

One `gate` line per gate, with the first line of `out` when it failed. One `finding` line per finding.
Add a line for anything not checked (no plan, audit skipped, model inherited because the tool takes none).

## Does not

- Repair, revert, commit, or rewrite a test or a gate.
- Run panels, skeptics, or a second auditor. One audit, on the `large` tier.
- Report a finding outside the diff, or one without a scenario.

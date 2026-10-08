---
name: verify
description: Use only when the user explicitly asks for verify to check completed work with repository gates and evidence.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# verify

By default, run the repository's gates once and print the verdict: cheap, a few
lines. On request, one `large`-tier auditor also reads the change. Paths are relative to this skill's directory.

## Laws

1. **No verdict without an executed command.** A gate that could not run is a failure to prove, never a pass.
2. **No finding without `file:line` and a concrete failure scenario.** No style, no speculation.
3. **verify repairs nothing.** It reports. Fixing is the user's call, or `build`'s.

## Invocations

`$verify` (Codex), `/maxgfr:verify` (Claude plugin), `/verify` (standalone).

| Arguments | Does |
|---|---|
| none | **Default.** Gates only. No diff read, no agent. |
| `<plan>` (an existing `.md`) | Gates, then the audit holds the change to that plan. |
| `audit [<ref>]` | Gates, then the audit, with no plan. `<ref>` (`main`, a SHA) fixes the diff base. |

## Steps

1. **Gates.** `node scripts/detect-gates.mjs --cwd <repo> --run`. It runs each detected gate once (gates an aggregate already runs are skipped) and prints compact JSON: `ok`, and per gate `cmd`, `exit`, and `out` on failure. Do not rerun them. With no arguments, stop here.
2. **Diff.** With `<ref>`: `git diff <ref>`. With a dirty tree: `git diff HEAD`. With a clean tree: `git diff $(git merge-base HEAD origin/HEAD)`, or `main` when `origin/HEAD` is unset. Always add the untracked files from `git status --porcelain`. A ref that does not resolve: say so and stop.
3. **Audit.** `node scripts/models.mjs --cwd <repo> --host <host>`, where `host` is the CLI you run in. Pass it, never guess it. Dispatch one subagent with model `large` (`null` means inherit) and the brief in `references/audit.md`. With no subagent tool, do the audit yourself and mark the output `inline`. With an empty diff, skip the audit.

## Verdict

| Verdict | When |
|---|---|
| `FAIL` | A blocking gate failed (`ok: false`), or the audit returned a finding. |
| `UNPROVEN` | No gate ran (`ok: null`), or the auditor never returned. Not a pass. |
| `PASS` | Every blocking gate passed, and the audit, if it ran, found nothing. |

## Output

Exactly this, no prose, no report file:

```
FAIL
gate npm run lint 1 src/a.ts:3 'x' is unused
gate npm test 0
finding src/a.ts:12 — <issue> · <failure scenario>
```

One `gate` line per gate, with the one line of `out` that says why when it failed. One `finding` line per finding.
Without an audit, end with `not audited`. Add one line for anything else not checked (empty diff, model inherited because the tool takes none).

## Does not

- Repair, revert, commit, or rewrite a test or a gate.
- Run panels, skeptics, or a second auditor. One audit, on the `large` tier.
- Report a finding outside the diff, or one without a scenario.

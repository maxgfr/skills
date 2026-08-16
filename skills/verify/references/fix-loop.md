# Phase 5 — The fix loop

Default mode. Verify, repair the blockers, verify again, stop. The loop is bounded, it proves what it changed, and it is not allowed to win by cheating.

## The cycle

```
  ┌─ anything left to fix? ─ no ─→ fresh full gate run ─→ PASS
  │        │ yes
  │        ▼
  │   baseline = git stash create        (dangling commit; touches no ref, no file)
  │   fix, grouped by file               (parallel across files, sequential within one)
  │   node scripts/forbidden-repairs.mjs --since <baseline>
  │        │
  │        ├─ FORBIDDEN → revert those hunks, escalate, STOP
  │        ▼
  │   re-run the gates + re-check EACH finding, one verdict per finding
  │        │
  │        └─ resolved = the fixer says fixed AND the recheck says gone
  └───────┘  iteration++ (max 3 by default)
```

The loop's entry condition is *what it is configured to repair*, not blockers alone — otherwise `fix_severity: "major"` never starts when nothing blocks.

One line to the user per iteration, no more:

```
iteration 2/3 — 2 blocking → 0 · 1 new major · typecheck exit 0, test exit 0
```

## Fixing

**One sub-agent per finding**, given: the finding, the file, and the surrounding code. Group by file first — two agents editing one file will clobber each other. Distinct files run in parallel; findings in the same file run sequentially in one agent.

**Brief:**

> Fix exactly this defect and nothing else:
>
> - `<file>:<line>` — `<defect>`
> - It fails when: `<failure_scenario>`
> - Suggested direction: `<suggested_fix>`
>
> Make the smallest change that makes the failure scenario impossible. Match the surrounding code's style.
>
> **You may not:** skip, delete, weaken or `.only` a test; change an expected value to match what the code produces; add `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# type: ignore`, `# noqa`; widen a type to `any` or `unknown as`; swallow an error in an empty `catch`; edit a gate command, a CI workflow, a Makefile target, or the plan.
>
> If the only way to satisfy the gate is one of those, **stop and return `{fixed: false, blocked_by: "<what would be required>"}`**. That answer is correct and useful. A silenced checker is not a fix.
>
> Return `{fixed, files_touched, summary_one_line, blocked_by}`.

## The guard

After every fix round, before re-running anything:

```bash
node scripts/forbidden-repairs.mjs --since <baseline> --plan <plan-path> --pretty
```

Exit 1 means the round contains a forbidden repair. Then:

1. Revert exactly those hunks (`git checkout -p`, or restore the file and re-apply the clean parts).
2. Report the finding as **blocking, unfixable-without-design-change**, quoting the rule and the line.
3. **Stop the loop.** Do not try a different angle on the same finding — a fix that needed a suppression once will need one again.

This check is deterministic and runs regardless of what the fixer claims it did. A fixer that reports `fixed: true` while having added an `eslint-disable` is caught here, which is the entire reason the check is a script and not a prompt.

`--since` also scans files the round *created* — a new test full of `it.skip()` produces nothing in `git diff`. A patch fed on stdin or via `--patch` cannot see them: the report says so in `untracked_scanned` and `notes` rather than passing the round quietly. Pass `--include-untracked` if you are piping a patch and want them scanned anyway.

Each rule is scoped to where the cheat can actually live, because the guard reverts hunks and stops the loop — refusing an honest repair costs more than missing a dishonest one. A bare `.skip(` counts only inside a test file (elsewhere it is `repo.query().skip(20)`, standard pagination); `@ts-ignore` in a Markdown file is documentation, not a suppression; and a deleted test line is read with its strings blanked, so renaming `it('should return 401')` is not deleting an assertion. If the guard fires, the rule it names is the finding — do not argue with it, revert and escalate.

## What counts as resolved

**Two independent confirmations, or it is not resolved.**

1. The fixer returned `fixed: true` for that file. A `fixed: false`, a `blocked_by`, a crashed agent, a null return — none of these resolve anything.
2. The recheck says the defect is gone: for a gate-derived finding, its gate now passes; for anything else, an explicit per-finding verdict. "I could not verify" is `gone: false`.

Marking a finding resolved because a round ran over it is how a loop returns PASS on a defect that is still in the code. The recheck must be able to answer *per finding* — a gate-only schema structurally discards that answer, so the schema carries a `findings` array alongside the gate results.

Anything unresolved stays open and goes into the next iteration. A finding still unresolved after two attempts stops the loop: a repair that did not work twice will not work on the third try, and burning the budget hides that.

## Exit conditions

| Condition | Result |
|---|---|
| No blocking findings remain | Fresh **full** gate run — every gate, from scratch, not just the impacted ones — then `PASS` |
| `max_iterations` reached | `FAIL`, with what is left and what changed across the iterations |
| Forbidden repair required | `FAIL`, naming the rule and why the design forces it |
| Same finding reappears after being "fixed" | `FAIL` — the fix is not addressing the cause. Report both attempts. |
| A fix creates a new blocking finding twice in a row | `FAIL` — thrashing. Report the oscillation. |

The final gate run is not optional and not incremental. Partial evidence is how a loop convinces itself it is green.

## What it will not do

- **Commit or push.** The loop ends with a dirty working tree and a report. Committing is yours to decide, and there is no setting that changes this — a verification tool that can also commit is one that can bury what it did.
- **Touch anything outside the delta.** A pre-existing failure that the change did not cause is reported as pre-existing, not repaired. Fixing it silently would hide the fact that the branch inherited a broken gate.
- **Fix `major` or `minor` findings**, unless `fix_severity` says otherwise. They are reported for you to triage.
- **Retry a refuted finding.** It was killed in Phase 3; it does not come back as a repair.

## Report mode

`/verify report` runs Phases 0–4 and stops. No baseline, no writes, nothing to revert. If you then say "fix", the loop runs **once** over the blockers — a single round with the same guard — and re-runs the impacted gates. It does not become the looping mode retroactively; ask for `/verify` if you want that.

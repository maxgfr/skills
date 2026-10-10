---
name: build
description: Implement an approved plan, then check it with verify and repair what fails. Use when a plan was just approved, including on leaving plan mode, or when the user wants an approved plan implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan, never committing. Argument: a plan `<path>`, or none: the plan approved in this conversation, else the newest in `${TMPDIR:-/tmp}/plans/<repo>/`, then in `docs/plans/`. Stop in one line if a step has no Verify.

1. Work where the session is. Only if `git status` shows changes other than the plan file, work in a worktree from HEAD named `build/<slug>`, `<slug>` being the plan's file name without its date (the host's worktree tool, else `git worktree add`), with the dependencies installed so the checks can run.
2. Take the steps in order: make the Change, then run Verify once. On failure, fix and rerun; after three failed runs the step is `blocked` and every later one `skipped`.
3. Do the steps yourself. Use subagents only for several heavy steps that share no file and need none of each other: launch them in a single message, each with the plan path, its step id, the rule of step 4 and "touch only its Files, run Verify once, return `{exit, note}`". A failed result is a failed run of step 2; a subagent that never answers leaves its step `unproven`.
4. Never: skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Once every step has run, read the whole diff (`git diff` plus new files) and revert any hunk that does, and any change to a file no step lists.

Print one line per step, before anything else:

```
S-001 done 0
S-002 unproven - no answer
S-003 blocked 1 src/a.ts:3 — missing branch
S-004 skipped - needs S-003
```

The columns are the step, its status, Verify's exit code and a note. Then `worktree <path> <branch>`, only if you created one. Not all `done`: stop there.

All `done`: invoke the verify skill with the plan's absolute path, in the tree you built in. On `FAIL`, repair what its `gate` and `finding` lines name, each finding with a test that shows it, then rerun the failing `gate` commands, or every gate if none failed: two repair rounds at most, never a second audit. End by printing the last verdict in verify's format: `PASS` once every rerun exits 0, else `FAIL` with what still fails.

---
name: build
description: Implement an approved plan, then check it with verify and repair what fails. Use when a plan was just approved, including on leaving plan mode, or when the user wants an approved plan implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan, never committing. Argument: a plan `<path>`, or none: the plan approved in this conversation, else the newest in `${TMPDIR:-/tmp}/plans/<repo>/`, then in `docs/plans/`. A step without Verify uses the repo's test command.

1. Work where the session is. Only if `git status` shows changes other than the plan file, work in a worktree from HEAD named `build/<slug>`, `<slug>` being the plan's file name without its date, with the dependencies installed.
2. Each step is its Change, within its Files, then its Verify; on failure, fix and rerun. After two failed runs the step is `blocked`, and every step that needs it `skipped`.
3. With a `subagent` role set, hand all the steps to that role's model and effort at once: one workflow when the host has a workflow tool, no workflow tool: one subagent. Brief it with the tree, the plan path and rule 4, and have it return JSON `{step, exit, note}` per step; steps it never answers for are `unproven`. No role or no subagent tool: write it yourself.
4. Never: skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Once at the end, read the whole diff (`git diff` plus new files) and revert any hunk that does, and any change outside the steps' Files that no `FAIL` line calls for.

A role comes from `.agents/models.json` in the repo, else `~/.agents/models.json` (the repo wins role by role), under your agent's key (`claude`, `codex`…). It is `{ "model", "effort" }` or a model name; pass what it sets to the subagent tool when it takes them, and leave the rest to the session.

Print one line per step, before anything else:

```
S-001 done 0
S-002 unproven - no answer
S-003 blocked 1 src/a.ts:3 — missing branch
S-004 skipped - needs S-003
```

The columns are the step, its status, Verify's exit code and a note. Then `worktree <path> <branch>`, only if you created one. Not all `done`: stop there.

All `done`: invoke the verify skill with the plan's absolute path, in the tree you built in. On `FAIL`, repair once what its `gate` and `finding` lines name, the same way as the steps, each finding with a test that shows it, then rerun the failing `gate` commands, or every gate if none failed: one repair round, never a second audit. End by printing the last verdict in verify's format: `PASS` once every rerun exits 0, else `FAIL` with what still fails.

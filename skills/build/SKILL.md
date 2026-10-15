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
3. With a subagent tool, you never write or read the code: hand all the steps at once to the `subagent` role, as one workflow when the host has a workflow tool, no workflow tool: one subagent. Brief it in a few lines: the tree, the plan path, rules 2 and 4; have it return JSON `{step, exit, note}` per step. Steps it never answers for are `unproven`. No subagent tool: write it yourself.
4. Never: skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Touch nothing outside the steps' Files that no `FAIL` line calls for.

A role comes from `.agents/models.json` in the repo, else `~/.agents/models.json` (the repo wins role by role), under your agent's key (`claude`, `codex`…). It is `{ "model", "effort" }` or a model name; pass what it sets to the subagent tool. A role left unset runs on the lightest model the subagent tool offers.

Print one line per step, before anything else:

```
S-001 done 0
S-002 unproven - no answer
S-003 blocked 1 src/a.ts:3 — missing branch
S-004 skipped - needs S-003
```

The columns are the step, its status, Verify's exit code and a note. Then `worktree <path> <branch>`, only if you created one. Not all `done`: stop there.

All `done`: invoke the verify skill with the plan's absolute path, in the tree you built in. On `FAIL`, repair once what its `gate` and `finding` lines name, the same way as the steps, each finding with a test that shows it, then rerun the failing `gate` commands, or every gate if none failed: one repair round, never a second audit. End by printing the last verdict in verify's format: `PASS` once every rerun exits 0, else `FAIL` with what still fails.

---
name: build
description: Implement an approved plan in a worktree, alone for a short plan, else with small-tier coders and a medium-tier reviewer. Use when a plan was just approved, including on leaving plan mode, or when an approved docs/plans/ plan exists and the user wants it implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan in a git worktree, never committing. Argument: none (the newest `status: approved` plan in `docs/plans/`) or `<path>`.

1. Read the plan. A plan approved in plan mode but not in `docs/plans/` yet: save it there first, `status: approved`, one `### S-xxx — title` per step with `Files`, `Depends on`, `Change`, `Preserve` and `Verify`. Stop in one line if the plan is not approved or a step has no Verify command.
2. From the repo root, with `<slug>` the plan's file name without its date: `git worktree add -b build/<slug> ../<repo>-build-<slug> HEAD`. Work only there. If the tree is dirty, say its changes are not in the build.
3. Order the steps by `Depends on`. A step after a failed one is `skipped`.
4. Up to 3 steps (or `solo` in `models.json`, see `references/dispatch.md`): implement them yourself, one after another, running each Verify. More: delegate as `references/dispatch.md` says.
5. Read the whole diff (`git diff` plus new files). Never: skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Revert any such hunk and stop.

Print one line per step:

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

The columns are the step, its status, Verify's exit code and who built it (`solo` when you did). Then one line: `worktree <path> <branch>`. All `done`: invoke the verify skill now, with the plan's absolute path and the worktree as the repo. Otherwise name the step that stopped.

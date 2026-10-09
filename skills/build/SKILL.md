---
name: build
description: Implement an approved plan in a worktree with one subagent per step on the tier the step needs and a reviewer for each, then run verify and repair until it passes. Use when a plan was just approved, including on leaving plan mode, or when an approved docs/plans/ plan exists and the user wants it implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan in a git worktree with subagents, never committing. Argument: none (the newest `status: approved` plan in `docs/plans/`) or `<path>`.

1. Read the plan. A plan approved in plan mode but not in `docs/plans/` yet: save it there first, `status: approved`, one `### S-xxx — title` per step with `Files`, `Depends on`, `Change`, `Preserve` and `Verify`. When reading the plan, a `Depends on` range such as `S-001…S-009` counts as each id in it; never rewrite the plan for it. Stop in one line if the plan is not approved, a step has no Verify command, `Depends on` names a step that does not exist, or `Depends on` loops.
2. From the repo root, with `<slug>` the plan's file name without its date: `git worktree add -b build/<slug> ../<repo>-build-<slug> HEAD`. Work only there. If the tree is dirty beyond the plan file, say those changes are not in the build.
3. Order the steps by `Depends on` and give each its tier (`references/tiers.md`).
4. Delegate every step; never code one yourself. One implementer per step and one reviewer per implementation, each step starting as soon as the steps it waits for are `done`, so independent steps run at the same time: fifteen steps is fifteen implementers, launch them all. With a workflow tool that runs a script of subagents (`agent()`, `parallel()`), run `references/workflow.md`; with none, or if it refuses the run or is not allowed, use your subagent tool as `references/dispatch.md` says. Only with no subagent tool at all, build alone as below; the tier column then reads `solo`.
5. A step after a failed one is `skipped`. Read the whole diff (`git diff` plus new files). Never: skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Revert any such hunk, and every `forbidden` one, and stop.

Building alone: take the steps one at a time in `Depends on` order. Implement each as `implementerPrompt` of `references/workflow.md` says, run its Verify, then check your diff against the `reviewerPrompt` checklist. It is `done` when Verify exits 0 and the checklist holds. Otherwise try again with the failed items as the issues, three tries at most, then `blocked`. No tiers and no `escalate`. `skipped` and the stop on a forbidden change work as in `references/dispatch.md`.

Print one line per step:

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

The columns are the step, its status, Verify's exit code and the tier that built it. Then one line: `worktree <path> <branch>`. Print these lines before anything else. Not all `done`: name the step that stopped, and stop.

All `done`: invoke the verify skill with the plan's absolute path and the worktree as the repo. On each `FAIL`, run a repair round with the fixers of `fixerPrompt` in `references/workflow.md`: through its `repair` args with a workflow tool, launched as `references/dispatch.md` says with a subagent tool, or yourself when `solo`.

1. Group verify's failing `gate` lines and its `finding` lines by the file they name; the lines naming none form one group.
2. At the round's tier, run one fixer at a time: each group with a file, then the group with no file.
3. Print `repair <round> <fixed>/<groups>`. If the round fixed nothing, stop: the last verdict stands. Otherwise invoke verify again, the third round included.

Stop on `PASS`, on `UNPROVEN`, or when the verify after the third round still says `FAIL`. End with verify's last verdict: a run that ends on `FAIL` or `UNPROVEN` is not done, and its lines say what is left.

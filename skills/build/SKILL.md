---
name: build
description: Implement an approved docs/plans/ plan in a worktree with small-tier coders, a medium-tier reviewer and a guard against silenced checks. Use when an approved plan exists and the user wants it implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan in a worktree, where `small` writes each step and `medium` reviews each wave. You orchestrate; never write code or commit. Paths are relative to this skill. Argument: none (the newest approved plan in `docs/plans/`) or `<path>`.

1. `node scripts/plan-steps.mjs --cwd <repo> [--plan <path>] --host <host>`, `<host>` being the CLI you run in. On `ok: false`, print `error` and stop.
2. `git worktree add -b build/<slug> ../<repo>-build-<slug> HEAD`. If the tree is dirty, say its changes are not in the build.
3. Baseline: `git stash create` in the worktree (empty means `HEAD`).
4. With a Workflow tool: `Workflow({ scriptPath: "workflows/build.mjs", args: { cwd, planPath, steps, waves, tiers, skillDir, baseline } })`. Otherwise follow `references/dispatch.md`.

Print one line per step:

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

All `done`: invoke the verify skill now, with the plan's absolute path and the worktree as the repo. Otherwise name the step that stopped. End with the worktree path and branch.

---
name: build
description: Implement an approved plan in a worktree, alone for a short plan, else with small-tier coders and a medium-tier reviewer, behind a guard against silenced checks. Use when a plan was just approved, including on leaving plan mode, or when an approved docs/plans/ plan exists and the user wants it implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan in a worktree, never committing. Paths are relative to this skill. Argument: none (the newest approved plan in `docs/plans/`) or `<path>`.

1. A plan approved in plan mode but not yet in `docs/plans/`: save it there first (`status: approved`, `### S-xxx — title` steps with `Files`, `Depends on`, `Change`, `Preserve`, `Verify` bullets). Then `node scripts/plan-steps.mjs --cwd <repo> [--plan <path>] --host <host>`, `<host>` being the CLI you run in. On `ok: false`, print `error` and stop.
2. `git worktree add -b build/<slug> ../<repo>-build-<slug> HEAD`. If the tree is dirty, say its changes are not in the build.
3. Baseline: `git stash create` in the worktree (empty means `HEAD`).
4. If `mode` is `solo` or you have no subagent tool, implement the steps yourself in wave order, running each Verify, then `node scripts/forbidden-repairs.mjs --brief --since <baseline> --plan <planPath>` in the worktree: anything but `CLEAN` means revert those hunks and stop. Your tier column is `solo`. Else use `Workflow({ scriptPath: "workflows/build.mjs", args: { cwd, planPath, steps, waves, tiers, skillDir, baseline } })` if you have it, or `references/dispatch.md`.

Print one line per step:

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

All `done`: invoke the verify skill now, with the plan's absolute path and the worktree as the repo. Otherwise name the step that stopped. End with the worktree path and branch.

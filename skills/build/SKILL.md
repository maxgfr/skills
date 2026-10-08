---
name: build
description: Implement an approved docs/plans/ plan step by step in a worktree — small-tier coders, a medium-tier reviewer, a guard against silenced checks. Use when an approved plan exists and the user wants it implemented.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# build

Implement an approved plan one step at a time. By default the `small` tier
writes each step and the `medium` tier reviews it and reruns its proof. You only orchestrate.
Paths are relative to this skill's directory.

## Laws

1. **No approved plan, no build.** `scripts/plan-steps.mjs` decides, and refuses in one line.
2. **Done = the reviewer ran Verify, it exited 0, and the reviewer accepted.** An implementer's report is a claim.
3. **No repair that silences a checker.** `scripts/forbidden-repairs.mjs` scans the whole diff after every step. A forbidden hunk is reverted and the build stops.

## Invocations

`$build` (Codex), `/maxgfr:build` (Claude plugin), `/build` (standalone). Arguments: none (the newest approved plan in `docs/plans/`), `<path>`, `then verify`.

## Phase 0: one pass, no questions

1. `node scripts/plan-steps.mjs --cwd <repo> [--plan <path>] --host <host>`. `host` is the CLI you run in (`claude`, `codex`, `opencode`…). Pass it, never guess it. On `ok: false`, print `error` and stop. Otherwise keep `planPath`, `steps`, `waves`, `tiers`.
2. Worktree from the **local** `HEAD`: `git worktree add -b build/<slug> ../<repo>-build-<slug> HEAD`. Not a tool that branches from the remote: it would miss unpushed commits. If the tree is dirty, say in one line that uncommitted changes are not in the build. The plan need not be there: the steps travel in `steps`.
3. Baseline: `git stash create` in the worktree. Empty output means `HEAD`.
4. Launch in the same turn:
   - **Workflow tool:** `Workflow({ scriptPath: "workflows/build.mjs", args: { cwd, planPath, steps, waves, tiers, skillDir, baseline, host, namespace } })`. Pass `namespace: "maxgfr"` under the Claude plugin only.
   - **Subagent tool, no Workflow:** `references/dispatch.md`.
   - **Neither:** do each step yourself in wave order, with the same checks. Mark the output `inline`.

## Per step

- Escalation follows `tiers.attempts` (default: small, small with the reviewer's issues, then medium). After the last one the step is `blocked`. An implementer that returns `blocked_by` jumps to the last attempt; there it is `blocked`. The reviewer runs on `tiers.review`.
- Steps in a wave run in parallel. A step whose dependency is not `done` is `skipped`.
- An agent that never returned leaves the step `unproven`, with no retry. That is not a pass.
- Each agent gets `tiers[tier].model` and `.effort`. `null`, or a subagent tool without that option, means the session's own. If the tool lacks one, say so once.

## Output

One line per step, then one handoff line. No prose, no file.

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

- `built` → the verify call with the plan's absolute path, run with the worktree as `<repo>`: the change is there, not on the user's branch. With `then verify`, run it now.
- `blocked` / `unproven` → name the step and stop.

## Does not

- Plan, extend or reinterpret a plan. An under-specified step is `blocked`.
- Verify the whole change. That is `verify`.
- Ask for confirmation, commit, renumber `S-xxx`, or build outside a worktree.

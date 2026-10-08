---
name: build
description: Use when the user explicitly invokes build to implement an approved plan and verify the changes.
disable-model-invocation: true
license: MIT
metadata:
  opencode/autoinvoke: 'false'
---

# build

Implement an approved plan one step at a time. The `small` tier writes each
step, the `medium` tier reviews it and reruns its proof. You only orchestrate.
Paths are relative to this skill's directory.

## Laws

1. **No approved plan, no build.** `scripts/plan-steps.mjs` decides, and refuses in one line.
2. **Done = the reviewer ran Verify, it exited 0, and the reviewer accepted.** An implementer's report is a claim.
3. **No repair that silences a checker.** `scripts/forbidden-repairs.mjs` scans the whole diff after every step. A forbidden hunk is reverted and the build stops.

## Invocations

`$build` (Codex), `/maxgfr:build` (Claude plugin), `/build` (standalone). Arguments: none (the newest approved plan in `docs/plans/`), `<path>`, `then verify`.

## Phase 0: one pass, no questions

1. `node scripts/plan-steps.mjs --cwd <repo> [--plan <path>] --host <host>`. `host` is the CLI you run in (`claude`, `codex`, `opencode`…). Pass it, never guess it. On `ok: false`, print `error` and stop. Otherwise keep `planPath`, `steps`, `waves`, `attempts`, `models`.
2. Worktree: the host's worktree tool (`EnterWorktree`), else `git worktree add .worktrees/build-<slug> -b build/<slug>`. Never build on the user's branch.
3. Baseline: `git stash create` in the worktree. Empty output means `HEAD`.
4. Launch in the same turn:
   - **Workflow tool:** `Workflow({ scriptPath: "workflows/build.mjs", args: { cwd, planPath, steps, waves, attempts, models, skillDir, baseline, host, namespace } })`. Pass `namespace: "maxgfr"` under the Claude plugin only.
   - **Subagent tool, no Workflow:** `references/dispatch.md`.
   - **Neither:** do each step yourself in wave order, with the same checks. Mark the output `inline`.

## Per step

- Escalation follows `attempts`: small, small with the reviewer's issues, then medium. After that the step is `blocked`. An implementer that returns `blocked_by` jumps to medium; at medium it is `blocked`.
- Steps in a wave run in parallel. A step whose dependency is not `done` is `skipped`.
- An agent that never returned leaves the step `unproven`, with no retry. That is not a pass.
- `models[tier]` is `null`, or the subagent tool takes no model: the agent inherits the session model. If the tool takes no model, say so once.

## Output

One line per step, then one handoff line. No prose, no file.

```
S-001 done 0 small
S-002 blocked 1 medium src/a.ts:3 — missing branch
S-003 skipped - - needs S-002
```

- `built` → the verify call with `planPath`. With `then verify`, run it now.
- `blocked` / `unproven` → name the step and stop.

## Does not

- Plan, extend or reinterpret a plan. An under-specified step is `blocked`.
- Verify the whole change. That is `verify`.
- Ask for confirmation, commit, renumber `S-xxx`, or build outside a worktree.

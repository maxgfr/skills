# Phase 0 — the exact recipe

Everything the workflow needs, resolved here, in the main context, before any
agent is spent. Deterministic from top to bottom. The one thing this phase
never does is ask: the plan was approved, and every value below is read or
computed, not decided.

## 1. The plan

```bash
node <skill dir>/scripts/plan-steps.mjs --cwd <repo> [--plan <path>] --pretty
```

- `ok: true` → keep `planPath`, `steps`, `waves`. Pass `steps` and `waves`
  **verbatim** — the workflow does not re-read the plan.
- `ok: false` → print `error` on one line and stop. Nothing else happens.
  The four refusals: no plan, not approved, a step without `Verify:`, a
  dependency cycle or an unknown dependency.

`peer` and `then verify` are modifiers, not paths. `/build peer` is the default
plan with `mode: "peer"`; `/build docs/plans/x.md peer` is that plan with it.

## 2. The worktree

Never build where the user is working. In order:

1. The host's native worktree tool (`EnterWorktree` in Claude Code). It
   switches the session's working directory; everything after uses that.
2. `git worktree add <repo>/.worktrees/build-<slug> -b build/<slug>` where
   `<slug>` is the plan file's basename without the date and extension. Then
   `cd` there for every command, and pass that path as `cwd`.

A repository with no commits has nothing to branch from: say so and stop.
Building in the checked-out tree is not a fallback.

## 3. The run directory and the baseline

```bash
date +%Y%m%d-%H%M%S            # → .agents/build/<timestamp>/ under the worktree
git stash create               # → the baseline SHA; empty output means HEAD
```

The baseline is what the guard diffs against, so it must be taken **after** the
worktree exists and **before** the first implementer runs. It touches no ref
and no file.

## 4. The host (peer mode only)

`host` is the CLI you are executing inside — `claude` or `codex`. The peer is
the other one. This is passed, never sniffed: `command -v codex` says what is
installed, not who is running. If you cannot tell, leave it unset; the workflow
reports `peer_unavailable` with that reason, which is the honest outcome.

## 5. The launch — same turn

```
Workflow({
  scriptPath: "<skill dir>/workflows/build.mjs",
  args: {
    cwd,          // the worktree
    planPath,     // from plan-steps.mjs, repo-relative
    steps,        // from plan-steps.mjs, verbatim
    waves,        // from plan-steps.mjs, verbatim
    skillDir,     // so the workflow can invoke this skill's scripts
    runDir,       // <worktree>/.agents/build/<timestamp>
    baseline,     // the stash SHA, or HEAD
    mode,         // "workflow" | "peer"
    host,         // "claude" | "codex" — peer mode only
    config        // optional: models, effort, steps.max_attempts, peer.timeout_ms
  }
})
```

Invoking `/build` is the explicit opt-in the Workflow tool requires. If the
workflow fails mid-run it returns a `runId`; resume with
`Workflow({ scriptPath, resumeFromRunId })` and only the failed step onward runs
live.

### `config`

```json
{
  "models": { "implementer": "inherit", "reviewer": "inherit", "guard": "inherit", "reporter": "inherit" },
  "effort": { "implementer": "high", "reviewer": "medium" },
  "steps": { "max_attempts": 2 },
  "peer": { "timeout_ms": 900000 }
}
```

Every stage inherits the session's model by default. Read
`<repo>/.agents/build.json`, then `~/.claude/build.json` or
`$CODEX_HOME/build.json`, if they exist; flags override both. Pinning the
reviewer *down* is the false economy: a reviewer that accepts a broken step
costs a `verify` run and a rebuild.

## What this phase must never do

- Ask which plan. `plan-steps.mjs` answers.
- Summarise the plan, restate the steps, or list what is about to happen.
- Wait for a confirmation. The approval is in the file.
- Build without a worktree.
- Guess `host`.

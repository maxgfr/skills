# Handoff

The build's return value is a step table. What goes into the conversation is
that table and one next action — nothing about how the steps went, no summary
of what the code now does.

## The block

```
BUILD: built — 3 steps done · 0 blocked · 0 skipped     mode: workflow
  S-001  Add the token bucket       done   npx vitest run tests/limit/bucket.test.ts   exit 0
  S-002  Wire the middleware        done   npx vitest run tests/api/limit.test.ts      exit 0
  S-003  Document the limit         done   grep -q "Rate limits" README.md            exit 0

Worktree: .worktrees/build-rate-limiter   Record: .agents/build/20260901-101500/BUILD.md
Next: /verify docs/plans/2026-09-01-rate-limiter.md
```

```
BUILD: blocked — 1 step done · 1 blocked · 1 skipped     mode: workflow
  S-001  Add the token bucket       done      npx vitest run tests/limit/bucket.test.ts   exit 0
  S-002  Wire the middleware        blocked   npx vitest run tests/api/limit.test.ts      exit 1
         - src/api/router.ts:14 [spec] limit() is registered after the routes, not before
         - the Verify command exited 1 for the reviewer
  S-003  Document the limit         skipped   depends on S-002

Worktree: .worktrees/build-rate-limiter   Record: .agents/build/20260901-101500/BUILD.md
Stopped by: none — S-002 not accepted after 2 attempts
```

Rules for this block: no adjectives, no narrative, the exit codes as reported.
A step that is not `done` shows its notes, indented, verbatim. `residual_risk`
from the return value is printed only when it says more than the default line.

## Next action, by status

| Status | Say | Then |
|---|---|---|
| `built` | the block, `Next: /verify <planPath>` | under `then verify`: run verify's Phase 0 with `planPath` and call its workflow, same turn. Otherwise stop. |
| `blocked` | the block, the blocked step's notes, the skipped dependents | stop. The user decides: fix the plan, fix the step by hand, or `/build` again on the same plan — the worktree keeps what landed. |
| `peer_unavailable` | the block, `peer_unavailable: <reason>` | stop. Do **not** build host-side. The user asked for the other agent; substituting yourself silently is the one thing this mode must not do. |

**Name the plan on the verify call.** `verify` ranks the host's own plan
artifact above `docs/plans/`, so a bare `/verify` can pick up a plan-mode
scratch file from the same session — newer, and not what `blueprint` wrote.

## `then verify`

The chained form exists so the loop runs from one invocation: the user approves
a plan, and the next thing they read is a verdict. Under `then verify`:

1. `built` → verify's Phase 0 in the same turn, with `planPath` as the promise
   and the worktree as `cwd`. Its delta is the diff from the build's `baseline`.
   Call its workflow. Print its verdict block after the build block.
2. Anything else → the build block, and stop. A verification of a blocked build
   proves what is already known.

`/blueprint auto` is the same chain one step earlier: approval → `build … then
verify`, with no prompt between them.

## After the handoff

The worktree stays. The skill does not commit, merge, push, or remove it — what
the built branch becomes is the user's decision, and the record in
`.agents/build/<timestamp>/BUILD.md` is there for whoever makes it.

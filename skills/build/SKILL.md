---
name: build
description: Execute an approved implementation plan step by step — one implementer per S-xxx step in dependency order, a reviewer and a deterministic cheat guard on every step, each step proven by its own Verify command — then hand off to verify. Fire-and-forget, no questions asked. Use when an approved docs/plans/*.md exists and the user says "build it", "implement the plan", "go", "do it", "vas-y", "implémente le plan", "construis-le", "lance le build", or asks to delegate the coding to Codex ("fais coder Codex", "let Codex write it"). Do not use without an approved plan — run blueprint first. Once the code exists, use verify.
---

# build

A plan is a promise; a build is the promise kept, one step at a time, with the
proof for each step run before the next one starts. This skill exists so that
the model that planned the change manages the work instead of doing it in its
own context — and so that "I implemented the plan" is a table of exit codes.

All paths below are relative to this skill's directory.

## Three laws

1. **No plan, no build.** The input is a `docs/plans/*.md` with `status: approved`.
   Not a description, not the conversation, not a plan that is nearly approved.
   `scripts/plan-steps.mjs` decides — and refuses in one line.
2. **A step is done when its `Verify:` command ran and exited 0** — run by the
   reviewer, not only by the implementer — and the reviewer accepted the spec.
   A step that "looks done" is `blocked`.
3. **No repair that silences a checker.** `scripts/forbidden-repairs.mjs` scans
   the whole diff after every step. One forbidden hunk reverts it and stops the
   build; nothing after it runs.

Violating the letter of a law is violating its spirit.

## Invocations

| | |
|---|---|
| `/build` | **Default.** The newest approved plan under `docs/plans/`. |
| `/build <path>` | That plan. |
| `/build peer` | The *other* CLI agent writes the code — Codex from Claude, Claude from Codex — in the worktree, one step at a time. Review and guard unchanged. |
| `/build then verify` | After `built`, run `verify` on the same plan in the same turn. |

Modifiers combine: `/build docs/plans/x.md peer then verify`.

## Phase 0 — Pin it, then launch (deterministic, no questions)

**One invocation launches the build.** Phase 0 asks nothing, summarises nothing,
and waits for nothing: the approval already happened in the plan file, and a
confirmation here would be asking the user to approve it twice. The exact
recipe and the `args` block are in `references/phase0.md`. In short:

1. `node scripts/plan-steps.mjs --cwd <repo> [--plan <path>]`. On `ok: false`,
   print its `error` line and **stop** — that is the only way this phase ends
   without a build. On `ok: true` it hands you `planPath`, `steps` and `waves`.
2. **Worktree.** Never build on the checked-out branch. `EnterWorktree` when the
   host has it; else `git worktree add .worktrees/build-<slug> -b build/<slug>`.
   Everything below runs with `cwd` set to the worktree.
3. **Run directory.** `date +%Y%m%d-%H%M%S` → `.agents/build/<timestamp>/`.
4. **Baseline.** `git stash create` in the worktree; empty output means `HEAD`.
   The guard diffs against this to see only what the build produced.
5. **Host — only for `peer`.** `host: "claude"` or `"codex"`, whichever you are
   running inside. Never infer it from what is installed.
6. **Launch**, in this same turn, on the highest host tier available:
   - **Workflow** — `Workflow({ scriptPath: "workflows/build.mjs", args })`.
   - **Parallel subagents** — `references/fallbacks.md`, one wave per dispatch.
   - **Inline** — last resort; the record says the build ran inline.

## What the workflow does

`workflows/build.mjs`, with the briefs written out in `references/briefs.md`
for hosts that dispatch by hand:

- **Waves.** Steps run in dependency order; steps in the same wave run in
  parallel — unless they name the same file, or one names no file, in which
  case `plan-steps.mjs` already serialised them. Implementers share one
  worktree, and "they probably won't collide" is not a schedule.
- **Per step:** an implementer gets the step verbatim, touches only its
  `Files:`, runs its `Verify:` command and reports the exit code. A reviewer
  reads the diff against the step's Change and Preserve, judges quality, and
  **runs the Verify command again** — the implementer's report is a claim, the
  reviewer's run is the evidence. Then the guard scans the diff.
- **Done** needs all three: implementer exit 0, reviewer exit 0, reviewer
  accepted. Otherwise one retry with the reviewer's issues, then `blocked`.
  Dependents of a blocked step are `skipped` by name, never attempted.
- **An agent that never returned** — errored, timed out, hit a quota — makes
  the step `unproven`, not `blocked`, and buys no retry. Nothing is known to be
  wrong and nothing was checked; blaming the code for an outage is the mistake
  this status exists to prevent. It is not a pass: the build still refuses to
  hand off.
- **`peer` mode** replaces the implementer with `scripts/peer-build.mjs`, which
  runs the other CLI in the worktree with a write sandbox and nothing more —
  no approval bypass, no full access. It never runs the Verify command and never
  runs the guard: the reviewer and the guard do, exactly as for a host
  implementer. Flags and refusals: `references/peer.md`. A rejected peer step is
  `blocked` with no retry — its prompt comes from the plan step alone, so the
  reviewer's issues have no way to reach it. An unavailable peer stops the build
  as `peer_unavailable`; the host does not quietly take over the work it was
  asked to delegate.
- **Record.** `<runDir>/BUILD.md` — the step table, what was skipped and why,
  what stopped the build.

## Phase 1 — Hand off

`references/handoff.md`. The return value is the step table; report it as a
table, not as prose. Then:

```
built      → /verify <planPath>     (name the path — verify ranks the host's
                                     own plan artifact above docs/plans/)
blocked    → the blocked step, its notes, the skipped dependents; stop.
unproven   → an agent never returned, so those steps were never judged. Say
             that, offer to re-run; never call an unjudged step failing.
peer_unavailable → say so in those words, and stop. Do not build host-side
                   unless the user asks again without `peer`.
```

Under `then verify`, a `built` result runs `verify`'s Phase 0 with `planPath`
and calls its workflow in the same turn. Anything else stops.

## What this does not do

- **Does not plan.** No plan, no build. It does not write one, extend one, or
  reinterpret one — a step the plan under-specified is `blocked` with a note.
- **Does not verify the whole.** Each step is proven by its own command; the
  change as a whole is `verify`'s job, and the handoff says so.
- **Does not renumber `S-xxx`.** Ever.
- **Does not build on the user's branch.** Worktree or nothing.
- **Does not commit.** The worktree holds the work; the user decides what it becomes.
- **Does not ask.** A missing or unapproved plan is a one-line refusal, not a
  conversation. Everything else was decided when the plan was approved.

## Red flags

| Thought | Reality |
|---|---|
| "They said build it, so which plan do they mean?" | `plan-steps.mjs` picks the newest approved one. Run it. |
| "I'll summarise the plan before starting" | The Workflow call is the summary. Launch. |
| "Let me confirm they really want this" | They approved the plan. Asking again is the delay this skill exists to remove. |
| "The implementer said the tests pass" | The reviewer runs them. A claim is not an exit code. |
| "S-003 doesn't really need S-002" | The plan says it does. Skipped, by name. |
| "The peer is down, I'll write it myself" | Then it was not `peer`. Say `peer_unavailable` and stop. |
| "One `it.skip` and the step is green" | That is the hunk the guard reverts, and the build stops. |

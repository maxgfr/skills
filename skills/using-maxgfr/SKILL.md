---
name: using-maxgfr
description: Router for the maxgfr process skills — blueprint plans, build implements, verify proves. Use when starting any conversation, and whenever the user asks to plan, design or scope a change ("plan this", "planifie"), to implement an approved plan ("build it", "go", "vas-y", "implémente"), or to check that work is done ("verify", "vérifie", "did that actually work"). Injected at session start by the plugin's hook; invoke it by hand on a host without hooks.
---

# using-maxgfr

Three skills, one loop: a plan is written and approved, the plan is built, the
build is proven. Each hands off to the next by a file on disk, so none of them
needs the conversation that produced the previous one.

| When | Skill | What it leaves behind |
|---|---|---|
| The user wants a change planned, designed, scoped, or their idea stress-tested — "plan this", "planifie", "grill me" | `blueprint` | `docs/plans/<date>-<slug>.md`, `status: approved` once they say yes |
| An approved plan exists and the user says implement it — "build it", "go", "do it", "vas-y", "implémente", "let Codex write it" | `build` | the code, in a worktree, with a step table of exit codes |
| You are about to say done, fixed, passing, or working — or the user says "verify", "vérifie", "check my work" | `verify` | a verdict backed by executed commands |

Under the plugin the names are `maxgfr:blueprint`, `maxgfr:build`,
`maxgfr:verify`; installed with `npx skills add` they are the bare names.

## Fire-and-forget

`build`, `build peer`, `verify` and `blueprint auto` are **launched, not
discussed**. Each has a deterministic Phase 0 — find the plan, pin the diff,
make the worktree, detect the gates — and then calls the Workflow in the same
turn. No clarifying question, no summary of what is about to happen, no "shall
I proceed": the approval already happened, in the plan file, in as many words.
The only refusal is a missing or unapproved plan, and it is one line.

`blueprint` is the exception, and deliberately so: it asks until nothing is
silently assumed, and its approval gate never scales down. `blueprint auto`
keeps that gate and removes every prompt after it — approval, then build, then
verify, from one invocation.

## Yields

This router names only its own three skills. Everything else belongs to
whichever skill is installed for it, and this one steps aside:

- **TDD, red-green, writing the failing test first** — another skill's.
- **Debugging, a failing test, unexpected behaviour** — another skill's.
- **Code review of a diff or a PR** — another skill's. `verify` proves a
  change against its plan; it is not a review.
- **Brainstorming an idea** — another skill's, unless the deliverable is the
  written plan, in which case `blueprint` is that skill.
- **Worktrees, branches, merging, shipping** — the host's tools and whatever
  skill governs them. `build` uses a worktree; it does not manage the branch.

A skill that is not installed is not a reason to improvise its job here.

## Red flags

| Thought | Reality |
|---|---|
| "They said build it — which plan do they mean?" | `plan-steps.mjs` picks the newest approved one. Launch. |
| "I'll summarise the plan before starting" | The Workflow call is the summary. |
| "Let me confirm they really want this" | The plan file says `approved`. Asking again is the delay this router exists to remove. |
| "Tests pass, so it's done" | Then `verify` costs one call and says so with evidence. |
| "This is a small change, no plan needed" | Small is `blueprint` keeping the ceremony proportional — not `build` without a plan. |
| "I'll write the code in this context, it's faster" | Faster once. `build` leaves a step table; this context leaves nothing. |

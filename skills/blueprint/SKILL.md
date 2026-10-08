---
name: blueprint
description: Plan a code change before writing it — settle the open decisions with the user, ground every fact in the repo, write an approved docs/plans/ file. Use when the user asks for a plan, or before a change that spans several files or leaves a design decision open.
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# blueprint

Write a plan that a `small`-tier model can implement step by step without having
been in this conversation. You plan; you do not implement. Paths are relative to
this skill's directory.

## Laws

1. **No design while a decision is open.** Every unsettled choice that could change behavior goes to the user first.
2. **No repository claim without `path:line`.** A fact you cannot cite gets asked about or written down as an assumption.
3. **The file is the promise.** `build` and `verify` read the plan, not this chat.

## Invocations

`$blueprint` (Codex), `/maxgfr:blueprint` (Claude plugin), `/blueprint` (standalone). Arguments:
none (write a new plan), `<path>` (revise that plan), `auto` (after approval, run build then verify).

## Phases

1. **Orient.** Read the request, the `AGENTS.md` / `CLAUDE.md` in play, and the smallest useful slice of the repo, so you never ask what the repo answers. Scale the process to the change. The approval gate never scales down.
2. **Grill.** `references/grill.md`. Skip it only when no open decision could change behavior, scope, an interface, the data or the acceptance criterion.
3. **Ground.** Reopen the files the answers implicate. Every fact the plan relies on gets a `path:line`. A file to create is named as new.
4. **Write.** `references/artifact.md`, to `docs/plans/<YYYY-MM-DD>-<slug>.md`, with `status: awaiting-approval`. If one local pattern dominates, use it. Otherwise pick an approach and state in one line why it wins.
5. **Check.** Run each step's Verify command once, output capped (`2>&1 | tail -5`). It must pass, or fail only because the step's change is missing (a file, a symbol, an assertion). A usage error, an unknown flag, a missing tool or a runner rejecting its arguments means the command is wrong: fix it in the plan. Skip any command that would write.
6. **Approve.** Show the path and ask for approval in those words. Before the yes, the plan file is the only thing you write.

On approval, set `status: approved`. Then:

- `auto` → invoke `build <path> then verify` in the same turn.
- otherwise → one line: the path, and the build call that takes it.

## Does not

- Implement, make a worktree, commit, or run a command that changes the project.
- Decide for the user. "Your call" is locked as delegated; "I don't know" stays a question.
- Renumber `S-xxx`.

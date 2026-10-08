# Dispatch without a Workflow tool

For any host with a subagent tool. Same ladder and same briefs as
`workflows/build.mjs`. Paste the briefs, do not paraphrase them. "On tier `t`"
means model `tiers[t].model` and effort `tiers[t].effort`, each passed only when
set and when the tool takes it.

## Loop

For each wave in `waves`, in order:

1. Skip any step whose dependency is not `done` (`needs S-xxx`).
2. Send every implementer of the wave in one message, each on the tier of its own attempt (`tiers.attempts[i]`).
3. Then send **one** reviewer for all of them, on tier `tiers.review`.
4. Decide each step:
   - The reviewer's `guard` is not `CLEAN`: send the revert brief on tier `tiers.attempts[0]`, mark the reviewed steps `blocked`, stop the build.
   - Implementer `exit` 0, and the reviewer's entry for it has `exit` 0 and `ok`: `done`.
   - Otherwise, next attempt with the reviewer's issues. After the last attempt: `blocked`. Repeat 2–4 for the retried steps only.
   - An agent that never returned, or a step missing from the reviewer's answer: `unproven`, no retry.

Keep only the JSON each agent returns. Do not read diffs or logs yourself; the reviewer did.

## Implementer

Returns `{done, files, exit, out, blocked_by?}`.

```
Worktree (the only place you may write; run every command here; do not commit): <cwd>
Plan: <planPath>

Implement exactly this step and nothing else:

<the whole ### S-xxx block, verbatim>

- Touch only the files under Files:. Open a file before editing it; never guess a path or a symbol.
- Then run, from the worktree: <verifyCmd>  (expected: <verifyExpected>)
- Return JSON: done (Verify exited 0 and every Change bullet is in), files (relative paths), exit (-1 if it did not finish), out (at most 10 lines of its output).

YOU MAY NOT: skip, delete, weaken or .only a test; change an expected value to match the output; add @ts-ignore, @ts-expect-error, eslint-disable, # type: ignore or # noqa; widen a type to any; swallow an error in an empty catch; edit a gate command, CI workflow, Makefile target or the plan; commit. If the step needs one of those, stop and set blocked_by.
```

On a retry, append:

```
The previous attempt was rejected. Fix every item:
- <issue>
```

## Reviewer

Returns `{guard, violations?, steps[{id, ok, exit, issues[≤5]}]}`.

```
Worktree (the only place you may write; run every command here; do not commit): <cwd>
Plan: <planPath>

Review the change for these steps. Read and run anything; edit nothing.

<each ### S-xxx block being reviewed, verbatim, separated by a blank line>

1. Read `git diff <baseline> -- <every file of those steps>` and any untracked file there (`git status --porcelain`). Per step: every Change bullet present, Preserve untouched, no file outside its Files:, no debug output or dead code.
2. Run each step's Verify command:
   <S-xxx>: <verifyCmd>
3. Run once: node <skillDir>/scripts/forbidden-repairs.mjs --since <baseline> --plan <planPath>
Return JSON: guard (the "verdict" of 3), violations (3's violations as "rule file:line"), steps (one per step: id, ok (1 holds), exit (of its command in 2), issues (at most 5, each "file:line — problem")).
```

When you dispatch by hand you have Bash: you may run step 3 yourself instead.

## Revert

```
Worktree (the only place you may write; run every command here; do not commit): <cwd>
Plan: <planPath>

Revert exactly these forbidden hunks and nothing else: <violations>. Use `git checkout -p` or restore and re-apply the clean hunks. Return the reverted files.
```

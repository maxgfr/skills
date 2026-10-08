# Dispatch without a Workflow tool

Run `workflows/build.mjs` by hand with these briefs, as written. Each agent gets its tier's `model` and `effort` when set and when the tool takes them. With no subagent tool, play each role yourself and mark the output `inline`. Per wave:

1. A step whose dependency is not `done` is `skipped` (`needs S-xxx`).
2. Send the implementers in one message, each on its attempt's tier (`tiers.attempts[i]`), then one reviewer for all on `tiers.review`.
3. Guard not `CLEAN`: on `tiers.attempts[0]`, send `Revert exactly these forbidden hunks and nothing else: <violations>.`, mark the steps `blocked`, stop.
4. Both `exit` 0 and `ok`: `done`. Else retry on the next attempt with the issues, then `blocked`; `blocked_by` jumps to the last attempt.
5. No answer from an agent, or a step the reviewer left out: `unproven`, no retry.

## Implementer

```
Work and run commands only in <cwd>; do not commit.

Implement this step, nothing more:

<the ### S-xxx block, verbatim>

Touch only its Files, run its Verify once, use few tool calls.
Never skip, weaken or delete a test, fit an expected value to the output, add a suppression comment, widen a type to any, swallow an error, or edit a gate, CI or the plan; if the step needs that, stop and return blocked_by.
Return JSON: exit (Verify's exit code, -1 if not run), blocked_by (only if you stopped).
```

A retry appends `The previous attempt was rejected. Fix every item:` and one `- <issue>` line each.

## Reviewer

`<paths>`: every `Files` path of the steps reviewed, or `.`.

```
Work and run commands only in <cwd>; do not commit. Edit nothing.

Review these steps:

<each ### S-xxx block, verbatim>

Run this once, as a single shell call:

git diff <baseline> -- <paths>
for f in $(git ls-files -o --exclude-standard -- <paths>); do git diff --no-index /dev/null "$f"; done
out=$( (<verifyCmd>) 2>&1 ); e=$?; printf '%s\n' "$out" | tail -15; echo "<S-xxx> exit=$e"     (one per step)
node <skillDir>/scripts/forbidden-repairs.mjs --brief --since <baseline> --plan <planPath>

Output: the diff, each Verify ending "S-xxx exit=N", then the guard (CLEAN, or "rule file:line" lines). Per step: every Change in, Preserve kept, nothing outside its Files, no debug or dead code. Open a file only if the diff leaves a doubt.
Return JSON: guard (CLEAN or FORBIDDEN), violations (the guard's lines), steps (per step: id, ok, exit (its exit=N), issues (at most 3, "file:line — problem")).
```

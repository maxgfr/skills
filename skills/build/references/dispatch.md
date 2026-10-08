# Delegating the steps

**Tiers.** Read `~/.agents/models.json`, then `<repo>/.agents/models.json`, which wins key by key. Under your host's name (`claude`, `codex`, `opencode`…), `small`, `medium` and `large` are `{ "model", "effort" }` or a bare model name; `review` is the reviewer's tier (default `medium`). Anything missing (a bare model name has no effort), or a tool that takes no model, means your own model and effort. Pick each step's tier yourself: `small` for a plain step, `medium` for a tricky one.

**Loop**, wave by wave. A wave is every step whose dependencies are `done`, minus any that shares a file with another step of the wave (it waits for the next).

1. Send the wave's implementers in one message, each on the model and effort of the tier you picked, then one reviewer for all of them.
2. Reviewer `forbidden` not empty: revert those hunks yourself, mark the steps `blocked`, stop.
3. Implementer and reviewer `exit` 0 and `ok`: `done`. Otherwise retry once more on the next tier up with the reviewer's issues, at most three tries per step, then `blocked`. A `blocked_by` goes straight to `medium`.
4. An agent that never answered, or a step the reviewer left out: `unproven`, which is not a pass.

## Implementer

```
Work and run commands only in <worktree>; do not commit.

Implement this step, nothing more:

<the ### S-xxx block, verbatim>

Touch only its Files, run its Verify once, use few tool calls.
Never skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan; if the step needs that, stop and return blocked_by.
Return JSON: exit (Verify's exit code, -1 if not run), blocked_by (only if you stopped).
```

A retry appends `The previous attempt was rejected. Fix every item:` and the issues.

## Reviewer

```
Work and run commands only in <worktree>; do not commit. Edit nothing.

Review these steps:

<each ### S-xxx block, verbatim>

Read the diff once: `git diff HEAD -- <their Files>` plus their new files. Rerun each Verify once.
Per step: every Change in, Preserve kept, nothing outside its Files, no debug or dead code. Anywhere in the diff, a change that tries to skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan is forbidden.
Return JSON: forbidden (each "file:line — what"), steps (per step: id, ok, exit (Verify's exit code), issues (at most 3, "file:line — problem")).
```

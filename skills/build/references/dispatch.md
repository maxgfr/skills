# Delegating the steps

**Tiers.** Read `~/.agents/models.json`, then `<repo>/.agents/models.json`, which wins key by key. Under your host's name (`claude`, `codex`, `opencode`…), `small`, `medium` and `large` are `{ "model", "effort" }` or a bare model name; `solo` is the largest plan you build yourself (default 3); `attempts` is the tier of each try at a step (default `["small", "small", "medium"]`); `review` is the reviewer's tier (default `medium`). Anything missing, or a tool that takes no model, means your own model and effort.

**Loop**, wave by wave. A wave is every step whose dependencies are `done`, minus any that shares a file with another step of the wave (it waits for the next).

1. Note the baseline: `git stash create` in the worktree, or `HEAD` if it prints nothing.
2. Send the wave's implementers in one message, each on its attempt's tier, then one reviewer for all of them.
3. Reviewer `forbidden` not empty: revert those hunks yourself, mark the steps `blocked`, stop.
4. Implementer and reviewer `exit` 0 and `ok`: `done`. Otherwise retry on the next attempt with the reviewer's issues; after the last one, `blocked`. A `blocked_by` jumps to the last attempt.
5. An agent that never answered, or a step the reviewer left out: `unproven`, which is not a pass.

## Implementer

```
Work and run commands only in <worktree>; do not commit.

Implement this step, nothing more:

<the ### S-xxx block, verbatim>

Touch only its Files, run its Verify once, use few tool calls.
Never skip, weaken or delete a test, fit an expected value to the output, add a suppression comment, widen a type to any, swallow an error, or edit a gate, CI or the plan; if the step needs that, stop and return blocked_by.
Return JSON: exit (Verify's exit code, -1 if not run), blocked_by (only if you stopped).
```

A retry appends `The previous attempt was rejected. Fix every item:` and the issues.

## Reviewer

```
Work and run commands only in <worktree>; do not commit. Edit nothing.

Review these steps:

<each ### S-xxx block, verbatim>

Read the diff once: `git diff <baseline> -- <their Files>` plus their new files. Rerun each Verify once.
Per step: every Change in, Preserve kept, nothing outside its Files, no debug or dead code. Anywhere in the diff: a test skipped, weakened or deleted, an expected value changed to fit, a suppression comment, a type widened to any, a swallowed error, or an edited gate, CI file or plan is forbidden.
Return JSON: forbidden (each "file:line — what"), steps (per step: id, ok, exit (Verify's exit code), issues (at most 3, "file:line — problem")).
```

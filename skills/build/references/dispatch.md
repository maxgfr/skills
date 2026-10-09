# Delegating with a subagent tool

With a subagent tool and no workflow run: run by hand the loop the script of `references/workflow.md` codes. The prompts are the template literals of its `implementerPrompt`, `reviewerPrompt` and `fixerPrompt`, `${…}` filled in by hand. Each subagent runs on the model and effort of its tier (`references/tiers.md`).

1. In one message, launch an implementer for every step whose waits are all `done`. A step waits for its `Depends on` and for any earlier step that shares a file. Each prompt names its step by id; the subagent reads it from the plan.
2. As each implementer answers, launch its reviewer, and launch every step that just became ready, without waiting for the others. A subagent tool that returns only when every call of a message answered runs in waves: each message launches every ready implementer and the reviewer of every implementer that answered.
3. Reviewer `forbidden` not empty: revert those hunks yourself, mark the step `blocked`, and launch no new implementer. Implementers already running finish and are reviewed. A step never launched, or whose running try is rejected and so cannot retry, is `skipped` with the note `stopped on a forbidden change`.
4. Implementer and reviewer `exit` 0 and `ok`: `done`. Otherwise retry one tier up, the reviewer's issues listed after `The previous attempt was rejected. Fix every item:`, three tries at most, then `blocked`. An `escalate`, or a `blocked_by` below `large`, hands the step straight to `large` with its reason, and that try does not count; a `blocked_by` on `large` blocks the step.
5. A step waiting for one that is not `done` is `skipped`. An agent that never answered is `unproven`, which is not a pass.

A repair round, at the round's tier: one fixer at a time, each group with a file, then the group with no file.

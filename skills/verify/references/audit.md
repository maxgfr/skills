# Audit brief

```
Audit this change. Read anything, run read-only commands, edit nothing.

Repo: <cwd>
Diff: `<the diff command>`, plus untracked files: <paths, or "none">
Plan: <planPath, or "none">
Checks already ran, do not rerun them: <cmd exit, one per line>

Report only what blocks: wrong behavior, a crash, data loss, a security hole, a plan's Change missing or Preserve broken, or a silenced check (a test skipped, weakened or deleted, an expected value changed to fit, a suppression comment, a type widened to any, a swallowed error, an edited gate or CI file). Each finding gives a file:line in the diff and a concrete scenario (input or state, wrong result). Try to refute it from the surrounding code; drop what you cannot show. At most 5, worst first.

Return JSON only: {"findings":[{"at":"file:line","issue":"one line","scenario":"one line"}]}, empty when nothing blocks.
```

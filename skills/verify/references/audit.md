# Audit brief

```
Audit this change. Read anything, run read-only commands, edit nothing.

Repo: <cwd>
Diff: `<the diff command>`, plus untracked files: <paths, or "none">
Plan: <planPath, or "none">
Gates already ran, do not rerun them: <cmd exit, one per line>

Report only what blocks: wrong behavior, a crash, data loss, a security hole, or a plan's Change missing or Preserve broken. Each finding gives a file:line in the diff and a concrete scenario (input or state, wrong result). Try to refute it from the surrounding code; drop what you cannot show. At most 5, worst first.

Return JSON only: {"findings":[{"at":"file:line","issue":"one line","scenario":"one line"}]}, empty when nothing blocks.
```

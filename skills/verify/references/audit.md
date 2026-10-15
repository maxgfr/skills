# Audit brief

```
Audit this change. Read anything, run read-only commands, edit nothing.

Repo: <cwd>
Diff: `<the diff command>`, plus untracked files: <paths, or "none">
Scope: <one file, or the whole diff>
Plan: <planPath, or "none">
Checks already ran, do not rerun them: <cmd exit, one per line>

Report only what blocks: wrong behavior, a crash, data loss, a security hole, a step's Change missing or something it says must not move changed, or a change that tries to skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan. Each finding gives a file:line in the diff and a concrete scenario (input or state, wrong result). Try to refute it from the surrounding code; drop what you cannot show. At most 5, worst first.

Return JSON only: {"findings":[{"at":"file:line","issue":"one line","scenario":"one line"}]}, empty when nothing blocks.
```

# Refute brief

```
Refute this finding. Read anything, run read-only commands, edit nothing.

Repo: <cwd>
Diff: `<the diff command>`
Plan: <planPath, or "none">
Finding: <at> — <issue> · <scenario>

Read the code around it and try to show the scenario cannot happen. In doubt, it is refuted.

Return JSON only: {"real":true|false,"why":"one line"}
```

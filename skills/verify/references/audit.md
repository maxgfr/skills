# Audit brief

Paste it verbatim and fill in the placeholders. Returns
`{"findings":[{"at":"file:line","issue":"…","scenario":"…"}]}`.

```
Audit this change. Read anything and run read-only commands; edit nothing.

Repo: <cwd>
Diff: `<the diff command>`, plus these untracked files: <paths, or "none">
Plan: <planPath, or "none">
Gates already ran; do not rerun them or report their failures again:
<one line per gate: cmd exit>

Report only blocking findings: the change is wrong in a way a user or a caller would hit. That means wrong behavior, a crash, data loss, a security hole, or (with a plan) a Change bullet missing or a Preserve broken. Style, naming, a missing test for code that works, and anything you cannot show are not findings.

Each finding names a file:line inside the diff and a concrete failure scenario: the input or state, and the wrong result. If you cannot write the scenario, drop the finding.

Before keeping a finding, try to refute it by reading the code around it. Keep at most 5, most severe first.

Return JSON only: {"findings":[{"at":"file:line","issue":"one line","scenario":"one line"}]}. Use an empty array when nothing blocks.
```

# Sub-agent briefs

The same text `workflows/build.mjs` embeds, written out for hosts that dispatch
by hand (`fallbacks.md`). Paste, do not paraphrase: a brief that drifts from
the workflow's is two builds wearing one name.

`CONTEXT` is, verbatim:

```
Repo — an isolated worktree, the only place you may write: <cwd>
Plan — the promise this build is held to: <planPath>
Run every command from <cwd>. Do not commit.
```

`FORBIDDEN` is, verbatim:

```
YOU MAY NOT: skip, delete, weaken or .only a test; change an expected value to match what the code produces; add @ts-ignore, @ts-expect-error, eslint-disable, # type: ignore or # noqa; widen a type to any or "unknown as"; swallow an error in an empty catch; edit a gate command, a CI workflow, a Makefile target, or the plan file; commit; renumber or rename a step.

If the step cannot be completed without one of those, STOP and return done_claimed: false with blocked_by describing what would be required. That answer is correct and useful — a step landed by silencing its own proof is not landed.
```

## Implementer — `impl:S-xxx`

Returns `{ done_claimed, files_touched[], verify_cmd, verify_exit_code, verify_output, notes?, blocked_by? }`.

```
<CONTEXT>

Implement exactly this step of the plan, and nothing else. The plan is the promise; this step is your whole scope.

<the step, verbatim — its whole `### S-xxx` block>

Rules:
- Touch only the files the step names under Files:. A file it does not name belongs to another step.
- Never guess a path or a symbol — open the file. The plan cites what it depends on; if a cited fact is wrong, say so in notes and stop rather than improvising.
- When the change is in, run the Verify command exactly as written, from <cwd>:
    <verifyCmd>
  Expected: <verifyExpected>
- Report its exit code and the first 15 lines of its output verbatim. A command you did not run to completion has no exit code: report -1 and say why in notes.
- files_touched holds paths relative to <cwd>, never absolute ones — they go into a record another agent reads against the plan.
- done_claimed is true only if the Verify command exited 0 AND every bullet under Change is in place.

<FORBIDDEN>
```

On a retry, append:

```
A reviewer rejected the previous attempt. Address every item below; do not argue with it in prose, change the code:
<the reviewer's issues, one per line, file:line [kind] issue>
```

## Reviewer — `review:S-xxx`

Returns `{ spec_ok, quality_ok, verify_exit_code, verify_output, issues[{file,line,issue,kind}], summary? }`.

```
<CONTEXT>

Review the change just made for this step. You may read anything and run commands; you may not edit a file.

<the step, verbatim>

1. Spec — read the diff (`git diff <baseline> -- <files>` plus any untracked file under those paths; untracked files appear in no diff, so list them with `git status --porcelain`). For every bullet under Change: is it present? Is everything under Preserve untouched? Was any file outside Files: modified for this step?
2. Quality — does the change follow the surrounding code's conventions, handle the failure cases the step implies, and leave no debug output, TODO, or dead code behind?
3. Proof — run the Verify command yourself, exactly as written, from <cwd>:
    <verifyCmd>
   Report its exit code and the first 15 lines of its output. The implementer's own report is a claim; your run is the evidence.

spec_ok is true only when every Change bullet is present and Preserve holds. quality_ok is true only when nothing under 2 needs fixing. Every issue carries file:line and a kind (spec | quality | scope). Fix nothing.
```

## Guard — `guard:S-xxx`

Returns `{ verdict: "CLEAN" | "FORBIDDEN", violations[] }`. Cheap effort; it
transcribes.

```
Run exactly this from <cwd> and return its JSON output:

node <skillDir>/scripts/forbidden-repairs.mjs --since <baseline> --plan <planPath> --pretty

Set verdict from the output's "verdict" field and copy its violations. Do not edit any file. Do not interpret — transcribe.
```

## Revert — `revert-forbidden`

```
<CONTEXT>

The last step introduced forbidden repairs. Revert exactly these hunks and nothing else, leaving the legitimate parts of the step in place:

<the guard's violations, as JSON>

Use `git checkout -p` or restore the file and re-apply the clean hunks. Report what you reverted.
```

## Peer — `peer:S-xxx` (peer mode only)

Returns `{ status: "ok" | "peer_unavailable" | "peer_output_invalid", reason?, files_touched[], duration_ms, last_message? }`.

```
Run exactly this from <cwd> and return its JSON output verbatim:

node <skillDir>/scripts/peer-build.mjs --host <host> --cwd <cwd> --plan <planPath> --step <S-xxx> --out <runDir>/peer/<S-xxx> --timeout-ms <peer.timeout_ms>

Do not edit any file yourself. Do not interpret — transcribe. If the command itself cannot be started, return status "peer_unavailable" with the error as reason.
```

## Summary — `summary`

Writes `<runDir>/BUILD.md` from the step table. Cheap effort. Runs after the
last step, never before the first.

## The decision, in one place

A step is `done` when **all** of: the implementer's `verify_exit_code` is 0
(host mode — in peer mode the peer's claims are not consulted), the reviewer's
`verify_exit_code` is 0, and the reviewer returned `spec_ok: true` and
`quality_ok: true`.

Anything else, in order:

| What happened | Status | Retry? |
|---|---|---|
| The reviewer rejected it, or a Verify command exited non-zero | `blocked` after one retry with the reviewer's issues | yes, once |
| The implementer returned `blocked_by` | `blocked` at once | no — it told you the plan is short, and a second attempt will not lengthen it |
| The guard returned `FORBIDDEN` | `blocked`, revert the hunks, `stopped_by`, nothing further is implemented | no |
| **An agent did not return at all** — it errored, timed out, or hit a quota | **`unproven`** | **no** |

That last row is the one worth getting right. An agent that never ran found
nothing because it never ran, which is not the same as a step that failed
review. Marking it `blocked` blames the code for an outage, and retrying the
implementer spends a second one against the same outage. `unproven` is not a
pass — the build still refuses to hand off to `verify` — it is the honest third
answer, and the record says which steps nobody judged.


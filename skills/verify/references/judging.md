# Phase 3 — Adversarial judging

A verification pass that reports everything it suspects is worse than no verification pass: you stop trusting it, and then you stop reading it. This phase exists so that what reaches you has already survived someone trying to kill it.

## The protocol

Every candidate finding from lanes B, C and D goes to a skeptic. **Lane A does not** — an exit code is not an opinion.

The skeptic's instruction is to refute, not to assess. "Is this a real bug?" invites agreement; "prove this is wrong" invites work.

**Skeptic brief:**

> A reviewer claims this is a defect:
>
> - File: `<file>:<line>`
> - Defect: `<defect>`
> - Failure scenario: `<failure_scenario>`
>
> Your job is to **refute it**. Read the actual code — the file, its callers, its tests, the types involved. Find the reason the claim is wrong.
>
> Common reasons a claim collapses: the input is validated upstream; the type makes the state unreachable; a caller already handles it; the branch is dead; there is a test covering exactly this; the reviewer misread which variable is in scope; the behaviour is intentional and documented.
>
> Then answer:
> - `refuted: true` with the reason and the `file:line` that proves it, **or**
> - `refuted: false` with the shortest concrete path from a real entry point to the failure. If you cannot write that path, the claim is unproven — return `refuted: true, reason: "no reachable path"`.
>
> Default to refuted when uncertain. A defect nobody can reach is not a defect.
>
> Return `{refuted, reason, evidence_file, evidence_line, severity_adjustment}`.

## How many skeptics

| Claimed severity | Skeptics | Survives if |
|---|---|---|
| `blocking` | 3, with distinct angles: *is it reachable?* · *is it already handled?* · *does the scenario actually produce that outcome?* | at least 2 say `refuted: false` |
| `major` | 1 | it says `refuted: false` |
| `minor` | 1, cheap model | it says `refuted: false` |

A blocking claim is expensive to be wrong about in both directions — it stops the loop and it triggers a fix — so it gets a panel. Anything else gets one pass.

A skeptic may return `severity_adjustment` to downgrade (`blocking` → `major`) when the finding is real but the scenario is narrower than claimed. Downgrades apply; upgrades do not — a skeptic promoting a finding it was asked to kill is the failure mode this phase is built to prevent.

## Deduplication

Before judging, merge non-machine candidates that name the same `file:line ± 3`,
keeping the first wording and the highest severity. Two lenses finding one bug
is a signal of confidence, not two bugs — merge `found_by` and judge it once.
Never merge machine truth: each failed command keeps its own executed evidence.

This is the one place a barrier is justified in the pipeline: dedup needs every lane's candidates before expensive judging starts. Everything else flows.

## What you report

- **Survivors**, ranked blocking → major → minor.
- **A count of refuted candidates.** `(7 candidates refuted)` next to the verdict. Not a list — the list is in the report file for anyone who wants to audit the skeptics.

Never launder a refuted finding into a "note" or a "possible concern". It was refuted. It goes in the file.

## What never faces a skeptic

Machine truth. An exit code is not an opinion, and a behaviour that was executed and did the wrong thing is not an argument to be refuted. Both enter the pool already carrying their proof:

- a failed or timed-out gate (`from_gate`)
- a behaviour the lane ran and disproved (`from_behavior`)

A run beats an argument. Sending these to a skeptic invites it to talk its way past evidence.

## When the skeptics are wrong

They will be, sometimes. The guard is that the refuted list lands in `.agents/verify/<ts>/findings.json` with each skeptic's reasoning and vote, so a wrong kill is auditable rather than invisible.

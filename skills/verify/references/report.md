# The report, as it reaches the conversation

`SKILL.md` carries the contract: the three verdicts, the rule that findings the
skeptics killed are a count, and the residual-risk requirement. This is what
the block looks like when it is right, and the thoughts that make it wrong.

## Default gates-only report

The default route writes this directly from structured gate evidence; it does
not invoke a reporter agent:

```
VERDICT: PASS — tier: ultralight
  ultralight: gates only — diff, promise, defect analysis, behaviour proof, and repair were not run.

EVIDENCE
  test  npm test  exit 0  42 tests passed

RESIDUAL RISK
  Passing gates do not show that the change is correct or matches its promise; use `verify light` for analysis and repair.

Full report: .agents/verify/20260907-142233/REPORT.md
```

A blocking gate that fails, times out, or cannot run is `FAIL` after the same
single pass. A non-blocking failure stays in EVIDENCE but does not sink the
verdict. If no gate is detected, omit agent work, return `UNPROVEN`, and state
that no gate or behaviour proof completed. Do not escalate the tier. The main
context must write the short file before naming its path.

## Richer-tier example

```
VERDICT: FAIL — 2 blocking, 3 major, 4 minor   (7 candidates refuted)   tier: normal

EVIDENCE
  typecheck  pnpm run typecheck   exit 2   src/api/user.ts(41,7): Type 'string | undefined' is not assignable
  test       pnpm run test        exit 1   14 passed, 1 failed — "rejects an expired token"
  build      not run              —        blocked by typecheck

BLOCKING
  1. src/api/user.ts:41 — `email` is optional upstream but consumed as required.
     Fails when: a user signs up via OAuth without an email → 500 on first request.
     Fix: narrow at the boundary in `parseProfile`, or make the field required in the schema.

REQUIREMENTS  4 implemented · 1 partial · 1 missing · 1 out of scope
  missing — "rate-limit the endpoint" (plan §3) — no limiter anywhere in the diff

RESIDUAL RISK
  No e2e suite in this repo; the OAuth path was proven by running it, the SAML path was not.

Full report: .agents/verify/20260815-142233/REPORT.md
```

Every EVIDENCE row names a command, an exit code, and a line of its output. A
gate that could not run says `not run` and why — never a bare status. Every
finding carries the concrete failure scenario and a direction for the fix; a
finding without a scenario did not survive judging and does not appear here.

## The limited-tier second line

Below `deep`, the verdict line is followed by what the tier did not do, worded
from `residual_risk` in the workflow's return value. For example:

```
VERDICT: PASS — 0 blocking   (3 candidates refuted)   tier: light
  light: no behaviour proof — nothing was run to prove it works — and one
  skeptic per claim rather than a panel.
```

For `ultralight`, name every skipped evidence class shown in the default example.
That line is the only thing between a gates-only PASS and a reader who takes it
for full verification.

## Red flags

| Thought | Reality |
|---|---|
| "Tests passed last run, so they pass" | Run them now. Stale evidence is not evidence. |
| "The diff looks right" | Reading is not proving. Lane A or it did not happen. |
| "This is probably a bug" | Send it to a skeptic. Probably means unverified. |
| "One `@ts-ignore` and the gate is green" | That is the repair the loop exists to refuse. |
| "The plan was wrong, I'll update it" | Escalate. Rewriting the promise is not verification. |
| "Nothing to report, everything passed" | Then name what you could not verify. There is always something. |
| "The peer was down, but I reviewed it myself" | Then it was not crosschecked. Say that word only when it happened. |
| "The report is long, I'll summarise the findings" | The block above is the summary. Findings are listed, not described. |

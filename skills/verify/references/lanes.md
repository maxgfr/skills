# Phase 2 — The four lanes

Four independent ways of being wrong, checked four independent ways. They run in parallel and never see each other's output — a lane that knew what another lane found would rationalise instead of check.

Each brief below is what the sub-agent receives. Give it the matrix entry it owns and the diff command; it fetches its own context from there.

---

## Lane A — Gates (evidence)

The only lane whose output is machine truth. Nothing here is a judgement call, and nothing here goes to the skeptics.

**Brief:**

> Run each of these commands from the repo root, in the order given, and report what happened. Do not fix anything. Do not interpret. Do not stop early unless a command's failure makes the next one meaningless (a failed build makes a test run meaningless; a failed lint does not).
>
> For each: `{id, cmd, exit_code, duration_s, failures_count, first_failing_lines}` — at most 15 lines of output, chosen to show the *first* failure, not the summary tail. If a command does not exist or the tool is not installed, report `exit_code: null` and `status: "not_run"` with the error. Never report a command as passing that you did not run to completion.
>
> Commands: `<gates from the matrix>`

**Order:** typecheck → lint → format → test → build → e2e, then CI-derived extras. Fast and specific before slow and broad, so the first failure arrives early.

**Timeouts:** from the matrix. A timeout is `status: "timeout"`, never a pass.

---

## Lane B — Plan conformance

Answers the question tests cannot: *did we build what we said we would?*

**Brief:**

> Here is a requirement taken verbatim from the plan: `<quote>`. Here is how to check it: `<how_to_check>`. Here is the diff: `<diff command>`.
>
> Read the relevant hunks and decide exactly one verdict:
> - `implemented` — the requirement is met; cite `file:line`.
> - `partial` — some of it is there; name precisely what is missing.
> - `missing` — nothing in the diff addresses it.
> - `contradicted` — the diff does something the requirement forbids, or the opposite of it.
>
> Beware of code that exists but is never reached: a function defined and never called, a middleware written and never registered, a flag parsed and never read. That is `partial` at best. Cite the call site or say there is none.
>
> Separately, list behaviour in the diff that no requirement asked for (`out_of_scope`), with `file:line`. New logging or a rename is not out of scope; a new endpoint, a new dependency, or a changed default is.
>
> Return `{requirement_id, verdict, evidence: [{file, line, note}], missing_detail, out_of_scope: [...]}`. Under 250 words.

Batch requirements by area when there are many — one agent per 3–4 related requirements keeps the diff reads from being repeated a dozen times.

---

## Lane C — Defect hunt

Finders with **distinct lenses**. Redundant finders find the same easy bug three times; diverse finders cover ground none of them would alone. Run one agent per lens over the whole diff, weighted toward `risk_areas`.

| Lens | Looks for |
|---|---|
| **Correctness & edge cases** | off-by-one, empty/single-element input, boundary values, `0`/`""`/`null`/`NaN` treated as absent, timezone and DST arithmetic, integer division, sort stability, locale-dependent comparison |
| **Failure handling** | unhandled rejection, error thrown past a boundary that cannot catch it, retry without backoff, partial write with no rollback, resource never released, error message that leaks a secret |
| **State & async** | race between two awaits, missing `await`, shared mutable state across requests, cache never invalidated, effect that fires twice, ordering assumed between independent promises |
| **Trust & input** | user input reaching a query/command/path/HTML sink, missing authorisation check on a new route, secret or token in code or logs, redirect target from user input, size limit absent on an upload or a loop |
| **Wiring** | new code that is unreachable — not exported, not imported, not registered, behind a flag that is never set, a route not mounted, a migration not run, a config key read from the wrong place |
| **Leftovers** | `TODO`/`FIXME` added by this change, stub returning a constant, mock or fixture left in a production path, hardcoded localhost/API key/user id, `console.log`, commented-out code, dead branch |

**Brief:**

> Lens: `<lens>` — `<row from the table above>`.
>
> Read `<diff command>`, paying particular attention to `<risk_areas>`. Report only defects visible in code that this change added or modified. Pre-existing problems the diff merely touched are out of scope unless the change made them reachable.
>
> For each: `{file, line, defect (one sentence), failure_scenario, severity, suggested_fix}`.
>
> `failure_scenario` must be concrete: the input or state that triggers it, and what goes wrong. "This could cause issues" is not a finding — if you cannot write the scenario, you do not have one, so drop it. Style, naming and formatting are out of scope; a linter owns those. Return at most 8 findings, ranked. Under 400 words.

**Severity:**

| | |
|---|---|
| `blocking` | Wrong output, data loss, crash on a realistic path, security hole, or a promised requirement that does not work. |
| `major` | Fails on a plausible but narrower path; degrades badly under load or error; missing error handling on a path that will be hit. |
| `minor` | Real but small: a leftover, a redundant call, an unclear boundary that has not bitten yet. |

---

## Lane D — Behaviour proof

The lane that separates verification from code review. Reading the code proves nothing about running it.

**This lane mutates files. It runs in a disposable git worktree — never the user's working tree.** In a Workflow, that is `isolation: 'worktree'`; in the fallback tier, `git worktree add` a temp path and remove it after.

### D1 — Prove the claims (`behavior: quick` and `full`)

**Brief:**

> Claim: `<claim>`. Proof procedure: `<how_to_prove>`.
>
> Do it for real. Start the server and hit it, run the CLI with real arguments, execute the script, invoke the single test that covers it. Capture the actual command and its actual output.
>
> Return `{behavior_id, proven: true|false|blocked, command, output_excerpt, reason_if_blocked}`. `blocked` is a legitimate answer — no database, no credentials, no network — and is far better than a guess. Never report `proven: true` from reading the code.

### D2 — Red-green audit of produced tests (`behavior: full`)

A test written alongside the fix and never seen to fail proves the code compiles, not that it works.

**Brief:**

> For each test added or modified by this change: revert the source hunk it is supposed to cover (in this worktree only), run that single test, and record whether it fails.
>
> - fails → `red_green: "pass"`. The test has teeth.
> - still passes → `red_green: "never_red"`. **This is a finding**: the test does not exercise the change. Name the test and the hunk you reverted.
> - cannot isolate the hunk → `red_green: "skipped"` with the reason.
>
> Restore the worktree between tests. Return `{test_file, test_name, red_green, reverted_hunk, note}`.

`never_red` results go through the skeptics like any other finding — reverting the wrong hunk produces a false positive here, and the skeptic's job is to catch that.

---

## What comes out

Lane A → the evidence table, directly. Lanes B, C, D → candidate findings, all of which go to Phase 3 before anyone sees them.

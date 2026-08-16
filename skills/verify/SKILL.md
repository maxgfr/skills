---
name: verify
description: Prove that work just produced actually works — run the repo's real gates, check the diff against the plan it promised, hunt defects with adversarial verification, and run the thing for real. Use when an implementation, branch or PR needs checking before it is called done; when about to claim something is complete, fixed or passing; when the user says "verify", "vérifie", "check my work", "did that actually work", "do another pass", or asks for a second opinion on work you just did. Fixes the blockers in a bounded loop by default, and refuses repairs that only silence the checker (skipped tests, @ts-ignore, edited CI). Report-only mode available.
---

# verify

Turn "it looks done" into a verdict backed by evidence.

Most verification passes fail in one of two directions: they trust the implementation and miss real defects, or they generate a pile of plausible-sounding problems that waste an hour. This skill is built against both.

All paths below are relative to this skill's directory.

## Three laws

1. **No verdict without an executed command.** Every claim about the state of the code cites a command, its exit code, and a line of its output. A gate that could not run is reported as *not run*, never as passing.
2. **No finding without a refutation attempt.** Every candidate defect faces an independent skeptic whose job is to kill it. Survivors get reported; the rest are counted, not shown.
3. **No repair that only silences the checker.** Skipping a test, adding `@ts-ignore`, widening to `any`, swallowing an error, editing CI, or rewriting the plan to match the code — the loop refuses these and escalates instead. Enforced deterministically by `scripts/forbidden-repairs.mjs`, not by good intentions.

Violating the letter of a law is violating its spirit.

## Modes

| Invocation | Behaviour |
|---|---|
| `/verify` | **Default.** Verify, fix the blockers, re-verify. Bounded loop (3 iterations), then a fresh full gate run. |
| `/verify report` | Read-only. Verdict and findings, zero writes. Follow with "fix" to apply the blockers once. |
| `/verify <ref>` | Same, with an explicit fixed point (`main`, a SHA, `HEAD~3`). |
| `/verify --behavior full` | Adds the red-green audit of produced tests. Slower, catches tests that never could fail. |

## Tiers

A run costs agents, and most of them are skeptics: one per candidate finding, a
panel per blocking one. More lenses produce more candidates, which produce more
skeptics — the two multiply, which is why an unbounded run gets expensive fast.

| | Agents | Trade |
|---|---|---|
| `/verify light` | ~8 | 2 lenses, no spec lane, no behaviour proof, **one skeptic instead of a panel** |
| `/verify` | ~18 | 4 lenses, behaviour proof, panel of three on blocking claims |
| `/verify deep` | ~40 | every lens, red-green audit, panels throughout |

`light` trades away the panel: a wrong finding survives more often and a real
one dies more often. **The report names the tier** — a `PASS` at `light` is not
a `PASS` at `deep`, and must never be reported as one. Use `light` for a quick
pass on a small diff, not to gate a merge.

No tier turns the gates off, and none skips refutation. Laws 1 and 2 have no
cheap variant: a run with no executed command is `UNPROVEN` at every tier, and
a candidate nobody challenged is never reported as a finding.

Tiers, per-stage models and panel sizes: `references/config.md`.

## Phase 0 — Pin it (do this yourself, in the main context)

Cheap, and it fails fast before any agent is spent.

1. **The delta.** User-supplied ref wins. Else, in this order:
   - **No commits yet** (`git log` fails) → the delta is the whole working tree. Enumerate with `git status --porcelain`.
   - **Dirty tree** → `git diff HEAD` plus `git diff --cached`, plus commits since the merge-base.
   - **Clean tree** → `git merge-base --fork-point origin/<default> HEAD`, and diff from there.
   - **Not a git repo** → the target directory, and the report says scope is coarse.

   **Untracked files appear in no diff.** Always run `git status --porcelain` alongside the diff and pass the `??` paths to the lanes as whole-file additions — a brand-new module is invisible to `git diff` and is exactly where new defects live. Do not `git add -N` to force them into the diff: that mutates the index behind the user's back.
2. **The promise.** In order: a path the user gave → the most recently modified plan file in `~/.claude/plans/` newer than the fixed point → `docs/plans/`, `docs/superpowers/plans/`, `specs/`, `.scratch/` → an issue referenced in the commits (`gh issue view`) → none, in which case the spec lane runs on intent inferred from the diff and **the report says so**.
3. **The gates.** `node scripts/detect-gates.mjs --cwd <repo> --pretty`. Deterministic, no model. It reads lockfiles, manifests, and `.github/workflows/` — the CI is the repo's own definition of green.
4. **The config.** Tier preset ← `~/.claude/verify.json` ← `<repo>/.claude/verify.json` ← flags. Resolve it here, into concrete values — the lanes receive resolved arguments, not a config object to re-interpret. That includes `gates.extra` / `gates.skip`, which you apply to the detected list before passing it on, and the tier, which you expand into `finders`, `lanes`, `judges` and `effort` using the table in `references/config.md`. Pass the tier name through as well: the report has to state which one ran.
5. **The run directory.** `date +%Y%m%d-%H%M%S` → `<report.dir>/<timestamp>/`. Compute it now and pass it in; a fixed path means each run silently erases the last.
6. **The baseline for the fix loop.** `git stash create` (empty output means a clean tree — use `HEAD`). This dangling SHA is what the loop diffs against to prove it only made the repairs it claims. It touches no ref and no file.

Stop here if the ref does not resolve or the diff is empty. Say so; do not invent work.

## Phases 1–5 — Run the pipeline

Read `references/lanes.md` for what each lane does and the exact sub-agent briefs.

| Phase | What | Default model |
|---|---|---|
| 1 · Matrix | Turn the plan + diff into a targeted verification matrix (`references/matrix.md`) | `fable` |
| 2 · Lanes | **A** gates · **B** plan conformance · **C** defect hunt · **D** behaviour proof — in parallel, isolated | `opus` |
| 3 · Judging | Refute every candidate finding (`references/judging.md`) | `opus` |
| 4 · Verdict | Compact report up, full detail to disk | `fable` |
| 5 · Loop | Fix blockers, re-run impacted gates, repeat (`references/fix-loop.md`) | `opus` |

Fable is the scaffolding: it decides *what* gets verified and writes down *what happened*. Opus does the verifying. A cheap model in the lanes does not save anything — a wrong finding costs a fix round, a re-verification, and your attention.

**Execution tier — pick the highest one available:**

1. **Workflow** (Claude Code). Call `Workflow` with `scriptPath` pointing at `workflows/verify.mjs` and pass Phase 0's output as `args`. All the noise — test logs, file reads, finder chatter — stays inside the workflow; only the verdict comes back. This is the point of the skill: verification that does not cost you the context you were working in.
2. **Parallel sub-agents.** No Workflow tool? Dispatch the same lanes as concurrent agents and aggregate. `references/fallbacks.md`.
3. **Inline sequential.** Last resort. Same phases, same laws, and the report must say the run was inline.

## Output contract

Into the conversation, and nothing more than this:

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

Full report: .claude/verify/20260815-142233/REPORT.md
```

Three verdicts, not two:

| | |
|---|---|
| `PASS` | Every gate ran and passed, no blocking finding survived, and **something actually ran** — a gate or a proven behaviour. |
| `FAIL` | A gate failed, a blocking finding survived, or the loop stopped on a forbidden repair. |
| `UNPROVEN` | Nothing is broken and nothing was checked: no gate ran to completion and no behaviour was proven. This is not a pass. Report what would have to exist for the run to mean something. |

Rules for this block: no adjectives, no "Great!", no summary of what the code does. Findings the skeptics killed are a count, not a list. Anything unverified is named in RESIDUAL RISK — silence there is a lie. **A lane that errored is named there too**: a lane that died found nothing because it never ran, which is not the same as a clean result.

**The verdict line states the tier.** At `light` it also carries what the tier gave up, because that is the difference between "nothing is wrong" and "nothing cheap found anything":

```
VERDICT: PASS — 0 blocking   (3 candidates refuted)   tier: light
  light: 2 lenses, one skeptic per claim, no behaviour proof. Not a merge gate.
```

## Red flags

| Thought | Reality |
|---|---|
| "Tests passed last run, so they pass" | Run them now. Stale evidence is not evidence. |
| "The diff looks right" | Reading is not proving. Lane A or it did not happen. |
| "This is probably a bug" | Send it to a skeptic. Probably means unverified. |
| "One `@ts-ignore` and the gate is green" | That is the repair the loop exists to refuse. |
| "The plan was wrong, I'll update it" | Escalate. Rewriting the promise is not verification. |
| "Nothing to report, everything passed" | Then name what you could not verify. There is always something. |

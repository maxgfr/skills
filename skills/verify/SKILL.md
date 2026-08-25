---
name: verify
description: Prove that work just produced actually works, and fix what it finds — run the repo's real gates, check the diff against the plan it promised, hunt defects, and refute every candidate before reporting it. Use when an implementation, branch or PR needs checking before it is called done; when about to claim something is complete, fixed or passing; when the user says "verify", "vérifie", "check my work", "did that actually work", "do another pass", or asks for a second opinion on work you just did. Fixes the blockers in a bounded loop, and refuses repairs that only silence the checker (skipped tests, @ts-ignore, edited CI). Tiers trade cost against depth, from a gates-only pass to a full audit that also runs the thing for real. Report-only mode available.
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

## Modes and tiers

Every mode verifies, fixes the blockers in a bounded loop, then re-verifies. What
the tier buys is how much gets verified — and the cost is agents, most of them
skeptics: one per candidate finding, a panel per blocking one. More lenses
produce more candidates, which produce more skeptics, so the two multiply.

| Invocation | Agents | What it does |
|---|---|---|
| `/verify` | ~7 + 1/candidate | **Default.** Gates, plan conformance, a 3-lens defect hunt, one skeptic per claim. |
| `/verify normal` | ~9 + 1–3/candidate | + behaviour proof — runs the thing — and a panel of three on blockers |
| `/verify deep` | ~13 + 1–3/candidate | every lens, red-green audit, panels throughout |
| `/verify ultralight` | 1 | Gates only. No defect hunt, no plan check. Opt in when that is the question. |
| `/verify report` | — | Read-only, any tier. Follow with "fix" to apply the blockers once. |
| `/verify <ref>` | — | Explicit fixed point (`main`, a SHA, `HEAD~3`). |

Skeptics are spawned per candidate, so cost scales with what the finders turn up,
not with the tier alone: a default run that finds nothing costs ~7 agents, one
that surfaces nine costs ~16 even when all nine are refuted and it returns `PASS`.

**The default verifies the change**: it reads the diff for defects, checks it
against the promise, and every candidate faces a skeptic before you see it. What
it defers to `normal` is the behaviour proof — the lane that starts servers and
runs CLIs, the slowest by far — and the three-skeptic panel on blocking claims.

**`ultralight` is a gate runner, not a cheap verification.** It produces no
model-authored finding, so there is nothing to refute and nothing to be wrong
about; a green run means the commands passed and nothing more. It is not a merge
gate, it runs **every** detected gate because no planner filtered them, and if
you report its PASS, say which tier produced it.

No tier turns the gates off, and none skips refutation: laws 1 and 2 have no
cheap variant. **Every stage runs on your session's model by default.**

Presets are data: `scripts/tiers.mjs`. Prose: `references/config.md`.

## Phase 0 — Pin it (do this yourself, in the main context)

Cheap, and it fails fast before any agent is spent.

1. **The delta.** User-supplied ref wins. Else, in this order:
   - **No commits yet** (`git log` fails) → the delta is the whole working tree. Enumerate with `git status --porcelain`.
   - **Dirty tree** → `git diff HEAD` plus `git diff --cached`, plus commits since the merge-base.
   - **Clean tree** → `git merge-base --fork-point origin/<default> HEAD`, and diff from there.
   - **Not a git repo** → the target directory, and the report says scope is coarse.

   **Untracked files appear in no diff.** Always run `git status --porcelain` alongside the diff and pass the `??` paths to the lanes as whole-file additions — a brand-new module is invisible to `git diff` and is exactly where new defects live. Do not `git add -N` to force them into the diff: that mutates the index behind the user's back.
2. **The promise.** In order: a path the user gave → the active host's plan artifact (Codex: the current conversation plan; Claude Code: the most recently modified file in `~/.claude/plans/` newer than the fixed point) → `docs/plans/`, `docs/superpowers/plans/`, `specs/`, `.scratch/` → an issue referenced in the commits (`gh issue view`) → none, in which case the spec lane runs on intent inferred from the diff and **the report says so**.
3. **The gates.** `node scripts/detect-gates.mjs --cwd <repo> --pretty`. Deterministic, no model. It reads lockfiles, manifests, and `.github/workflows/` — the CI is the repo's own definition of green.
4. **The config.** `node scripts/tiers.mjs <tier>` ← user config (`$VERIFY_CONFIG`, then `$CODEX_HOME/verify.json` on Codex or `~/.claude/verify.json` on Claude Code) ← repo config (`<repo>/.agents/verify.json`, with `<repo>/.claude/verify.json` retained as the Claude-compatible legacy location) ← flags. **Run the script**; transcribing the table by hand is how a `lanes` object loses a key — which leaves that lane **on** — or gains an empty `finders` array, which runs **all six** lenses. Resolve everything into concrete values here; the lanes receive values, not policy. Apply `gates.extra` / `gates.skip` to the detected list, and pass the tier name through: the report has to state which one ran. A bare word is a tier before it is a ref (`light`, `normal`, `deep`, `ultralight`, `report`); an ambiguous branch needs `--ref light`. **If the detector found no gate, do not run `ultralight`** — it would spend zero agents and report `UNPROVEN` over nothing. Escalate to `light` and say why.
5. **The run directory.** `date +%Y%m%d-%H%M%S` → `<report.dir>/<timestamp>/`. Compute it now and pass it in; a fixed path means each run silently erases the last. Prune here too, deterministically — keep the `keep_runs` most recent directories and delete the rest. Pruning that depends on a model remembering to do it is pruning that stops happening.
6. **The baseline for the fix loop.** `git stash create` (empty output means a clean tree — use `HEAD`). This dangling SHA is what the loop diffs against to prove it only made the repairs it claims. It touches no ref and no file.

Stop here if the ref does not resolve or the diff is empty. Say so; do not invent work.

## Phases 1–5 — Run the pipeline

Read `references/lanes.md` for what each lane does and the exact sub-agent briefs.

| Phase | What | Runs at |
|---|---|---|
| 1 · Matrix | Turn the plan + diff into a targeted verification matrix (`references/matrix.md`) | `normal`+ |
| 2 · Lanes | **A** gates — always · **B** plan conformance · **C** defect hunt · **D** behaviour proof — in parallel, isolated | per tier |
| 3 · Judging | Refute every candidate finding (`references/judging.md`) | when there are candidates |
| 4 · Verdict | Compact report up, full detail to disk | when there is detail |
| 5 · Loop | Fix blockers, re-run impacted gates, repeat (`references/fix-loop.md`) | when something is broken |

**Every stage inherits your session's model**; pinning is opt-in, and pinning the
finders or judges *down* is the false economy — a wrong finding costs a fix
round, a re-verification and your attention. With lanes B, C and D all off,
Phase 1 is skipped entirely: the gates come straight from the detector and there
is nothing for a planner to aim.

**Host tier — pick the highest one available:**

1. **Workflow** (when the host exposes it, including Claude Code). Call `Workflow` with `scriptPath` pointing at `workflows/verify.mjs` and pass Phase 0's output as `args`. All the noise — test logs, file reads, finder chatter — stays inside the workflow; only the verdict comes back.
2. **Parallel subagents** (Codex and other agent-capable hosts). Dispatch the same lanes with the host's native subagent capability and aggregate. `references/fallbacks.md`.
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

Full report: .agents/verify/20260815-142233/REPORT.md
```

Three verdicts, not two:

| | |
|---|---|
| `PASS` | Every gate ran and passed, no blocking finding survived, and **something actually ran** — a gate or a proven behaviour. |
| `FAIL` | A gate failed, a blocking finding survived, or the loop stopped on a forbidden repair. |
| `UNPROVEN` | Nothing is broken and nothing was checked: no gate ran to completion and no behaviour was proven. This is not a pass. Report what would have to exist for the run to mean something. |

Rules for this block: no adjectives, no "Great!", no summary of what the code does. Findings the skeptics killed are a count, not a list. Anything unverified is named in RESIDUAL RISK — silence there is a lie. **A lane that errored is named there too**: a lane that died found nothing because it never ran, which is not the same as a clean result.

**The verdict line states the tier, and below `deep` a second line states what
that tier did not do** — the only thing between a gates-only PASS and a reader
who takes it for a full verification. Word it from `residual_risk` in the return
value:

```
VERDICT: PASS — 0 blocking   (3 candidates refuted)   tier: light
  light: no behaviour proof — nothing was run to prove it works — and one
  skeptic per claim rather than a panel.
```

**When `report_path` comes back `null`**, nothing survived and no lane died, so
no agent was spent transcribing an empty run. Write the short version yourself in
the run directory — verdict, tier, gate table, `residual_risk`. Never print a
path to a file nobody wrote.

## Red flags

| Thought | Reality |
|---|---|
| "Tests passed last run, so they pass" | Run them now. Stale evidence is not evidence. |
| "The diff looks right" | Reading is not proving. Lane A or it did not happen. |
| "This is probably a bug" | Send it to a skeptic. Probably means unverified. |
| "One `@ts-ignore` and the gate is green" | That is the repair the loop exists to refuse. |
| "The plan was wrong, I'll update it" | Escalate. Rewriting the promise is not verification. |
| "Nothing to report, everything passed" | Then name what you could not verify. There is always something. |

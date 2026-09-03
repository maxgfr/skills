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

Syntax: Codex uses `$verify`; the Claude plugin uses `/maxgfr:verify`; a
standalone Claude skill uses `/verify`. The table shows the arguments.

Every mode verifies, fixes the blockers in a bounded loop, then re-verifies. What
the tier buys is how much gets verified — and the cost is agents, most of them
skeptics: one per candidate finding, a panel per blocking one. More lenses
produce more candidates, which produce more skeptics, so the two multiply.

| Invocation | Agents | What it does |
|---|---|---|
| no arguments | ~7 + 1/candidate | **`light` by default.** Gates, plan conformance, a 3-lens defect hunt, one skeptic per claim. |
| `normal` | ~9 + 1–3/candidate | + behaviour proof — runs the thing — and a panel of three on blockers |
| `deep` | ~13 + 1–3/candidate | every lens, red-green audit, panels throughout |
| `ultralight` | 1 | Gates only. No defect hunt, no plan check. Opt in when that is the question. |
| `report` | — | Read-only, any tier. Follow with "fix" to apply the blockers once. |
| `crosscheck` | +1 + 1/candidate | + lane E — a second opinion from the *other* CLI agent, on any tier. |
| `<ref>` | — | Explicit fixed point (`main`, a SHA, `HEAD~3`). |

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

   The host's own plan artifact ranks above `docs/plans/`, so name a `blueprint` plan on the `verify` invocation rather than leaving it to discovery — otherwise a stale plan-mode scratch file from the same session can win. If you find a `docs/plans/` file carrying `status: approved` frontmatter and the user named no path, say which promise you picked before spending an agent on it.
3. **The gates.** `node scripts/detect-gates.mjs --cwd <repo> --pretty`. Deterministic, no model. It reads lockfiles, manifests, and `.github/workflows/` — the CI is the repo's own definition of green.
4. **The config.** Run `node scripts/resolve-config.mjs --cwd <repo> --host <host> -- <invocation arguments>`. It deterministically merges the tier preset, `$VERIFY_CONFIG`, the active host's user config, legacy then portable repo config, and flags into concrete values. Pass its `tier`, `mode`, `ref`, and `config` through unchanged. A tier-like branch needs `--ref light`; `crosscheck` is a modifier, never a tier or ref. If the detector found no gate, do not run `ultralight` — escalate to `light` and say why.
5. **The run directory.** `date +%Y%m%d-%H%M%S` → `<report.dir>/<timestamp>/`. Compute it now and pass it in; a fixed path means each run silently erases the last. Prune here too, deterministically — keep the `keep_runs` most recent directories and delete the rest. Pruning that depends on a model remembering to do it is pruning that stops happening.
6. **The baseline for the fix loop.** `git stash create` (empty output means a clean tree — use `HEAD`). This dangling SHA is what the loop diffs against to prove it only made the repairs it claims. It touches no ref and no file.
7. **The host — only when lane E is on.** Pass `host: "claude"` or `host: "codex"`, whichever you are running inside. The peer is the *other* one, so a wrong value asks a CLI to consult itself and a missing one makes the lane guess. **Do not infer it from what is installed**: `CODEX_HOME`, `~/.claude` and `command -v codex` say what exists on the machine, not what is executing. You know which host you are. If you genuinely cannot tell, leave it unset — the lane then reports the crosscheck as not done, which is the honest outcome.

Stop here if the ref does not resolve or the diff is empty. Say so; do not invent work.

## Phases 1–5 — Run the pipeline

Read `references/lanes.md` for what each lane does and the exact sub-agent briefs.

| Phase | What | Runs at |
|---|---|---|
| 1 · Matrix | Turn the plan + diff into a targeted verification matrix (`references/matrix.md`) | `normal`+ |
| 2 · Lanes | **A** gates — always · **B** plan conformance · **C** defect hunt · **D** behaviour proof · **E** peer crosscheck | per tier |
| 3 · Judging | Refute every candidate finding (`references/judging.md`) | when there are candidates |
| 4 · Verdict | Compact report up, full detail to disk | when there is detail |
| 5 · Loop | Fix blockers, re-run impacted gates, repeat (`references/fix-loop.md`) | when something is broken |

**Lane E is opt-in and off in every tier** (`lanes.peer`, set by
`verify crosscheck`): a second opinion on the diff from the *other* CLI agent,
read-only. Its findings are candidates like any other and face the same
skeptics. Brief, schema and rules: `references/crosscheck.md`.

**A crosscheck that did not happen is named in `RESIDUAL RISK`, never omitted** —
in the report file as well as in the conversation. An unreachable peer costs
nothing and changes no verdict, but a run that never reached it must not read as
one the peer signed off on.

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

Into the conversation, and nothing more than this: a verdict line, an EVIDENCE
table (one row per gate — command, exit code, first failing line), the
surviving findings ranked by severity with a concrete failure scenario each, a
REQUIREMENTS count line, RESIDUAL RISK, and the report path. A complete
example, with the second line the cheap tiers add, is in
`references/report.md`.

Three verdicts, not two:

| | |
|---|---|
| `PASS` | Every gate ran and passed, no blocking finding survived, and **something actually ran** — a gate or a proven behaviour. |
| `FAIL` | A gate failed, a blocking finding survived, or the loop stopped on a forbidden repair. |
| `UNPROVEN` | Nothing is broken and nothing was checked: no gate ran to completion and no behaviour was proven. This is not a pass. Report what would have to exist for the run to mean something. |

Rules for this block: no adjectives, no "Great!", no summary of what the code does. Findings the skeptics killed are a count, not a list. Anything unverified is named in RESIDUAL RISK — silence there is a lie. **A lane that errored is named there too**: a lane that died found nothing because it never ran, which is not the same as a clean result.

**The verdict line states the tier, and below `deep` a second line states what
that tier did not do**, worded from `residual_risk` in the return value — the
only thing between a gates-only PASS and a reader who takes it for a full
verification.

**When `report_path` comes back `null`**, nothing survived and no lane died, so
no agent was spent transcribing an empty run. Write the short version yourself in
the run directory — verdict, tier, gate table, `residual_risk`. Never print a
path to a file nobody wrote.

The red-flags table — the thoughts that turn a verification into a reassurance —
is at the end of `references/report.md`. "Tests passed last run", "the diff
looks right", "the peer was down but I reviewed it myself": each has a one-line
answer there, and each is a reason to stop and run the command instead.

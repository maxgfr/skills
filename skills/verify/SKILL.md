---
name: verify
description: Use when the user explicitly invokes verify to check completed work, including "check my work", "verify", or "vérifie"; run repository gates or an explicit richer verification tier with evidence-backed results. Never select it implicitly.
disable-model-invocation: true
---

# verify

Turn "it looks done" into a verdict backed by executed evidence. All paths below
are relative to this skill's directory.

## Three laws

1. **No verdict without an executed command.** Cite the command, exit code, and a line of output. A gate that could not run is *not run*, never passing.
2. **No finding without a refutation attempt.** Every model-authored candidate faces an independent skeptic. Survivors are reported; the rest are counted.
3. **No repair that only silences the checker.** The richer tiers refuse skipped or weakened tests, suppressions, widened types, swallowed errors, edited CI, and rewritten plans. `scripts/forbidden-repairs.mjs` enforces this.

## Modes and tiers

Syntax: Codex uses `$verify`; the Claude plugin uses `/maxgfr:verify`; a
standalone Claude skill uses `/verify`.

| Invocation | Agents | What it does |
|---|---|---|
| no arguments / `ultralight` | at most 1 | **Default.** Run every detected gate once; no analysis or repair. |
| `light` | ~7 + 1/candidate | Gates, plan conformance, 3-lens defect hunt, one skeptic per claim, repair loop. |
| `normal` | ~9 + 1–3/candidate | `light` plus behaviour proof and panels on blockers. |
| `deep` | ~13 + 1–3/candidate | Every lens, red-green audit, panels throughout. |
| `report` | — | Read-only, any tier. Follow with "fix" to apply blockers once. |
| `crosscheck` | +1 + 1/candidate | Add a second opinion from the other CLI agent. |
| `<ref>` | — | Explicit fixed point (`main`, a SHA, `HEAD~3`). |

The default answers only whether the repository's commands pass now. It does
not read the diff, check a plan, hunt defects, prove behaviour, or repair a
failure. Use `verify light` when the change itself needs analysis and repair.
Presets and full configuration: `references/config.md`.

## Phase 0 — Resolve, then route

Do this in the main context before spending an agent.

1. **Config first.** Run `node scripts/resolve-config.mjs --cwd <repo> --host <host> -- <arguments>`. Pass its `tier`, `mode`, `ref`, and `config` unchanged. A tier-like branch needs `--ref light`; `crosscheck` is a modifier.
2. **Gates.** Run `node scripts/detect-gates.mjs --cwd <repo> --pretty`.
3. **Run directory.** Create `<report.dir>/<YYYYMMDD-HHMMSS>/` and prune oldest runs beyond `keep_runs`.

The **short route** applies when the resolved config has only gates enabled and
the loop disabled: `spec: false`, `defects: false`, `behavior: "off"`,
`peer: false`, `loop.enabled: false`.

- Run the gates lane once, at low effort. With no detected gate, spend no agent and return `UNPROVEN`; never escalate tiers.
- Skip delta, promise, ref, baseline, matrix, judging, reporter, and fix-loop work. A blocking gate that fails, times out, or cannot run returns `FAIL` after that pass. Report a non-blocking gate failure without sinking the verdict.
- Write the compact report from the returned structured gate evidence in the main context. This keeps the report path real without spending a reporter agent.

Any explicit richer tier, enabled analysis lane, peer crosscheck, or enabled
loop takes the full route below.

## Full-route pinning

1. **Delta.** User ref wins. Otherwise: no commits → whole working tree; dirty tree → `git diff HEAD`, cached diff, and commits since merge-base; clean tree → diff from `git merge-base --fork-point origin/<default> HEAD`; non-git → target directory. Always include `??` paths from `git status --porcelain` as whole-file additions; never mutate the index with `git add -N`.
2. **Promise.** User path → active host plan artifact → `docs/plans/`, `docs/superpowers/plans/`, `specs/`, `.scratch/` → referenced issue → inferred intent, named as such. An approved `docs/plans/` file is announced before agent work.
3. **Baseline, only when repair is enabled.** `git stash create`; empty output means use `HEAD`. It touches no ref or file.
4. **Host, only for peer crosscheck.** Pass the executing host, `claude` or `codex`; do not infer it from installed commands.

Stop if an explicit ref does not resolve or the full-route diff is empty.

## Full pipeline

Read `references/lanes.md` for lane briefs.

| Phase | What | Detail |
|---|---|---|
| 1 · Matrix | Aim analysis at the plan and diff | `references/matrix.md` |
| 2 · Lanes | Gates, conformance, defects, behaviour, optional peer | per resolved config |
| 3 · Judging | Refute candidate findings | `references/judging.md` |
| 4 · Verdict | Compact response and durable report | `references/report.md` |
| 5 · Loop | Repair, guard, and recheck | `references/fix-loop.md` |

Lane E is opt-in through `crosscheck`; its findings face the same skeptics. Read
`references/crosscheck.md` for its brief and schema. An unavailable requested
peer is named in `RESIDUAL RISK`.

Every stage inherits the session model unless config pins it. Prefer the highest
host capability available:

1. **Workflow.** Call `Workflow` with `workflows/verify.mjs` and resolved Phase 0 data.
2. **Parallel subagents.** Follow `references/fallbacks.md` and its deterministic schedule.
3. **Inline.** Run the same enabled phases sequentially and report `execution: inline`.

## Output contract

Return only: verdict and tier; for every tier below `deep`, a second line naming
what was not checked; EVIDENCE rows with command, exit code, and first failing
line; surviving findings with failure scenarios; REQUIREMENTS counts when the
spec lane ran; RESIDUAL RISK; and a real report path. Examples and red flags:
`references/report.md`.

| Verdict | Meaning |
|---|---|
| `PASS` | Every blocking gate passed, no blocking finding survived, and a gate or behaviour proof completed. Non-blocking failures remain visible evidence. |
| `FAIL` | A blocking gate failed, timed out, or could not run; a blocking finding survived; or an enabled loop stopped. |
| `UNPROVEN` | No gate completed and no behaviour was proven. This is not a pass. |

Anything unverified or errored is named in `RESIDUAL RISK`. Findings killed by
skeptics are a count, not a list. When `report_path` is `null`, write the short
report yourself in the run directory before printing its path.

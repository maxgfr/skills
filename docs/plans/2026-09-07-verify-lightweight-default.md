---
status: approved
crosscheck: not-requested
fixed_point: 8c95e65550f5b1883822eb0862783d24115c51bd (clean tree before this plan)
---

# Lightweight default for verify — implementation plan

## Goal

Invoking `verify` with no tier runs a single gates-only pass with at most one low-effort agent, never enters a repair loop, and clearly labels the limited meaning of its verdict; the existing `light`, `normal`, and `deep` tiers remain available explicitly.

## Locked constraints

| Source | Constraint | Consequence for the plan |
|---|---|---|
| Q-001 | The default pipeline must generate far fewer tokens. | Make `ultralight` the preset selected when no tier is supplied and avoid planner, finder, skeptic, reporter, and fixer agents on that path. |
| Q-002 | Keep all existing tiers. | Preserve explicit `ultralight`, `light`, `normal`, and `deep` names and their existing lane depth. |
| Q-003 | The default must not loop. | Set `loop.enabled: false` in the `ultralight` preset; a red gate returns `FAIL` once. |
| Q-004 | Simplify the rest of the default path. | Resolve the tier before expensive pinning, skip diff/promise/baseline discovery for the effective gates-only configuration, and return `UNPROVEN` instead of escalating when no gate exists. |

## Non-goals

- Do not remove or rename tiers, flags, config files, crosscheck mode, or report mode.
- Do not add a new deterministic gate runner; reuse the existing bounded gates agent.
- Do not change the analysis, judging, or repair behavior of explicitly selected richer tiers.
- Do not make a gates-only `PASS` claim that the diff or plan was reviewed.

## Grounded facts

- `skills/verify/scripts/tiers.mjs:33` — `DEFAULT_TIER` is currently `light`.
- `skills/verify/scripts/tiers.mjs:49` — `ultralight` already disables spec, defect, behavior, and peer lanes but does not carry loop policy.
- `skills/verify/scripts/resolve-config.mjs:18` — the base config enables the repair loop for every tier unless a later layer overrides it.
- `skills/verify/workflows/verify.mjs:345` — gates-only already synthesizes its matrix without a planner.
- `skills/verify/workflows/verify.mjs:939` — a report agent is still used when a gates-only run has reportable failure detail.
- `skills/verify/SKILL.md:63` — Phase 0 currently discovers the delta and promise before resolving the tier.
- `skills/verify/SKILL.md:86` — a gates-only run with no detected gate currently escalates to `light`.
- `tests/verify-workflow.test.mjs:510` — current tests require `ultralight` to repair a red gate.

## Chosen approach

Use the existing `ultralight` lanes as the lightweight default and make its one-shot policy explicit in tier data. Route effective gates-only configurations through a short Phase 0 that resolves config, detects gates, runs the gates lane once, and emits a short report from returned structured data. This is smaller than introducing another runner while removing the multiplicative planner/finder/judge/fix costs that motivated the change.

## Rejected approaches

- Add a dependency-free native gate runner — it could eliminate the final gates agent, but duplicates timeout/output/report behavior and is more machinery than requested.
- Delete or rename `light` — breaks configs and established invocations without reducing the default cost further.
- Escalate automatically on failure or missing gates — reintroduces hidden token use and repair loops on the default path.

## Execution order

`S-001 → S-002`

## Steps

### S-001 — Make ultralight a one-shot default

- **Files:** Modify `skills/verify/scripts/tiers.mjs` · Modify `skills/verify/scripts/resolve-config.mjs` · Modify `skills/verify/scripts/fallback-plan.mjs` · Modify `skills/verify/workflows/verify.mjs` · Test `tests/tiers.test.mjs` · Test `tests/verify-config.test.mjs` · Test `tests/verify-workflow.test.mjs` · Test `tests/fallback-plan.test.mjs`
- **Interfaces:**
  - Consumes: existing tier names, resolver precedence, workflow result schema, and fallback phase schema.
  - Produces: `DEFAULT_TIER === "ultralight"`; every resolved tier includes a fresh `loop` object; the default resolves with `loop.enabled === false`.
- **Implements:** `Q-001`, `Q-002`, `Q-003`
- **Depends on:** none
- **Change:** Add explicit loop policy to every tier, copy it from `resolveTier`, select `ultralight` by default, keep richer tiers looping, and make gates-only workflow failures skip reporter/fixer/recheck agents while returning enough structured evidence for the main context to write the short report. Lock the fallback schedule to one gates job with matrix, judging, and fix-loop disabled by default.
- **Preserve:** Explicit config and invocation flags retain precedence; `light`, `normal`, and `deep` retain their current lanes, panels, and repair loops; non-blocking gates do not sink the verdict; explicit config may re-enable the ultralight loop.
- **Done when:** A default resolved run is gates-only and one-shot; green, red, timeout, missing-command, and no-gate workflow cases invoke no agent besides gates; explicit richer tiers retain their current configurations.
- **Verify:** `node --test tests/tiers.test.mjs tests/verify-config.test.mjs tests/verify-workflow.test.mjs tests/fallback-plan.test.mjs` → exit 0 with all tests passing

### S-002 — Shorten and document the lightweight route

- **Files:** Modify `skills/verify/SKILL.md` · Modify `skills/verify/references/config.md` · Modify `skills/verify/references/fallbacks.md` · Modify `skills/verify/references/fix-loop.md` · Modify `skills/verify/references/report.md` · Modify `README.md`
- **Interfaces:**
  - Consumes: the resolved tier/loop behavior from S-001.
  - Produces: a default-route contract that distinguishes gates-only evidence from richer verification and points users to `verify light` for analysis and repair.
- **Implements:** `Q-001`, `Q-002`, `Q-003`, `Q-004`
- **Depends on:** S-001
- **Change:** Rewrite the entrypoint so config resolution precedes advanced pinning; the effective gates-only route skips diff, promise, baseline, matrix, judging, reporter, and fix-loop work, reports `UNPROVEN` without escalation when no gate exists, and stops after one pass on failure. Update cost tables, examples, reports, fallback instructions, and loop documentation consistently.
- **Preserve:** `SKILL.md` remains at or below the repository's 150-line router budget; every retained reference remains linked; the description keeps English and French verification triggers; explicit richer tiers still route to the full pipeline.
- **Done when:** No always-loaded or referenced documentation describes `light` as the package default, promises automatic repair for the default, or tells gates-only runs to escalate automatically.
- **Verify:** `npm run validate && node --test tests/tiers.test.mjs tests/verify-config.test.mjs tests/verify-workflow.test.mjs tests/fallback-plan.test.mjs` → exit 0

## Verification matrix

| Constraint | Step | Proof | Expected |
|---|---|---|---|
| Q-001 | S-001 | default workflow call trace tests | exactly one `gates` agent call on green and red paths |
| Q-002 | S-001 | tier ordering and lane tests | all four tier names resolve and richer lanes are unchanged |
| Q-003 | S-001 | resolver and workflow tests | default loop disabled; no fixer, guard, regate, or final-gates calls |
| Q-004 | S-002 | validation plus documentation search | router is within budget and no stale default/escalation claim remains |

## Risks and fallbacks

| Risk | Trigger | Response | Owning step |
|---|---|---|---|
| Gates-only PASS is read as a full review | Output omits the disabled lanes | Keep the tier and residual-risk line mandatory in short reports. | S-002 |
| Config merge accidentally disables richer loops | `light` resolves with `loop.enabled: false` | Define loop policy explicitly on all tier presets and test each tier. | S-001 |
| Failed default invokes a reporter or fixer | Workflow trace contains any call after `gates` | Key the report/fix branches on the effective gates-only and loop configuration, then assert the complete call list. | S-001 |
| Stop guard repeatedly requests verify | No short report directory/file is written | Preserve the existing main-context short-report contract and report directory. | S-002 |

## Unresolved decisions

None.

## Approval

- Status: approved
- Approved after crosscheck: not requested

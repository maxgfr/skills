# Configuration

Resolution order, each layer overriding the one before:

1. The tier's preset (below)
2. `$VERIFY_CONFIG`, when set explicitly
3. The host user config: `$CODEX_HOME/verify.json` on Codex, or `~/.claude/verify.json` on Claude Code
4. `<repo>/.agents/verify.json` — portable repo rules; `<repo>/.claude/verify.json` remains a supported Claude-compatible legacy location
5. Flags on the invocation

## Tiers

A run's cost is agents, and the agents are mostly skeptics: every candidate
finding gets one, and a blocking claim gets a panel. More finder lenses means
more candidates means more skeptics, so the two multiply.

**The presets live in `scripts/tiers.mjs`, not in this table.** Phase 0 runs
`node scripts/resolve-config.mjs --cwd <repo> --host <host> -- <arguments>`;
that engine loads the preset and deep-merges every file and flag in the order
above. The table below describes its preset input; the resolver is what runs.

| | `ultralight` (default) | `light` | `normal` | `deep` |
|---|---|---|---|---|
| `lanes.gates` | `true` | `true` | `true` | `true` |
| `lanes.spec` | `false` | `true` | `true` | `true` |
| `lanes.defects` | `false` | `true` | `true` | `true` |
| `lanes.behavior` | `"off"` | `"off"` | `"quick"` | `"full"` |
| lenses actually run | 0 | 3 | 4 | 6 |
| `judges.panel_blocking` | — | 1 | 3 | 3 |
| Agents before skeptics | 1 | **~7** | ~9 | ~13 |
| Plus, per candidate found | 0 | 1 | 1 (3 if blocking) | 1 (3 if blocking) |

The default is one gates agent at most. Explicit analysis tiers spawn skeptics
per candidate, so their cost scales with what the finders turn up: a `light` run
that finds nothing costs ~7 agents, and one that surfaces nine candidates costs
~16 even when all nine are refuted and the verdict is `PASS`.

To make analysis and repair the shared default explicitly:

```json
{ "tier": "light" }
```

### `ultralight` — gates only, the default

It resolves configuration, detects the repo's real gates, runs them once, and
stops. It produces no model-authored finding, so there is nothing to refute and
law 2 holds by construction. It does not read the diff or promise, build a
matrix, judge findings, invoke a reporter, or enter the repair loop.

Three consequences:

- **It is not a merge gate.** A green run means the commands passed, not that the
  change is correct or matches its plan. Use `verify light` for that analysis.
- **It minimises agents, not wall-clock.** No planner filters detected gates to
  the diff, so it runs every gate, including e2e and commands lifted from CI.
- **No gate means `UNPROVEN`.** It spends no agent and does not escalate to a
  richer tier. A blocking gate that fails, times out, or cannot run returns
  `FAIL` after the one pass and is not repaired. A non-blocking failure stays in
  the evidence without sinking the verdict.

### `light` — explicit analysis and repair

It verifies the change: reads the diff for defects across three lenses, checks it
against the promise, and puts every candidate in front of a skeptic before you
see it. What it defers is the **behaviour proof** — the lane that starts servers
and runs CLIs, and the slowest by far — and the **three-skeptic panel** on
blocking claims. One skeptic instead of three means a wrong finding survives more
often and a real one dies more often; the report names the tier, so a `PASS` at
`light` is never read as a `PASS` at `deep`.

The spec lane carries its own data guard: with no promise to check against, the
matrix produces no requirements and the lane costs nothing. You do not have to
turn it off when there is no plan.

**No tier turns the gates off, and none skips refutation.** Laws 1 and 2 have no
cheap variant: a run with no executed command reports `UNPROVEN` at every tier,
and both panel settings floor at 1.

The presets are a starting point, not a straitjacket:

```
verify light --lanes gates,defects --lenses wiring,leftovers
```

## Defaults

The resolved no-argument preset is:

```json
{
  "tier": "ultralight",
  "models": {
    "planner":  "inherit",
    "reporter": "inherit",
    "gates":    "inherit",
    "spec":     "inherit",
    "finders":  "inherit",
    "judges":   "inherit",
    "fixer":    "inherit"
  },
  "effort": { "gates": "low", "planner": "low", "finders": "medium", "judges": "medium" },
  "lanes":  { "gates": true, "spec": false, "defects": false, "behavior": "off", "peer": false },
  "judges": { "panel": 1, "panel_blocking": 1 },
  "loop":   { "enabled": false, "max_iterations": 3, "fix_severity": "blocking" },
  "gates":  { "extra": [], "skip": [] },
  "finders": ["correctness"],
  "report": { "dir": ".agents/verify", "keep_runs": 10 }
}
```

Explicit `light` enables spec and defects with the three lenses `correctness`,
`failure-handling`, and `wiring`; `normal` adds `leftovers`; `deep` adds
`state-async` and `trust-input`.

Every tier carries a **non-empty** `finders` array, `ultralight` included, even
though its `lanes.defects` is `false`: an empty array does not mean zero lenses,
it makes the workflow fall back to all six. Only `lanes.defects` turns the lane
off. `scripts/tiers.mjs` holds that invariant and a test enforces it.

## Judges

```json
{ "judges": { "panel": 1, "panel_blocking": 3 } }
```

`panel` is how many skeptics an ordinary candidate faces; `panel_blocking`
applies to blocking ones. A finding survives only when at least
`ceil(requested panel / 2)` skeptics keep it. An agent that died cannot lower
that threshold and accidentally preserve a claim.

Both floor at 1. There is no setting that skips refutation altogether — law 2
is not configurable, and a candidate nobody challenged is not a finding.

## Models

**By default every stage runs on the same model: the one your session is already
running.** No stage is pinned, nothing is spawned on a bigger model than the work
you were doing when you asked. That is the predictable option, and it is the one
you get if you never touch this key.

Pin a stage by naming a model. It applies to that stage and nothing else:

```json
{ "models": { "planner": "fable", "reporter": "fable" } }
```

That particular pair is the **scaffolding split**, and it is the pin worth
knowing. The planner says *what* gets verified and the reporter writes down
*what happened*; both read metadata and transcribe structure, and neither decides
whether anything is broken. Moving them to a cheap model costs nothing.

The inverse — pinning `finders` or `judges` *down* — is the one to avoid. A wrong
finding costs a fix round, a re-verification and your attention, so the cheap
stage becomes the expensive one. If you want more there, pin *up*:

```json
{ "models": { "finders": "opus", "judges": "opus" } }
```

`inherit` is the explicit spelling of the default. Per-stage effort maps to the
agent's reasoning effort where the host supports it (`low` · `medium` · `high` ·
`xhigh` · `max`).

The forbidden-repairs guard runs at `effort: "low"` and is the one stage you
cannot tune — it transcribes a script's JSON output and has no judgement to make.

On hosts without model selection, model names are ignored and every stage runs on
whatever the host provides. Nothing else changes.

## Lanes

| Key | Values | Note |
|---|---|---|
| `gates` | `true` / `false` | Turning this off removes the only source of hard evidence. The report will say the verdict is unproven. |
| `spec` | `true` / `false` | Off when there is no plan to check against and you do not want inferred-intent output. |
| `defects` | `true` / `false` | |
| `behavior` | `"off"` / `"quick"` / `"full"` | `quick` runs the claims; `full` adds the red-green audit of produced tests. |

## Gates

```json
{ "gates": { "extra": ["pnpm run test:contract"], "skip": ["lint", "format"] } }
```

`skip` matches a gate's `kind` or its `id` from `detect-gates.mjs`. `extra` commands run last and are blocking. Skipping a gate is recorded in the report — a skipped gate is never silently a passing gate.

## Loop

```json
{ "loop": { "enabled": false } }
```

disables repair while retaining whichever evidence lanes are enabled.
`fix_severity` accepts `blocking` (default), `major` (fixes blocking and major),
or `all`.

`ultralight` sets `enabled: false`; `light`, `normal`, and `deep` set it to
`true`. An explicit config may override either policy. Enabling the loop on an
otherwise gates-only configuration selects the full route, including baseline,
reporting, guard, and recheck work.

`max_iterations` above 5 is usually a sign the change should be re-planned rather than re-fixed.

## Flags

Flags win over every file.

```
verify                         # one-shot ultralight — every detected gate, no analysis
verify light                   # gates, plan, 3-lens defect hunt, repair loop
verify normal                  # + behaviour proof and panels on blockers
verify deep                    # every lens, red-green audit
verify ultralight              # gates only, no defect hunt
verify report                  # read-only
verify main                    # explicit fixed point
verify --behavior full         # add the red-green audit
verify --panel 3               # judges.panel_blocking
verify --finders sonnet        # one stage's model (models.finders)
verify --model fable           # pin EVERY stage, overriding the config files
verify --max-iterations 5
verify --skip lint,e2e
verify --lanes gates,defects   # only these
verify --lenses wiring,leftovers   # which defect finders run (the `finders` array)
```

`--finders` sets a **model** (`models.finders`); `--lenses` sets **which lenses run** (the top-level `finders` array). Two different keys, deliberately different flags.

**A tier name is resolved before a git ref.** `verify light` is a tier, not the
branch `light`. Pass an ambiguous ref explicitly with `--ref light`.

## What verify never does

It never commits, never pushes, and never opens a PR. A run ends with a dirty working tree and a report; what to do with that is yours. There is no config key to change this — a verification tool that can also commit is a tool that can bury what it did.

## Output on disk

`.agents/verify/<YYYYMMDD-HHMMSS>/`

The `<YYYYMMDD-HHMMSS>` segment is computed in Phase 0 and passed in, so consecutive runs never overwrite each other.

| File | Contents |
|---|---|
| `REPORT.md` | The full report: every gate's output, surviving findings with full reasoning, requirements table, residual risk |
| `findings.json` | Every candidate, survivors and refuted alike, with each skeptic's verdict and reasoning |
| `matrix.json` | The verification matrix the run was built from |
| `gates.json` | Raw output of `detect-gates.mjs` |

**The one-shot gates-only route never invokes a reporter.** Its workflow result
returns `report_path: null` for green, red, timeout, missing-command, and no-gate
outcomes; the main context writes the short `REPORT.md` from structured gate
evidence and residual risk. Richer runs also skip the reporter when no finding
survived and no lane died. The four-file set above is for richer reportable
detail.

Add `.agents/verify/` to `.gitignore`. Runs beyond `keep_runs` are pruned
oldest-first, in Phase 0, deterministically — pruning does not depend on a model
remembering to do it.

The point of writing all of this down: a later session reads the file instead of re-deriving the whole run, and you can audit a skeptic that killed something it should not have.

# Configuration

Resolution order, each layer overriding the one before:

1. The tier's preset (below)
2. `~/.claude/verify.json` — your preferences, every repo
3. `<repo>/.claude/verify.json` — this repo's rules, committed with it
4. Flags on the invocation

## Tiers

A run's cost is agents, and the agents are mostly skeptics: every candidate
finding gets one, and a blocking claim gets a panel. More finder lenses means
more candidates means more skeptics, so the two multiply.

Phase 0 resolves the tier name into the concrete values below, then applies the
config files and flags on top. Anything you set explicitly wins over the tier.

| | `light` | `normal` (default) | `deep` |
|---|---|---|---|
| `finders` (lenses) | 2 | 4 | 6 |
| `lanes.spec` | `false` | `true` | `true` |
| `lanes.behavior` | `"off"` | `"quick"` | `"full"` |
| `judges.panel_blocking` | 1 | 3 | 3 |
| `effort.finders` / `.judges` | `medium` | `high` | `high` |
| Agents on a mid-size diff | ~8 | ~18 | ~40 |

```json
{ "tier": "light" }
```

**`light` gives up the panel.** One skeptic instead of three on a blocking
claim means a wrong finding survives more often, and a real one dies more
often. That is the trade, and the report names the tier so a `PASS` at `light`
is never read as a `PASS` at `deep`. Use it for a quick pass on a small diff;
do not gate a merge on it.

**`light` never turns the gates off.** Law 1 does not have a cheap variant — a
run with no executed command reports `UNPROVEN`, whatever the tier.

The tier presets are a starting point, not a straitjacket. `light` plus the one
lane you actually care about is usually the right cheap run:

```
/verify light --lanes gates,defects --lenses wiring,leftovers
```

## Defaults

## Defaults

Shown at `normal`.

```json
{
  "tier": "normal",
  "models": {
    "planner":  "fable",
    "reporter": "fable",
    "gates":    "opus",
    "spec":     "opus",
    "finders":  "opus",
    "judges":   "opus",
    "fixer":    "opus"
  },
  "effort": { "gates": "low", "planner": "low", "finders": "high", "judges": "high" },
  "lanes":  { "gates": true, "spec": true, "defects": true, "behavior": "quick" },
  "judges": { "panel": 1, "panel_blocking": 3 },
  "loop":   { "enabled": true, "max_iterations": 3, "fix_severity": "blocking" },
  "gates":  { "extra": [], "skip": [] },
  "finders": ["correctness", "failure-handling", "wiring", "leftovers"],
  "report": { "dir": ".claude/verify", "keep_runs": 10 }
}
```

The full lens set — `deep` — adds `state-async` and `trust-input`.

## Judges

```json
{ "judges": { "panel": 1, "panel_blocking": 3 } }
```

`panel` is how many skeptics an ordinary candidate faces; `panel_blocking`
applies to blocking ones. A finding survives on a majority of the skeptics that
returned, so an agent that died never counts as a vote to keep it.

Both floor at 1. There is no setting that skips refutation altogether — law 2
is not configurable, and a candidate nobody challenged is not a finding.

## Models

The split follows what each stage actually is.

**Fable is the scaffolding.** It says *what* gets verified and writes down *what happened* — the matrix in Phase 1 and the report in Phase 4. Both read metadata and transcribe structure; neither decides whether anything is broken. That is the whole of the cheap tier.

**Opus does the verifying.** Running the gates and reading their output, judging the plan clause by clause, hunting defects, refuting them, repairing them. A cheap model here does not save money — it produces findings that are wrong in both directions, and every wrong finding costs a fix round, a re-verification, and your attention. The expensive stage is the one you have to redo.

`inherit` uses the session's model instead of a named one; use it if you would rather verify with whatever you are already running:

```json
{ "models": { "finders": "inherit", "judges": "inherit" } }
```

Per-stage effort maps to the agent's reasoning effort where the host supports it (`low` · `medium` · `high` · `xhigh` · `max`).

On hosts without model selection, model names are ignored and every stage runs on whatever the host provides. Nothing else changes.

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

is `/verify report` as a permanent setting. `fix_severity` accepts `blocking` (default), `major` (fixes blocking and major), or `all`.

`max_iterations` above 5 is usually a sign the change should be re-planned rather than re-fixed.

## Flags

Flags win over every file.

```
/verify                         # loop mode, normal tier
/verify light                   # the cheap tier — see Tiers
/verify deep                    # every lens, full behaviour proof
/verify report                  # read-only
/verify main                    # explicit fixed point
/verify --behavior full         # add the red-green audit
/verify --panel 1               # judges.panel_blocking
/verify --finders sonnet        # one stage's model (models.finders)
/verify --model inherit         # every stage not explicitly pinned in config
/verify --max-iterations 5
/verify --skip lint,e2e
/verify --lanes gates,defects   # only these
/verify --lenses wiring,leftovers   # which defect finders run (the `finders` array)
```

`--finders` sets a **model** (`models.finders`); `--lenses` sets **which lenses run** (the top-level `finders` array). Two different keys, deliberately different flags.

## What verify never does

It never commits, never pushes, and never opens a PR. A run ends with a dirty working tree and a report; what to do with that is yours. There is no config key to change this — a verification tool that can also commit is a tool that can bury what it did.

## Output on disk

`.claude/verify/<YYYYMMDD-HHMMSS>/`

The `<YYYYMMDD-HHMMSS>` segment is computed in Phase 0 and passed in, so consecutive runs never overwrite each other.

| File | Contents |
|---|---|
| `REPORT.md` | The full report: every gate's output, surviving findings with full reasoning, requirements table, residual risk |
| `findings.json` | Every candidate, survivors and refuted alike, with each skeptic's verdict and reasoning |
| `matrix.json` | The verification matrix the run was built from |
| `gates.json` | Raw output of `detect-gates.mjs` |

Add `.claude/verify/` to `.gitignore`. Runs beyond `keep_runs` are pruned oldest-first.

The point of writing all of this down: a later session reads the file instead of re-deriving the whole run, and you can audit a skeptic that killed something it should not have.

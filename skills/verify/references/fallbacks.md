# Host tiers

How much of the machinery the host can run. Distinct from the **cost tiers**
(`ultralight` · `light` · `normal` · `deep`), which decide how much verification
you asked for; these decide where it executes. The laws are the same at every
one. What changes is how much of the noise reaches your context.

## Tier 1 — Workflow (Claude Code)

```
Workflow({
  scriptPath: "<skill dir>/workflows/verify.mjs",
  args: {
    mode,        // "loop" | "report"
    tier,        // the cost tier name — the report has to state which one ran
    cwd,         // repo root
    diffCmd,     // the pinned delta command
    untracked,   // ?? paths from git status --porcelain — they are in no diff
    planPath,    // the promise; planText optional, the matrix agent will read the file
    gates,       // detect-gates output VERBATIM — the object, not its .gates array
    config,      // fully resolved: models, effort, lanes, judges, loop, finders
    reportDir,   // <report.dir>/<YYYYMMDD-HHMMSS>, computed in Phase 0
    baseline,    // git stash create output, for the forbidden-repairs guard
    skillDir,    // so the workflow can invoke this skill's scripts
    host         // "claude" | "codex" — required by lane E, omit when it is off
  }
})
```

`gates` is the detector's whole output object. The workflow reads `gates.gates`
itself; handing it the bare array, or a wrapper of your own, makes the gates lane
silently find nothing and the run returns a verdict over zero executed commands.

The return value carries `report_path`, which is **`null`** when nothing survived
and no lane died — the workflow spends no agent transcribing an empty run. Write
the short report yourself in that case, and never print a path to a file nobody
wrote. `residual_risk` on the same object names the lanes that never ran.

Everything the lanes need must be **resolved** before it goes in. The workflow is not the config resolver for its own inputs — it receives values, not policy.

The script owns the pipeline: matrix → lanes → judging → report → loop. Every agent's output stays inside the workflow; what returns is the verdict object. Test logs, file reads and finder chatter never enter the session.

Invoking `verify` is itself the explicit opt-in the Workflow tool requires — a skill whose instructions say to call it.

If the workflow fails mid-run, it returns a `runId`. Resume with `Workflow({scriptPath, resumeFromRunId})`: unchanged agent calls replay from cache, and only the failed step onward runs live.

## Tier 2 — Parallel subagents (including Codex)

No Workflow tool, but a native subagent tool exists (for example Codex's
subagent capability). Run `node scripts/fallback-plan.mjs --cwd <repo> --host
<host> --pretty -- <verify arguments>` first. Its JSON is the authoritative
phase and lane schedule; execute it without reconstructing policy by hand:

1. **Matrix** — one agent, cheap model, returns the matrix JSON. Parse it yourself.
2. **Lanes** — dispatch in one message so they run concurrently: one gate-runner, one agent per requirement group, one per finder lens, one per behavior claim, and — **only when `lanes.peer` is true** — one for the peer crosscheck. Collect the structured returns.

   Lane E matters most on this tier, because this is the tier Codex runs on: there the peer is `claude -p`, and `--host codex`. Getting that argument backwards asks Codex to consult itself. The lane's brief is in [`lanes.md`](lanes.md) and the engine is `scripts/peer-run.mjs`, which you invoke through Bash exactly as the Workflow tier does — it is a plain Node script and needs no host feature at all.
3. **Dedup** — deterministically merge candidates with the same `file:line` before dispatching skeptics.
4. **Judging** — one message dispatching every skeptic at once. Three for each blocking claim.
5. **Report** — assemble and write the file yourself.
6. **Loop** — fix agents grouped by file, then run `forbidden-repairs.mjs` yourself via Bash, then re-run the impacted gates.

The cost: candidate findings pass through your context on their way to the skeptics. Keep the sub-agent returns structured and short — the briefs already cap them — and never paste a full test log into your own reasoning.

## Tier 3 — Inline

No sub-agents at all. Run the phases yourself, sequentially, and hold the line on the discipline that the isolation was providing:

- Run every gate to completion before writing a word about it.
- Write each candidate finding down **before** trying to refute it, then argue against it explicitly, in writing. Skipping the refutation because you are the one who found it is the exact failure the skeptics exist to prevent.
- Cap yourself: 8 findings, 400 words per lane. Verbosity here is what eats the context.
- The report must say `execution: inline` — a reader deserves to know the findings had a single perspective.

## Hosts without Workflow

The skill installs everywhere `npx skills add` reaches. Two things degrade:

- **Model selection** — ignored, harmlessly.
- **Worktree isolation** — if the host cannot create a git worktree for lane D, run `behavior: quick` only and set `behavior: full` aside. Never run the red-green audit in the user's working tree.

**A worktree needs a commit to branch from.** In a repository with no commits yet, worktree creation fails and lane D produces nothing. Detect this in Phase 0 (`git log` fails) and either skip lane D with that reason recorded, or run its read-only half without isolation. What you must not do is let the lane die quietly: a lane that errored is reported by name under RESIDUAL RISK, because "found nothing" and "never ran" look identical in an empty results list and mean opposite things.

- **The peer crosscheck** — lane E needs the *other* CLI installed and authenticated, which is the one dependency in this skill that is not Node. When it is missing, `peer-run.mjs` says so and the lane contributes nothing; the run is still valid and `RESIDUAL RISK` records that it was not crosschecked.

Everything else — the gates, the briefs, the refutation protocol, the forbidden-repairs guard — is host-independent. The three `.mjs` scripts need Node and nothing else.

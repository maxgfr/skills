# Phase 1 — The verification matrix

A generic verification pass asks generic questions and gets generic answers. The matrix is the step that makes the rest of the run *about this change*: it turns the plan and the diff into a specific list of things to prove, before anything expensive runs.

It is cheap on purpose. The planner reads metadata — the plan text, `git diff --stat`, the file list, the detected gates — not the code. Default model `fable`.

## Input to the planner

- The promise: the plan / spec / issue text, verbatim. If there is none, say so explicitly in the prompt — the planner must then infer intent from commit messages and the diffstat, and mark `promise_source: "inferred"`.
- `git diff --stat <fixed-point>...HEAD` plus the list of changed files with added/removed counts.
- The output of `scripts/detect-gates.mjs`.
- The lanes enabled by config.

## Output schema

```json
{
  "promise_source": "plan | issue | inferred",
  "gates": [
    { "id": "typecheck", "cmd": "pnpm run typecheck", "why": "diff touches 9 .ts files",
      "blocking": true, "timeout_s": 300 }
  ],
  "requirements": [
    { "id": "R1", "quote": "rate-limit the /login endpoint to 5/min",
      "files_expected": ["src/api/login.ts", "src/middleware/"], "how_to_check": "a limiter is wired into the login route, not merely defined" }
  ],
  "behaviors": [
    { "id": "B1", "claim": "expired tokens are rejected with 401",
      "how_to_prove": "start the server, POST /session with a token minted 2h ago, expect 401" }
  ],
  "risk_areas": [
    { "path": "src/auth/session.ts", "why": "largest hunk, touches token expiry arithmetic" }
  ]
}
```

## Rules for a good matrix

**Requirements come from the promise, one per verifiable clause.** A plan bullet that says "add a limiter and document it" is two requirements. Quote the promise verbatim in `quote` — the spec lane cites that quote in its finding, and a paraphrase lets a missing requirement slip through as "close enough".

**Behaviors are things you can run, not things you can read.** "The parser handles nested arrays" is not a behavior; "`node dist/cli.mjs parse fixtures/nested.json` prints the flattened keys" is. If a claim has no runnable proof, it is not a behavior — it belongs in `risk_areas`, and the report will list it as residual risk. Aim for 2–5; more than that and lane D becomes the bottleneck.

**Risk areas steer the finders, they do not limit them.** Pick where a defect would be most costly or most likely: the biggest hunk, arithmetic on time or money, anything touching auth, concurrency, migrations, or a public interface. The finders read the whole diff regardless.

**Gates are the detected ones, filtered.** Drop a gate the diff cannot possibly affect (no Python touched → no `pytest`), keep everything else. Add a gate the detector missed only if you can name the command. Never invent a script name — if you are unsure it exists, leave it out and note it.

## Failure handling

If the planner returns an empty `requirements` list while a plan exists, that is a planner failure, not a clean bill of health — re-run once with the plan text emphasised. If it comes back empty again, run the spec lane in "inferred" mode and say so in the report.

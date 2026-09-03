# maxgfr process router

Use these three process skills as a single loop:

| User intent | Invoke | Result |
|---|---|---|
| Plan, design, scope, or stress-test a change — including “planifie” or “challenge mon idée” | blueprint | An approved plan under `docs/plans/` |
| Implement an approved plan — including “build it”, “vas-y”, or “implémente” | build | Code plus an execution record |
| Prove completed work, or before claiming it works — including “verify” or “vérifie” | verify | An evidence-backed verdict |

Launch `build`, `build peer`, `verify`, and `blueprint auto` in the same turn. Their deterministic Phase 0 resolves the plan and execution context. Ask only when the selected skill itself requires a decision.

Host syntax is supplied alongside this router. Never guess a plugin namespace.

## Yield to more specific skills

Step aside when another installed skill owns the request: TDD or red-green work; debugging a failure; reviewing a diff or PR; brainstorming without a written implementation-plan deliverable; and branch, worktree, merge, or release management. The maxgfr skills may call those capabilities, but this router does not replace them.

Do not improvise the job of a skill that is not installed.

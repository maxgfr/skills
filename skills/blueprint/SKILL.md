---
name: blueprint
description: 'Plan a code change and get one approval before any code is written. Use when in plan mode or when the user asks for a plan.'
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# blueprint

Plan the change; never implement it. Argument: none, or a plan `<path>` to revise.

1. Read the code the change touches, its tests and how the repo runs them.
2. Decide what the repo, its conventions or a sensible default settle, and write each choice into the plan as an assumption: the approval is where the user corrects it. Ask only what you cannot reasonably guess and whose wrong answer would change the design: usually nothing, at most three questions, in one round, each with your recommendation, using the host's question tool. In plan mode these are the mode's own questions, never a second round.
3. Write the plan from `references/artifact.md`: in the file plan mode provides, else at `${TMPDIR:-/tmp}/plans/<repo>/<YYYY-MM-DD>-<slug>.md`, with `<repo>` the repository's directory name. Use `docs/plans/` only when the user asks to keep the plan.
4. Get one approval: leaving plan mode, or a yes. Write nothing else before it. Then, in the same turn, invoke the build skill on that path.

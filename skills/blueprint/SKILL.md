---
name: blueprint
description: 'Plan a code change before writing it — settle open decisions with the user, cite the repo, write an approved plan file (outside the repository unless the user asks to keep it). Use when the user describes a feature or change that spans several files or leaves a decision open: invoke it first, before writing any code or test and before any other skill that does, even if they ask for it to be built right away. Also in plan mode, or when the user asks for a plan. Not for a one-file fix.'
license: MIT
metadata:
  opencode/autoinvoke: 'true'
---

# blueprint

Write a plan a `small`-tier model can implement step by step without this conversation; never implement it. Argument: none, or a plan `<path>` to revise.

1. Read enough of the repo to never ask what it answers.
2. Grill the user on any open decision that could change behavior, scope, an interface or the data (`references/grill.md`).
3. Cite every repo fact as `path:line`, or state it as an assumption.
4. Write the plan from `references/artifact.md`.
5. Get one approval. In a plan mode, write the plan where the mode allows; leaving it is the approval. Otherwise write `${TMPDIR:-/tmp}/plans/<repo>/<YYYY-MM-DD>-<slug>.md`, with `<repo>` the repository's directory name, and ask in one sentence. Write nothing else before the yes.

Then, in the same turn:

1. Save the plan with `status: approved` at `${TMPDIR:-/tmp}/plans/<repo>/<YYYY-MM-DD>-<slug>.md`. Only when the user asks to keep the plan in the repository, save it as `docs/plans/<YYYY-MM-DD>-<slug>.md` instead; never commit a plan they did not ask to keep.
2. Run each Verify once (`2>&1 | tail -5`) unless it writes. It must pass, or fail only for the missing change; else fix that line and say so.
3. Invoke the build skill on that path.

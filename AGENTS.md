# Working in this repo

Every file under `skills/` is read by a model deciding what to do next, on any host (Claude Code, Codex, OpenCode…). Each word is paid for at every invocation.

```
skills/<name>/
├─ SKILL.md          # what to do, in a few plain sentences
├─ references/*.md   # what gets pasted or followed, loaded only when needed
├─ scripts/*.mjs     # deterministic engines, zero dependencies, tested
└─ workflows/*.mjs   # orchestration for hosts with a Workflow tool
```

## Rules

- **Short and natural.** A `SKILL.md` fails validation past 50 lines. Write plain sentences for a capable model: no "why" for humans, no repetition, no per-host invocation syntax.
- **The description is the trigger.** Say when to use the skill, in the words a user would type. `npm run validate` rejects a description with no trigger clause.
- **Every reference is linked from `SKILL.md`.** An orphan is never opened. Validated.
- **Determinism goes in a script.** Anything with a right answer (which plan, which waves, a forbidden diff, the gates) is a tested `.mjs` on Node's standard library.
- **Briefs are verbatim.** A subagent brief lives once in `workflows/build.mjs` and is copied as-is into `references/dispatch.md`; a test fails on drift.
- **Tiers, never model names.** Skills say `small`, `medium` or `large`; `scripts/models.mjs` reads the names from `models.json`. A model name under `skills/` fails validation.
- **Small output.** Subagents return compact JSON with capped fields; a skill prints a few lines, never a report file.

## Before opening a PR

Run `npm run check`. The commit message is the release: see [CONTRIBUTING.md](./CONTRIBUTING.md#changing-behaviour).

A guard rule that changes needs a test in both directions: what it refuses and what it lets through. Refusing an honest repair stops the build, which costs more than missing a cheat.

Validation proves a file is well-formed, not that the skill works. Before shipping a behavior change, run it on a repo where you know the answer, including a case that should fail.

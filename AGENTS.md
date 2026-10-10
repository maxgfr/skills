# Working in this repo

Every file under `skills/` is read by a model deciding what to do next, on any host (Claude Code, Codex, OpenCode…). Each word is paid for at every invocation.

```
skills/<name>/
├─ SKILL.md            # what to do, in a few plain sentences
├─ references/*.md     # what gets pasted or followed, loaded only when needed
└─ agents/openai.yaml  # Codex interface
```

## Rules

- **Markdown only.** A skill is instructions for a capable model, with nothing to install or run. `npm run validate` fails on any other file under `skills/`.
- **Short and natural.** A `SKILL.md` fails validation past 50 lines. Write plain sentences: no "why" for humans, no repetition, no per-host invocation syntax.
- **The description is the trigger.** Say when to use the skill, in the words a user would type. `npm run validate` rejects a description with no trigger clause.
- **Every reference is linked from `SKILL.md`.** An orphan is never opened. Validated.
- **Each skill stands alone.** It can be installed by itself, so it never points into another skill's files.
- **Never a model name.** Subagents run on the session's model. A model name under `skills/` fails validation.
- **Small output.** Subagents return compact JSON; a skill prints a few lines, never a report file.

## Before opening a PR

Run `npm run check`. The commit message is the release: see [CONTRIBUTING.md](./CONTRIBUTING.md#changing-behaviour).

Validation proves a file is well-formed, not that the skill works. Before shipping a behavior change, run it on a repo where you know the answer, including a case that should fail.

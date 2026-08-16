# Working in this repo

This repo contains agent skills. The audience for every file under `skills/` is a model deciding what to do next — not a human browsing documentation.

## Layout

```
skills/<name>/
├─ SKILL.md          # the router: what, when, and the laws. Short.
├─ references/*.md   # the detail, loaded only when the phase needs it
├─ scripts/*.mjs     # deterministic engines — zero dependencies, tested
└─ workflows/*.mjs   # orchestration for hosts that have a Workflow tool
```

## Rules

**`SKILL.md` is a router, not a manual.** If it grows past ~150 lines, the excess belongs in `references/`. A model reads the whole SKILL.md every time it triggers; it reads a reference only when it needs that phase.

**The description is the trigger.** It decides whether the skill fires at all. Say *when to use this*, in the words a user would actually type — including the ones they type in French. `npm run validate` rejects a description with no trigger clause.

**Every reference must be linked from `SKILL.md`.** An orphan reference is one the agent never opens. Validated.

**Determinism goes in a script, not a prompt.** Anything with a right answer — detecting commands, scanning a diff for forbidden patterns, comparing versions — is a `.mjs` with tests. A model asked to be a linter will be a linter that sometimes hallucinates. The rule of thumb: if you can write a test for it, it is not a prompt.

**Scripts stay dependency-free.** Node's standard library only. These run on someone else's machine, inside someone else's agent, without an install step.

**Instructions are imperative and concrete.** "Report the first failing lines, at most 15" beats "summarise the failure appropriately". Where a sub-agent brief exists, write it verbatim in the reference so it can be pasted, not paraphrased.

**Say what the skill will not do.** A skill that lists its refusals is one you can trust with a loop.

## Before opening a PR

```bash
npm run check
```

Name the commit for the bump you want: `fix:` for a patch, `feat:` for a minor, a `BREAKING CHANGE:` footer for a major. semantic-release reads the history on `main`, versions both manifests and tags — see [CONTRIBUTING.md](./CONTRIBUTING.md#changing-behaviour).

**A guard rule that changed needs a test for both directions.** Every false positive fixed in `forbidden-repairs.mjs` came from a rule that was only ever tested on the cheat it was written for. A rule that refuses something must also have a test proving what it lets through — the guard reverts hunks and stops the loop, so refusing an honest repair costs more than missing a dishonest one.

## Testing a skill for real

Validation proves the file is well-formed, not that the skill works. Before shipping a behaviour change, run it against a repo where you know the answer — including a case it should *fail*. A skill that has only ever been seen passing has never been tested.

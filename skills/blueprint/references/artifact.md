# The plan file

`docs/plans/<YYYY-MM-DD>-<slug>.md`. A revision overwrites the same file.

## Skeleton

```markdown
---
status: awaiting-approval
fixed_point: <commit SHA, plus "dirty" if the tree was>
---

# <Subject>

## Goal

<One observable outcome: what is true afterwards that is not true now.>

## Locked constraints

- Q-001 — <the answer> → <what the plan must therefore do>

## Grounded facts

- `path/file.ts:42` — <the fact a step relies on>

## Non-goals

- <What this deliberately does not do.>

## Steps

### S-001 — <imperative title>

- **Files:** Create `exact/new.ts` · Modify `exact/old.ts:120-145` · Test `tests/old.test.ts`
- **Depends on:** none
- **Interfaces:** Produces `take(key: string): boolean`   (only when another step uses it)
- **Change:** <exactly what to write, naming every symbol>
- **Preserve:** <the behavior or signature that must not move>
- **Verify:** `<exact command>` → <exact expected result>
```

`build` reads `status`, the `S-xxx` headers, `Files`, `Depends on` and the `Verify` command.
The order comes from `Depends on`. Steps that share no file and no dependency run in parallel.

## Writing steps for a small implementer

The implementer is a small model that reads one step and nothing else.

- **Exact paths and symbols.** `src/limit/bucket.ts`, `export function take(key: string): boolean`. Never "the limiter module".
- **No open choice.** Pick the name, the type, the error message, the library. "Add appropriate handling" is a choice left open.
- **One step = one diff a reviewer reads at a glance.** Fold setup into the step that needs it. Split only where a reviewer could reject one half and accept the other.
- **Self-contained.** Never "same as S-003": repeat it. A symbol a step consumes is produced by an earlier step it depends on.
- **Verify is a command with a binary result.** Prefer the repo's own test command aimed at one file (`npm test -- tests/x.test.ts`) over a runner invoked by hand. For a bug fix, the command runs a test that fails before the change: name its file, its input and the expected output.

## Before showing it

- Every `Q-xxx` maps to a step or a non-goal.
- No "TBD", "TODO", "handle edge cases", "write tests", "similar to".
- A name is spelled the same in every step.
- Read it as someone who never saw this conversation. Anything only the chat knows goes in the file.

`S-xxx` never changes once written. An inserted step takes the next free number.

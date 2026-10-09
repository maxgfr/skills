# The plan file

```markdown
---
status: awaiting-approval
---

# <Subject>

## Goal
<The observable outcome.>

## Locked constraints
- Q-001 — <answer> → <what the plan must do>

## Grounded facts
- `path/file.ts:42` — <fact a step relies on>

## Non-goals
- <What this does not do.>

## Steps

### S-001 — <imperative title>
- **Files:** Create `a.ts` · Modify `b.ts:120-145` · Test `tests/b.test.ts`
- **Depends on:** none
- **Change:** <exactly what to write, every symbol named>
- **Preserve:** <what must not move>
- **Verify:** `<command>` → <expected result>
```

A small model reads each step alone:

1. Exact paths and symbols; no choice left open.
2. Never "same as S-003". A symbol a step uses comes from a step it depends on. Steps sharing no file and no dependency run in parallel, so make a step depend on another whenever a half-done edit of one breaks the other's Verify (two steps compiled into one crate or package).
3. One step, one diff a reviewer judges at a glance.
4. Verify is one command with a binary result, ideally the repo's test command on one file; for a bug fix, a test that fails first. Its exit code is the result: wrap a count in `test "$(…)" = N` (`grep -c` exits 1 when it counts zero), and make a test-name filter match every test the step names.
5. UI work and security-sensitive work each get steps of their own: build gives them a larger tier than the rest.

Every `Q-xxx` maps to a step or a non-goal. `S-xxx` numbers never change.

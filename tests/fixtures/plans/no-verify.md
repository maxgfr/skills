---
status: approved
---

# No verify — implementation plan

## Goal

A goal.

## Execution order

`S-001 → S-002`

## Steps

### S-001 — First

- **Files:** Create `src/a.ts`
- **Depends on:** none
- **Done when:** it exists.
- **Verify:** `test -f src/a.ts` → exit 0

### S-002 — Second, with no command

- **Files:** Create `src/b.ts`
- **Depends on:** `S-001`
- **Done when:** it works well.

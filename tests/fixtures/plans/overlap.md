---
status: approved
---

# Overlap — implementation plan

## Goal

Four independent steps, two of which touch the same file and one of which names no file.

## Execution order

`S-001 → S-002 → S-003 → S-004`

## Steps

### S-001 — Touch the router

- **Files:** Modify `src/router.ts:10-20`
- **Depends on:** none
- **Done when:** done.
- **Verify:** `npm test` → passes

### S-002 — Touch the router elsewhere

- **Files:** Modify `src/router.ts:80-90` · Create `src/extra.ts`
- **Depends on:** none
- **Done when:** done.
- **Verify:** `npm test` → passes

### S-003 — Touch something unrelated

- **Files:** Create `src/other.ts`
- **Depends on:** none
- **Done when:** done.
- **Verify:** `npm test` → passes

### S-004 — Names no file at all

- **Depends on:** none
- **Done when:** done.
- **Verify:** `npm test` → passes

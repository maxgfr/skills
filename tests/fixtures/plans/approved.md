---
status: approved
crosscheck: not-requested
fixed_point: abc1234
---

# Rate limiter — implementation plan

## Goal

Requests past 100 per minute per key get a 429 with a Retry-After header.

## Locked constraints

| Source | Constraint | Consequence for the plan |
|---|---|---|
| Q-001 | 100 requests / minute / API key | the limiter keys on the API key |

## Non-goals

- Distributed counting.

## Grounded facts

- `src/api/router.ts:12` — every route is registered through `route()`.

## Chosen approach

A token bucket in memory, applied as middleware.

## Rejected approaches

- Redis-backed counter — no Redis in this deployment.

## Execution order

`S-001 → S-002 → S-003`

## Steps

### S-001 — Add the token bucket

- **Files:** Create `src/limit/bucket.ts` · Test `tests/limit/bucket.test.ts`
- **Interfaces:**
  - Consumes: nothing
  - Produces: `take(key: string): boolean`
- **Implements:** `Q-001`
- **Depends on:** none
- **Change:** A `Bucket` class holding per-key counts, refilled every 60 s.
- **Preserve:** nothing existing is touched.
- **Done when:** `take()` returns false on the 101st call within a minute.
- **Verify:** `npx vitest run tests/limit/bucket.test.ts` → 3 passed

### S-002 — Wire the middleware

- **Files:** Create `src/limit/middleware.ts` · Modify `src/api/router.ts:12-30`
- **Interfaces:**
  - Consumes: `take(key)` from S-001
  - Produces: `limit()` middleware
- **Implements:** `Q-001`
- **Depends on:** `S-001`
- **Change:** Register `limit()` before every route in `route()`.
- **Preserve:** route registration order.
- **Done when:** the 101st request in a minute gets 429 with Retry-After.
- **Verify:** `npx vitest run tests/api/limit.test.ts` → 2 passed

### S-003 — Document the limit

- **Files:** Modify `README.md:40-48`
- **Interfaces:**
  - Consumes: nothing
  - Produces: nothing
- **Implements:** `Q-001`
- **Depends on:** `S-001`
- **Change:** A "Rate limits" section stating 100/min/key.
- **Preserve:** the rest of the README.
- **Done when:** the section exists.
- **Verify:** `grep -q "Rate limits" README.md` → exit 0

## Verification matrix

| Constraint | Step | Proof | Expected |
|---|---|---|---|
| Q-001 | S-002 | `npx vitest run tests/api/limit.test.ts` | 2 passed |

## Risks and fallbacks

| Risk | Trigger | Response | Owning step |
|---|---|---|---|

## Unresolved decisions

None.

## Approval

- Status: approved
- Approved after crosscheck: not requested

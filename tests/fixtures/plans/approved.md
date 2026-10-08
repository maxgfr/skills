---
status: approved
fixed_point: abc1234
---

# Rate limiter — implementation plan

## Goal

Requests past 100 per minute per key get a 429 with a Retry-After header.

## Locked constraints

- Q-001 — 100 requests / minute / API key → the limiter keys on the API key.

## Grounded facts

- `src/api/router.ts:12` — every route is registered through `route()`.

## Non-goals

- Distributed counting.

## Steps

### S-001 — Add the token bucket

- **Files:** Create `src/limit/bucket.ts` · Test `tests/limit/bucket.test.ts`
- **Depends on:** none
- **Interfaces:** Produces `take(key: string): boolean`
- **Change:** A `Bucket` class holding per-key counts, refilled every 60 s.
- **Preserve:** nothing existing is touched.
- **Verify:** `npx vitest run tests/limit/bucket.test.ts` → 3 passed

### S-002 — Wire the middleware

- **Files:** Create `src/limit/middleware.ts` · Modify `src/api/router.ts:12-30`
- **Depends on:** `S-001`
- **Interfaces:** Consumes `take(key)` from S-001 · Produces `limit()` middleware
- **Change:** Register `limit()` before every route in `route()`; the 101st request in a minute gets 429 with Retry-After.
- **Preserve:** route registration order.
- **Verify:** `npx vitest run tests/api/limit.test.ts` → 2 passed

### S-003 — Document the limit

- **Files:** Modify `README.md:40-48`
- **Depends on:** `S-001`
- **Change:** A "Rate limits" section stating 100/min/key.
- **Preserve:** the rest of the README.
- **Verify:** `grep -q "Rate limits" README.md` → exit 0

# The artifact

The plan is the promise. Everything that matters has to survive in this file,
because the agent that implements it will not have been in the conversation —
that is the point, and it is what makes clearing the context safe.

**Path:** `docs/plans/<YYYY-MM-DD>-<slug>.md`. `verify` already searches
`docs/plans/`, so a plan written here is found with no configuration. Revisions
overwrite the same file; there is no `-v2-final`.

Write it for an engineer who is a strong developer, knows this codebase not at
all, and will read one step without reading its neighbours.

## Skeleton

```markdown
---
status: awaiting-approval | approved
crosscheck: not-requested | paired | unavailable
fixed_point: <commit SHA + dirty-tree note, or "greenfield">
---

# <Subject> — implementation plan

## Goal

<One observable outcome. Not "improve X" — what is true afterwards that is not true now.>

## Locked constraints

| Source | Constraint | Consequence for the plan |
|---|---|---|
| Q-001 | <the user's answer, or the recommendation they delegated> | <what the plan must therefore do> |

## Non-goals

- <What this deliberately does not do, so a reviewer stops asking for it.>

## Grounded facts

- `path/file.ts:42` — <the fact this plan depends on>
- <A file that does not exist yet is named as new, never cited.>

## Chosen approach

<The approach, and the reason it beats the alternatives.>

## Rejected approaches

<Non-normative. Never executed; kept so the next reader does not re-propose them.>

- <Alternative> — <the concrete reason it lost>

## Execution order

`S-001 → S-002 → S-004 → S-003`

## Steps

### S-001 — <imperative title>

- **Files:** Create `exact/path.ts` · Modify `exact/other.ts:120-145` · Test `tests/path.test.ts`
- **Interfaces:**
  - Consumes: <exact signatures this needs from earlier steps>
  - Produces: <exact names and types later steps rely on>
- **Implements:** `Q-001`, `Q-004`
- **Depends on:** none
- **Change:** <the specific work, concrete enough to act on>
- **Preserve:** <the behaviour or interface that must not move>
- **Done when:** <a binary criterion — true or false, not "works well">
- **Verify:** `<exact command>` → <the exact expected result>

## Verification matrix

| Constraint | Step | Proof | Expected |
|---|---|---|---|
| Q-004 | S-001 | `<command>` | <observable result> |

## Risks and fallbacks

| Risk | Trigger | Response | Owning step |
|---|---|---|---|

## Unresolved decisions

None.

## Approval

- Status: <awaiting-approval | approved>
- Approved after crosscheck: <yes | no | not requested>
```

## Step IDs

`S-xxx` is immutable. An inserted step takes the next unused number and the
execution order changes — renumbering breaks every `Depends on`, every citation
in the crosscheck appendix, and every reference in a review that is already
written.

## Sizing a step

A step is the smallest unit worth a fresh reviewer's gate. Fold setup, config
and scaffolding into the step whose deliverable needs them; split only where a
reviewer could reject one step while approving its neighbour.

## What makes a plan unbuildable

Scan for these before presenting it. Each one has cost someone a wasted
implementation round:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling", "add validation", "handle edge cases"
- "Write tests for the above", with no test named and no behaviour stated
- "Similar to S-003" — repeat it; steps are read out of order
- A type, function or file referenced by one step and defined by none
- A "Verify" line that is not a command, or whose expected result is "it works"

## Self-review

Three passes, inline, before the plan is shown. Fix what you find; do not
re-review.

1. **Constraint coverage** — every `Q-xxx` maps to at least one step, or to an
   explicit non-goal.
2. **Placeholder scan** — the list above.
3. **Name consistency** — `clearLayers()` in S-003 and `clearFullLayers()` in
   S-007 is a bug, and it is invisible unless you look for it.

## Self-containment

Before offering to clear the context, read the plan as if you had never seen the
conversation. If a step depends on something only the conversation knows — an
agreed name, a rejected idea, a constraint that was mentioned but never written
down — it is not in the plan yet. Put it in.

# The grill

Interview until nothing is silently assumed. The engine is a **design tree**:
every decision branches into the decisions that hang off it.

## The frontier

The **frontier** is every decision whose prerequisites are already settled — the
questions you can ask *now* without guessing at answers you have not heard yet.
Ask the whole frontier in one round, then wait.

A question whose answer depends on another question still open in this round
belongs to a *later* round, not this one. Answers reshape the tree: settled
decisions push the frontier outward and unblock what depended on them. Recompute
and ask again.

## The form of a round

Number questions globally — `Q-001`, `Q-002` — and never renumber them. Every
question carries a recommended answer, which is what lets a whole round be
answered in one line ("Q-001 yes, Q-002 your call, Q-003 B").

```
❓ **Q-001 — <short title>**: <the decision, and the options>

➡️ <your recommended answer, and the one reason it is the best default>

---

❓ **Q-002 — <short title>**: <the decision, and the options>

➡️ <your recommended answer, and the one reason it is the best default>
```

Highest-consequence question first.

## Facts are yours, decisions are theirs

**Finding facts is your job, never the user's.** When a frontier question needs a
fact from the repository or the environment, go get it — read the file, dispatch
a sub-agent. Do not block on it: a running exploration is an unsettled
prerequisite, so only the questions downstream of it wait; ask the rest of the
frontier now.

Never ask the user something the repository answers. A round of questions you
could have answered by reading spends their attention to save your own.

## Answers become constraints

After each round, write every answer into the artifact's locked-constraints
table with its source and its consequence, then cite the supporting facts as
`path:line`. Implementation steps name the `Q-xxx` they implement.

- **"Your call"** is delegation: lock your recommendation and mark it delegated.
- **"I don't know"** becomes a question with a decision criterion and a bounded
  probe — never an assumption you make on their behalf.
- A later design choice that contradicts a locked answer goes back to the user.
  You do not rewrite their constraint to fit your design.

## Stopping

**The grill ends when the frontier is empty**: every branch visited, nothing left
silently assumed. That is a structural condition, not a judgement about whether
you have asked enough.

Then summarise the locked constraints and confirm shared understanding before
designing anything.

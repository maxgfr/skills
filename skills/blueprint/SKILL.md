---
name: blueprint
description: Interrogate the user until nothing is silently assumed, ground the design in the actual repository, then write an approved implementation plan whose every step carries a stable ID, an exact command and a binary completion criterion — optionally challenged by the other CLI agent first. Use when the user asks to plan, design or scope a change before coding, wants their thinking stress-tested, or says "plan this", "grill me", "write the implementation plan", "challenge my idea", "planifie ça", "cuisine-moi", "challenge mon idée", "écris le plan d'implémentation". Do not use merely because the host entered plan mode or exposed a planning tool — the deliverable has to be the written plan. Once the code exists, use verify instead.
---

# blueprint

A plan fails for one of two reasons: it answered a question the user never
agreed to, or it asserted something about the repository that is not true. This
skill is built against both.

All paths below are relative to this skill's directory.

## Three laws

1. **No design while the frontier is open.** Every unsettled decision that could
   change observable behaviour is put to the user before an approach is proposed.
   The grill stops on a structural condition, not on feeling thorough.
2. **No repository claim without `path:line`.** A fact you cannot cite is an
   assumption, and it gets written down as one or asked about — never asserted.
3. **The artifact is the promise.** What `verify` reads later is the file, not
   this conversation. Anything that lives only in the chat is lost.

Violating the letter of a law is violating its spirit.

## Invocations

| | |
|---|---|
| `/blueprint` | **Default.** Orient → grill → ground → design → write → approve. |
| `/blueprint grill` | The interview only. Stops at the locked constraints; designs nothing. |
| `/blueprint crosscheck` | + one read-only consultation of the other CLI agent before approval. |
| `/blueprint <path>` | Harden an existing plan instead of writing a new one. |

## Phase 1 — Orient and classify

Read the request, the `AGENTS.md` / `CLAUDE.md` that govern the files in play,
and the smallest useful slice of the repository. This is reconnaissance, not
design: its purpose is to stop you asking the user something the repo answers.

Then judge how much process the change deserves. A local, reversible change with
one obvious target does not need three approaches and eight questions — say so
and keep the ceremony proportional. What never scales down is the approval gate.

## Phase 2 — Grill

`references/grill.md`. Design tree, frontier, numbered rounds, a recommended
answer on every question.

Skip it only when no unsettled decision could change observable behaviour,
scope, an interface, the data, the failure policy or the acceptance criterion.
**"It seems obvious" is not a skip signal** — it is the feeling that precedes
building the wrong thing.

Under `/blueprint grill`, stop when the frontier empties: report the locked
constraints and go no further.

## Phase 3 — Ground

Reopen the files the locked answers implicate. Every fact the plan depends on
gets a `path:line`. A file you intend to create is named as new; an existing
path, symbol, or command is never guessed — a plausible-looking wrong path costs
the implementer an hour and costs you their trust.

## Phase 4 — Design

Architectural work gets 2–3 genuinely distinct approaches, each with its
trade-offs, your recommendation, and the concrete reason the others lose.

Bounded work where one local pattern already dominates gets that pattern and the
evidence that removed the choice. Inventing alternatives you would never pick,
so the plan looks considered, wastes the reader's attention.

## Phase 5 — Write it

`references/artifact.md` — the skeleton, step sizing, the anti-vagueness list,
and the three self-review passes. Written to
`docs/plans/<YYYY-MM-DD>-<slug>.md`, which is where `verify` already looks.

## Phase 6 — Crosscheck (optional)

`references/crosscheck.md`. Freeze the plan first — write it to disk before you
consult, or "adjudication" is just rewriting your position to match the reply
and you will not be able to tell. Then run `scripts/peer-run.mjs --mode plan`,
passing `--host` as the agent you are running inside; the peer is the other one.

Accepted objections visibly change the plan; deferred material ones block
approval; rejected ones stay in the appendix and never enter the executable
sections.

If the peer is unavailable, say so and proceed host-only — unless the user asked
for the crosscheck, in which case stop rather than relabel your own review.

## Phase 7 — Approve, then hand off

Present the artifact and ask for approval in as many words. Earlier enthusiasm
for the idea is not approval of a plan they had not yet seen.

Before that yes: **nothing is implemented, no source file is touched, no
worktree is made, nothing is committed, and no command that changes the project
is run.** The plan itself and the crosscheck's own files are the exception, and
have to be — the artifact must exist before it can be shown, and freezing it on
disk before consulting the peer is what makes the adjudication honest. So the
line is what the write is *for*: `docs/plans/<file>` and
`.agents/crosscheck/…` are the deliverable, everything else is the work, and
the work waits.

Then offer the handoff, because the plan being self-contained is what makes this
safe:

> The plan is at `docs/plans/<file>`. It is written to be executed by an agent
> that was not in this conversation — so the cheapest next move is `/clear`,
> then implement from the file. Want me to do that, or continue here?

Run the self-containment check in `references/artifact.md` **before** offering
it. If a step still leans on something only this conversation knows, that is a
gap in the plan, not a reason to keep the context.

After implementation: `/verify docs/plans/<file>` reads that same file as the
promise. **Name the path.** `verify` ranks the host's own plan artifact above
`docs/plans/`, so a bare `/verify` can pick up a plan-mode scratch file from the
same session — newer, and not what you wrote.

## What this does not do

- **Does not implement.** Approval ends this skill; it does not start the work.
- **Does not verify.** It never says code works — that is `verify`'s job, and
  `blueprint` has no evidence to say it with.
- **Does not decide for the user.** A delegated recommendation is locked and
  marked delegated. An unknown becomes a question with a decision criterion,
  never a silent assumption.
- **Does not renumber `S-xxx`.** Ever.
- **Does not merge two plans.** The peer objects against steps; the host stays
  the sole author.
- **Does not send secrets or unrelated repository content to the peer**, and
  never gives it a tool that can write.

## Red flags

| Thought | Reality |
|---|---|
| "I know what they want" | Then Q-001 costs one line and confirms it. |
| "The file is probably called that" | Open it. A guessed path is a lie with a plausible shape. |
| "I'll note the constraint in my summary" | The summary is not the promise. Put it in the artifact. |
| "They said build it, so I can start" | They approved an idea, not a plan they had not read. |
| "The peer objected, so it must be right" | An accept with no visible delta is capitulation. |
| "No objections survived, so it's solid" | Argue the other side once, then say that. |

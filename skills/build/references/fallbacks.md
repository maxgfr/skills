# Host tiers

Where the build executes. The laws are the same at every tier; what changes is
how much of the implementers' noise reaches your context, and how many steps
can run at once.

## Tier 1 — Workflow (Claude Code)

`phase0.md` has the call. The script owns the loop: waves → implement → review →
guard → next wave → record. Every agent's output stays inside the workflow;
what returns is the step table. Test logs, file reads and implementer chatter
never enter the session.

## Tier 2 — Parallel subagents (including Codex)

No Workflow tool, but a native subagent tool. Same loop, dispatched by hand,
with the briefs in `briefs.md` pasted verbatim:

1. **One wave per dispatch.** Send every implementer of the wave in one message
   so they run concurrently. In `peer` mode, send them one at a time: one
   worktree, one peer process.
2. **Then the reviewers** of that wave, in one message.
3. **Then the guard** — run `scripts/forbidden-repairs.mjs --since <baseline>
   --plan <planPath>` yourself via Bash; it is a plain Node script. `FORBIDDEN`
   → dispatch the revert brief, record `stopped_by`, and stop.
4. **Decide** each step with the rule at the end of `briefs.md`. A step not
   accepted gets one retry with the reviewer's issues, then `blocked`. Mark its
   dependents `skipped` before the next wave.
5. **Next wave.** A wave whose every step is skipped costs nothing.
6. **Record.** Write `<runDir>/BUILD.md` yourself.

The cost: the step results pass through your context on their way to the
decision. The briefs already cap what comes back; do not paste an implementer's
diff into your own reasoning to "double-check" it — that is the reviewer's job,
and the reviewer ran the command.

## Tier 3 — Inline

No sub-agents at all. Implement the steps yourself, one at a time, in wave order,
and hold the line on what the isolation was providing:

- Run the step's Verify command **before** writing the step down as done, and
  write the exit code next to it.
- Review your own step against Change and Preserve **in writing** before
  moving on. Skipping the review because you wrote the code is the exact
  failure the reviewer exists to prevent.
- Run the guard after every step, via Bash.
- The record must say `execution: inline`, so a reader knows one perspective
  wrote and reviewed every step.

`peer` mode has no inline tier — it needs a Bash tool to run the peer, which any
host with Bash has.

## Hosts without a worktree tool

`git worktree add` needs Git and a commit to branch from. With neither, stop:
building in the checked-out tree is not a fallback, because the guard's
baseline and the user's uncommitted work would be the same diff.

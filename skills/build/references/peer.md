# Peer mode — the other agent writes the code

`/build peer` hands each step to the *other* CLI agent: Codex when you are in
Claude Code, Claude when you are in Codex. You still manage the build — the
waves, the reviewer, the guard, the record — and the peer does the typing. It is
the same symmetry as `crosscheck`, with the one difference that matters: the
peer may write.

## What the peer gets

`scripts/peer-build.mjs` runs it, once per step, sequentially — one worktree,
one peer process. The peer receives, on stdin, the step verbatim with the same
rules and the same forbidden list a host implementer gets (`briefs.md`), and
is told to end with the files it changed and the Verify command's exit code.

## What the peer may do

Write inside the worktree. Nothing else. The flags, which the tests pin:

| Peer | Invocation |
|---|---|
| `codex` | `codex exec --ephemeral --sandbox workspace-write --color never --skip-git-repo-check --output-last-message <f> --cd <worktree> -` |
| `claude` | `claude -p --output-format json --permission-mode acceptEdits --allowedTools Read,Glob,Grep,Edit,Write,Bash --no-session-persistence --disable-slash-commands` |

Never present, and refused by name in `tests/peer-build.test.mjs`:

- `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`, `--full-auto` (Codex)
- `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `bypassPermissions`, `dontAsk` (Claude)
- `--add-dir` on either — the worktree is the whole world.

`--full-auto` is deliberately absent even though it is the documented way to
let Codex run unattended: it routes approvals through an automatic reviewer
whose policy is Codex's, not this skill's. `--sandbox workspace-write` under
`exec` is already non-interactive and already the whole write grant.

Claude's `Bash` allowance is the wider of the two — Claude has no OS sandbox —
and exists because the step's Verify command has to be runnable. If that is
too much for your machine, do not use `peer` from Codex.

## What the peer's word is worth

Nothing, on its own. `peer-build.mjs` returns `files_touched` (computed from
the worktree, not from the message), `duration_ms`, and `last_message`, which
is recorded and not believed. Then the workflow runs the **reviewer**, who reads
the diff against the step and runs the Verify command, and the **guard**, which
scans the diff for forbidden repairs. A step is `done` on the reviewer's exit
code, never on the peer's report. A peer that ends its message with `BLOCKED
BY` is surfaced as `blocked_claimed`, and the reviewer's run decides.

## When the peer is not there

Not installed, not authenticated, timed out, crashed, or the host could not
say which CLI it is running inside: `peer_unavailable`, with the reason, and
the build stops. **The host does not take over.** The user asked for the other
agent; a build that quietly reverts to the host is a build that lied about who
wrote it. Run `/build` again without `peer` if that is what you want.

A timed-out peer may have left files behind. They are listed in
`files_touched` and stay in the worktree; the handoff says so, and reverting
them is a `git checkout` away.

## Cost

One peer process per step, at whatever the peer charges, plus the host's
reviewer and guard per step as in the default mode. The host spends no
implementer. What it buys: a second vendor's model on the code, and a session
whose context never holds the implementation — only the step table.

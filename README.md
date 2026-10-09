# skills

Three skills that take a change from plan to proof, on any agent that reads skills (Claude Code, Codex, OpenCode…). They are plain Markdown: nothing to install, nothing to run.

- **blueprint** plans the change with you and asks for one approval.
- **build** implements it in a git worktree, then hands off to verify.
- **verify** runs your repo's own checks and audits the diff: `PASS`, `FAIL` or `UNPROVEN`.

## Install

```bash
npx skills add maxgfr/skills
```

That works everywhere. Add `--skill verify` to take a single skill. Native plugins exist too: `/plugin marketplace add maxgfr/skills` then `/plugin install maxgfr` in Claude Code, `codex plugin marketplace add maxgfr/skills` then `codex plugin add maxgfr@maxgfr-skills` in Codex.

## Use

Work as usual: open your agent's plan mode, or just describe the change. blueprint takes over, asks its questions and writes the plan; approving it (leaving plan mode) is the only thing you do. build and verify follow on their own, build repairs what verify finds, and you get one line per step, a verdict, and the worktree with its changes left uncommitted for you to review, commit and merge.

Each skill also runs alone: build on an approved plan in `docs/plans/`, verify on any finished work (checks only), or verify with a plan path to add the audit.

## How the work is split

| Job | Who |
|---|---|
| Plan | your session |
| Build | one subagent per step, in parallel: `small` by default, `large` for a UI step, `medium` or more for a security step; a reviewer per step (`review`, `large` for security); a smaller implementer can hand its step to `large`; a failed try retries one tier up |
| Repair | after a verify `FAIL`, one fixer per file, `medium` then `large`, three rounds at most |
| Final audit | `large` |

verify never prints a verdict without running the checks, never installs or writes, and the reviewer and the audit reject a skipped test, a silenced checker or an edited gate.

In Claude Code, build runs the steps as a Workflow, the deterministic script in skills/build/references/workflow.md. A plan of fifteen steps launches fifteen implementers at once, past the default workflow size: raise "Dynamic workflow size" in /config. Other hosts run the same loop with their subagent tool.

## Models (optional)

With no config, every tier is your session's model. To pick models, write `~/.agents/models.json` (or `<repo>/.agents/models.json`, which wins key by key), with one entry per agent:

```json
{
  "claude": {
    "small":  { "model": "haiku",  "effort": "max" },
    "medium": { "model": "sonnet", "effort": "high" },
    "large":  { "model": "opus",   "effort": "high" }
  }
}
```

A tier is `{ "model", "effort" }` or just a model name, which runs at your session's effort: set `effort` to push a small model further (`"max"` above). `review` (default `"medium"`) and `audit` (`"large"`) move those two roles; the rest is the session's call.

## Make blueprint fire every time

A skill's description competes with everything else in the session: your own instructions and other plugins' skills. Plan mode and "make a plan" always reach blueprint; a plain "add X" may go straight to code. To route every non-trivial change through it, add one line to your `CLAUDE.md` or `AGENTS.md`:

```
For any feature or change that spans several files or leaves a decision open, invoke the blueprint skill before writing code.
```

## Run only on request

All three run on their own when they fit. To keep one for explicit calls: add `disable-model-invocation: true` to its `SKILL.md` (Claude Code), set `allow_implicit_invocation: false` in `agents/openai.yaml` (Codex), or set `metadata.opencode/autoinvoke: 'false'` (OpenCode).

## Development

`npm ci && npm run check` validates the skills (Markdown only, line budget, no dead reference, no model name). See [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

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

Work as usual: open your agent's plan mode, or just describe the change. blueprint takes over, asks its questions and writes the plan; approving it (leaving plan mode) is the only thing you do. build and verify follow on their own, and you get one line per step, a verdict, and the worktree with its changes left uncommitted for you to review, commit and merge.

Each skill also runs alone: build on an approved plan in `docs/plans/`, verify on any finished work (checks only), or verify with a plan path to add the audit.

## How the work is split

| Job | Who |
|---|---|
| Plan | your session |
| Build | your session alone for a short plan; for a long one, `small` or `medium` per step (the session picks), `medium` reviews each wave |
| Final audit | `large` |

verify never prints a verdict without running the checks, never installs or writes, and the reviewer and the audit reject a skipped test, a silenced checker or an edited gate.

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

## Run only on request

All three run on their own when they fit. To keep one for explicit calls: add `disable-model-invocation: true` to its `SKILL.md` (Claude Code), set `allow_implicit_invocation: false` in `agents/openai.yaml` (Codex), or set `metadata.opencode/autoinvoke: 'false'` (OpenCode).

## Development

`npm ci && npm run check` validates the skills (Markdown only, line budget, no dead reference, no model name). See [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

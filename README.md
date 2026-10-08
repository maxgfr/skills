# skills

Three skills that take a change from plan to proof, on any agent that reads skills (Claude Code, Codex, OpenCode…):

- **blueprint** plans the change with you and asks for one approval.
- **build** implements it in a git worktree, then hands off to verify.
- **verify** runs your repo's own gates and audits the diff: `PASS`, `FAIL` or `UNPROVEN`.

## Install

```bash
npx skills add maxgfr/skills
```

That works everywhere. Add `--skill verify` to take a single skill. Native plugins exist too: `/plugin marketplace add maxgfr/skills` then `/plugin install maxgfr` in Claude Code, `codex plugin marketplace add maxgfr/skills` then `codex plugin add maxgfr@maxgfr-skills` in Codex.

## Use

Work as usual: open your agent's plan mode, or just describe the change. blueprint takes over, asks its questions and writes the plan; approving it (leaving plan mode) is the only thing you do. build and verify follow on their own, and you get one line per step, a verdict, and the worktree to merge.

Each skill also runs alone: build on an approved plan in `docs/plans/`, verify on any finished work (gates only), or verify with a plan path to add the audit.

## How the work is split

| Job | Who |
|---|---|
| Plan | your session |
| Build a plan of up to 3 steps | your session (cheaper and faster than a team) |
| Build a longer plan | `small` per step, `medium` reviews each wave, `medium` retries a step `small` failed twice |
| Final audit | `large` |

A script, not the model, decides the order, checks that no test was skipped, no checker silenced and no gate edited, and runs the gates.

## Models (optional)

With no config, every tier is your session's model. To pick models, write `~/.agents/models.json` (or `<repo>/.agents/models.json`, which wins key by key), with one entry per agent:

```json
{
  "claude": {
    "small":  { "model": "haiku",  "effort": "max" },
    "medium": { "model": "sonnet", "effort": "high" },
    "large":  { "model": "opus",   "effort": "high" },
    "solo": 3
  }
}
```

A tier is `{ "model", "effort" }` or just a model name. `solo` is the largest plan your session builds alone (`0` always delegates). `attempts`, `review` and `audit` move the other roles. A typo is an error, never a silent default.

## Run only on request

All three run on their own when they fit. To keep one for explicit calls: add `disable-model-invocation: true` to its `SKILL.md` (Claude Code), set `allow_implicit_invocation: false` in `agents/openai.yaml` (Codex), or set `metadata.opencode/autoinvoke: 'false'` (OpenCode).

## Development

`npm ci && npm run check`. See [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

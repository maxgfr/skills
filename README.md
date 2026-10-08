# skills

Three skills for agent-driven engineering, on any host with skills (Claude Code, Codex, OpenCode…): a big model plans, a small model writes the code, a medium model reviews it, a big model audits the result. They speak in tiers, never model names.

## Install

```bash
npx skills add maxgfr/skills                                                          # any host
codex plugin marketplace add maxgfr/skills && codex plugin add maxgfr@maxgfr-skills   # Codex plugin
```

In Claude Code: `/plugin marketplace add maxgfr/skills`, then `/plugin install maxgfr`. Add `--skill verify` to `npx skills add` to take just one skill.

## The flow

1. **blueprint** plans with you, then asks for one approval (the host's plan mode when it has one).
2. **build** starts on its own: a worktree from your local `HEAD`, `small` implements each step, one `medium` review per wave.
3. **verify** follows: the repo's gates once, then a `large` audit of the diff against the plan. You get `PASS`, `FAIL` or `UNPROVEN` and the worktree to merge.

Each skill also runs alone: `verify` with no argument runs only the gates; with a plan path, or `audit [<ref>]`, it adds the audit.

| Role | Default tier |
|---|---|
| Plan | the session |
| Implement a step | `small`, then `small` with the reviewer's issues, then `medium` |
| Review a wave, rerun every Verify and the guard | `medium` |
| Audit the result | `large` |

## Models and effort

Tiers map to models in `~/.agents/models.json`, overridden key by key by `<repo>/.agents/models.json`. Anything absent inherits the session, so no config is needed.

```json
{
  "claude": {
    "small":  { "model": "haiku",  "effort": "max" },
    "medium": { "model": "sonnet", "effort": "high" },
    "large":  { "model": "opus",   "effort": "high" }
  },
  "codex": { "small": { "effort": "medium" }, "large": { "effort": "xhigh" } }
}
```

A tier is `{ "model", "effort" }` or a bare model string. Per host, `attempts` (default `["small", "small", "medium"]`), `review` (`"medium"`) and `audit` (`"large"`) move the roles. A typo is an error, never a silent default. Check with `node skills/build/scripts/models.mjs --cwd . --host claude`.

## Automatic or explicit-only

All three ship automatic: the agent invokes a skill when its description fits, and its name always works. To make one explicit-only, edit the installed copy:

| Host | Explicit-only |
| --- | --- |
| Claude Code | add `disable-model-invocation: true` to `SKILL.md` |
| Codex | set `allow_implicit_invocation: false` in `agents/openai.yaml` |
| OpenCode | set `metadata.opencode/autoinvoke: 'false'`, or deny the skill under `permission.skill` in `opencode.json` |

Updating or reinstalling restores the default.

## Development

`npm ci && npm run check`. See [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

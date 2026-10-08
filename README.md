# skills

Three process skills for agent-driven engineering: a big model plans, a small
model writes the code, a medium model reviews it, and a big model audits the
result. They work on every host with skills (Claude Code, Codex, OpenCode…) and
never name a model: you map the tiers once, in a config file.

## Install

```bash
codex plugin marketplace add maxgfr/skills && codex plugin add maxgfr@maxgfr-skills   # Codex
npx skills add maxgfr/skills                                                          # any host, editable copies
```

```text
/plugin marketplace add maxgfr/skills
/plugin install maxgfr
```

The second block is the Claude Code plugin. Pick one path per host. The
invocation syntax depends on the host: `$verify` in Codex, `/maxgfr:verify` for
the Claude plugin, `/verify` for a standalone skill. Each skill is
self-contained, so `npx skills add maxgfr/skills --skill verify` takes just one.

## The flow

```text
$blueprint            # grill → ground → write docs/plans/<date>-<slug>.md → you approve
$build                # worktree → per step: small implements, medium reviews + reruns Verify + guard
$verify <plan>        # repo gates once, then one large-tier audit of the diff → PASS | FAIL | UNPROVEN

$blueprint auto       # all three from one call, after your approval
```

| Role | Tier | Where |
|---|---|---|
| Plan | `large` (the session) | `blueprint` |
| Implement a step | `small` | `build` |
| Review a step, rerun its proof | `medium` | `build` |
| Escalation after two failed small attempts | `medium` | `build` |
| Final audit | `large` | `verify` |

A failing step is retried on `small` with the reviewer's issues, then once on
`medium`, then marked `blocked`. Every guard that has a right answer is a
dependency-free script: `plan-steps.mjs` (which plan, which waves),
`forbidden-repairs.mjs` (no skipped test, no suppression, no edited gate),
`detect-gates.mjs --run` (the repo's own definition of green).

Output is short on purpose. `build` prints one line per step
(`S-001 done 0 small`), `verify` prints a verdict, one line per gate and one per
finding. No report files.

## Models

The skills speak in tiers. Names live in `models.json`, read from
`<repo>/.agents/models.json`, then `~/.agents/models.json`. The first file that
defines the current host wins. An absent tier, or no file at all, means the
session's own model, so everything works with no config.

```json
{
  "claude": { "small": "haiku", "medium": "sonnet", "large": "opus" },
  "codex":  { "small": "<model>", "medium": "<model>", "large": "<model>" }
}
```

Use whatever names your host's subagent tool accepts. If that tool takes no
model, every tier inherits and the skill says so once. Check a resolution with:

```bash
node skills/build/scripts/models.mjs --cwd . --host claude
```

## Manual or automatic

All three ship **explicit-only**: they run when you invoke them by name. To let
the agent pick one, change the installed copy:

| Host | Shipped, manual | Automatic |
| --- | --- | --- |
| Claude Code | `disable-model-invocation: true` in `SKILL.md` | delete the line, or set `false` |
| Codex | `allow_implicit_invocation: false` in `agents/openai.yaml` | set `true` |
| OpenCode | `metadata.opencode/autoinvoke: 'false'` in `SKILL.md` | delete the entry, or set `'true'` |

Claude Code also accepts `"skillOverrides": { "verify": "on" }` in
`settings.json`, but plugin installs ignore it. OpenCode V1 reads no
`autoinvoke` metadata. To keep the skills manual there, set
`"permission": { "skill": { "blueprint": "deny", "build": "deny", "verify": "deny" } }`
in `opencode.json`; the explicit `/name` commands keep working. Updating or
reinstalling restores the shipped default.

## Development

```bash
npm ci
npm run check   # validate (frontmatter, budgets, dead references, no model names) + tests + plugin versions
```

`SKILL.md` files stay under 80 lines, and `npm run validate` fails if a model
name appears anywhere under `skills/`. Releases come from conventional commits
on `main` via semantic-release. Adding a skill: [CONTRIBUTING.md](./CONTRIBUTING.md).
Writing one well: [AGENTS.md](./AGENTS.md).

## License

MIT

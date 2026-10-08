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

The second block is the Claude Code plugin. The skills run when you ask for
them (see [below](#on-request-or-explicit-only)). Pick one path per host. The
invocation syntax depends on the host: `$verify` in Codex, `/maxgfr:verify` for
the Claude plugin, `/verify` for a standalone skill. Each skill is
self-contained, so `npx skills add maxgfr/skills --skill verify` takes just one.

## The flow

```text
$blueprint            # grill → ground → write docs/plans/<date>-<slug>.md → you approve
$build                # worktree → per step: small implements, medium reviews + reruns Verify + guard
$verify               # default: the repo's gates once, a few lines → PASS | FAIL | UNPROVEN
$verify <plan>        # + one large-tier audit of the diff against the plan (also: $verify audit)

$blueprint auto       # all three from one call, after your approval
```

| Role | Tier | Where |
|---|---|---|
| Plan | `large` (the session) | `blueprint` |
| Implement a step | `small` | `build` |
| Review a step, rerun its proof | `medium` | `build` |
| Escalation after two failed small attempts | `medium` | `build` |
| Final audit (on request, or after `build … then verify`) | `large` | `verify` |

These are the defaults. Every tier's model and effort, and which tier does
which job, is configurable: see [Models and effort](#models-and-effort).

A failing step is retried on `small` with the reviewer's issues, then once on
`medium`, then marked `blocked`. Every guard that has a right answer is a
dependency-free script: `plan-steps.mjs` (which plan, which waves),
`forbidden-repairs.mjs` (no skipped test, no suppression, no edited gate),
`detect-gates.mjs --run` (the repo's own definition of green; a command that an
aggregate like `npm run check` already runs is skipped).

Output is short on purpose. `build` prints one line per step
(`S-001 done 0 small`), `verify` prints a verdict, one line per gate and one per
finding. No report files.

## Models and effort

The skills speak in tiers. What a tier means lives in `models.json`: first
`~/.agents/models.json` (yours, for every repo), then `<repo>/.agents/models.json`,
which overrides it key by key. Anything absent inherits the session's model
and effort, so everything works with no config.

```json
{
  "claude": {
    "small":  { "model": "haiku",  "effort": "max" },
    "medium": { "model": "sonnet", "effort": "high" },
    "large":  { "model": "opus",   "effort": "high" }
  },
  "codex": {
    "small":  { "effort": "medium" },
    "medium": { "effort": "high" },
    "large":  { "effort": "xhigh" }
  }
}
```

A tier is `{ "model", "effort" }`, or a bare string for the model alone. The
`codex` entry above keeps the session's model and only changes the effort. Use
the names and effort levels your host's subagent tool accepts. The roles can
move too, per host:

| Key | Default | Meaning |
|---|---|---|
| `attempts` | `["small", "small", "medium"]` | `build`: the tier of each try at a step, then `blocked` |
| `review` | `"medium"` | `build`: the reviewer's tier |
| `audit` | `"large"` | `verify`: the auditor's tier |

`large` also names the planner, but `blueprint` runs in your session: pick its
model and effort when you start the session. A typo (`"smal"`, `"modle"`) is an
error, never a silent default. Check what a repo resolves to with:

```bash
node skills/build/scripts/models.mjs --cwd . --host claude
```

## On request or explicit-only

All three ship **on request**: the agent may call one, but each description
restricts it to when you ask for it. Invoking by name always works. To make a
skill explicit-only, so that only its name runs it, change the installed copy:

| Host | Shipped, on request | Explicit-only |
| --- | --- | --- |
| Claude Code | no `disable-model-invocation` in `SKILL.md` | add `disable-model-invocation: true` |
| Codex | `allow_implicit_invocation: true` in `agents/openai.yaml` | set `false` |
| OpenCode | `metadata.opencode/autoinvoke: 'true'` in `SKILL.md` | set `'false'` |

Claude Code also accepts `"skillOverrides": { "verify": "user-invocable-only" }`
in `settings.json`, but plugin installs ignore it. OpenCode V1 reads no
`autoinvoke` metadata. To force explicit-only there, set
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

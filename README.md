# skills

Three skills that take a change from plan to proof, on any agent that reads skills (Claude Code, Codex, OpenCode…). They are plain Markdown: nothing to install, nothing to run.

- **blueprint** plans the change with you and asks for one approval.
- **build** implements it in place, then hands off to verify.
- **verify** runs your repo's own checks and audits the diff: `PASS`, `FAIL` or `UNPROVEN`.

## Install

```bash
npx skills add maxgfr/skills
```

That works everywhere. Add `--skill verify` to take a single skill. Native plugins exist too: `/plugin marketplace add maxgfr/skills` then `/plugin install maxgfr` in Claude Code, `codex plugin marketplace add maxgfr/skills` then `codex plugin add maxgfr@maxgfr-skills` in Codex.

## Use

Open your agent's plan mode, or ask for a plan. blueprint reads the code the change touches and decides what the repo or a sensible default settles, writing each choice into the plan as an assumption. It asks only what it cannot guess: usually nothing, at most three questions in one round. Approving the plan (leaving plan mode) is where you correct it, and the only other thing you do. build then implements it in your current tree and hands off to verify, which runs your checks and audits the diff once; build repairs what fails, up to two rounds. You get one line per step, a verdict, and the changes left uncommitted for you to review and commit. build only moves to a worktree when your tree already holds changes outside the plan.

Each skill also runs alone: build on an approved plan (blueprint writes it to plan mode's file or `${TMPDIR:-/tmp}/plans/<repo>/`, and to `docs/plans/` only when you ask to keep it), verify on any finished work (checks only), or verify with a plan path to add the audit.

verify never prints a verdict without running the checks, never installs or writes, and build and the audit reject a skipped test, a silenced checker or an edited gate.

## Models

Planning and supervision run in your session, on the model and effort your agent is set to (in Claude Code, `model` and `effortLevel` in `settings.json`). The subagents take theirs from `~/.agents/models.json`, or `<repo>/.agents/models.json`, which wins role by role, with one entry per agent:

```json
{
  "claude": {
    "scan":     { "model": "haiku", "effort": "low" },
    "subagent": { "model": "sonnet", "effort": "medium" },
    "review":   { "model": "sonnet", "effort": "high" }
  }
}
```

With `subagent` set and an agent that runs subagents, coders on that role write every step and repair while your session briefs them, reads the diff and decides; otherwise build writes the code itself. `review` runs verify's audit. When verify runs as a workflow, `scan` reads each file of the diff and `review` checks each finding. In Claude Code, workflows run on request or with `claude --model opus --effort ultracode`, and build and verify use one on their own when the tool exists. A role is `{ "model", "effort" }` or just a model name; what it leaves out, or a missing file, falls back to your session.

## Run only on request

All three run on their own when they fit. To keep one for explicit calls: add `disable-model-invocation: true` to its `SKILL.md` (Claude Code), set `allow_implicit_invocation: false` in `agents/openai.yaml` (Codex), or set `metadata.opencode/autoinvoke: 'false'` (OpenCode).

## Development

`npm ci && npm run check` validates the skills (Markdown only, line budget, no dead reference, no model name). See [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

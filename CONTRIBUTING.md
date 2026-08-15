# Contributing

## Setup

```bash
npm install
npm run check
```

## Adding a skill

```bash
mkdir -p skills/<name>
```

Write `skills/<name>/SKILL.md` with frontmatter:

```yaml
---
name: <name>              # must equal the directory name
description: <what it does>. Use when <the trigger, in the words a user would type>.
---
```

Then add `"./skills/<name>"` to `.claude-plugin/plugin.json`, add a row to the README table, and run `npm run validate`.

Read [AGENTS.md](./AGENTS.md) before writing the body — it covers what belongs in `SKILL.md` versus `references/`, and why anything with a right answer belongs in a script rather than a prompt.

## Changing behaviour

Add a changeset:

```bash
npm run changeset
```

Patch for a fix, minor for new behaviour or a new skill. The release workflow opens a version PR; merging it bumps `package.json`, syncs `.claude-plugin/plugin.json`, and tags.

## Testing

`npm run check` proves the files are well-formed. It does not prove a skill works.

Before shipping a behaviour change, run the skill against a repo where you already know the answer — and include a case where it should **fail**. A skill that has only ever been observed passing has never been tested.

For `verify` specifically, the honest test is a repo with a deliberately broken change: a gate that fails, a requirement quietly dropped, a bug the tests do not cover, and a test that passes with the fix reverted. It should catch all four, and its fix loop should refuse to make the gate green by suppressing it.

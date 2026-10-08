# Contributing

```bash
npm ci          # release tooling only; the skills need nothing
npm run check   # validate + tests + plugin versions
```

## Adding a skill

Create `skills/<name>/SKILL.md`:

```yaml
---
name: <name>              # equals the directory name
description: <what it does>. Use when <the trigger, in the user's words>.
---
```

Add `"./skills/<name>"` to both plugin manifests, a line to the README, and run `npm run validate`. [AGENTS.md](./AGENTS.md) says what goes in `SKILL.md` and `references/`.

## Changing behaviour

semantic-release reads the history on `main` and picks the bump.

| Commit | Bump | Use for |
|---|---|---|
| `fix: ...` | patch | a wrong instruction, a skill that misfires |
| `feat: ...` | minor | new behaviour, a new skill |
| `refactor:` `docs:` `test:` `chore:` | none | no release |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major | an output shape or argument someone depends on |

The release workflow bumps `package.json`, syncs the plugin manifests, writes `CHANGELOG.md`, tags and publishes. Squash-merge with the conventional-commit line as the title.

## Testing

Run a behaviour change against a repo where you know the answer, including a case that should **fail**. For `verify`, that is a broken change: a failing check, a dropped plan requirement and an untested bug, all reported as `FAIL`.

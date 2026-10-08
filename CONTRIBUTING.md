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

Add `"./skills/<name>"` to both plugin manifests, a line to the README, and run `npm run validate`. [AGENTS.md](./AGENTS.md) says what goes in `SKILL.md`, `references/` and `scripts/`.

## Shared copies

`scripts/models.mjs` ships byte-identical in `build` and `verify`, so each skill installs on its own. Edit the `build` copy and `cp` it to `verify`; `tests/models.test.mjs` fails if you forget.

## Changing behaviour

semantic-release reads the history on `main` and picks the bump.

| Commit | Bump | Use for |
|---|---|---|
| `fix: ...` | patch | a wrong rule, a crash, a false positive |
| `feat: ...` | minor | new behaviour, a new skill |
| `refactor:` `docs:` `test:` `chore:` | none | no release |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major | a rule or output shape someone's loop depends on |

The release workflow bumps `package.json`, syncs the plugin manifests, writes `CHANGELOG.md`, tags and publishes. Squash-merge with the conventional-commit line as the title.

## Testing

Run a behaviour change against a repo where you know the answer, including a case that should **fail**. For `verify`, that is a broken change: a failing gate, a dropped plan requirement and an untested bug, all reported as `FAIL`.

Building **this** repo trips the guard on its own source and tests, which must contain every pattern it refuses. Use `--allow` there:

```bash
node skills/build/scripts/forbidden-repairs.mjs --since HEAD --allow test-skip --allow suppression
```

Never widen a rule to make that go away: an escape hatch the guard honours from inside the diff is one a cheating fixer can write too.

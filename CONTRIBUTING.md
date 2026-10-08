# Contributing

## Setup

```bash
npm ci
npm run check
```

The skills themselves are dependency-free — `npm ci` installs the release
tooling only, and `npm run check` runs on Node's standard library alone.

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

## Shared copies

`scripts/models.mjs` ships in both `build` and `verify`, byte-identical. A skill
installed on its own with `--skill build` has to be complete, and a relative
link into a sibling directory would install as a dangling reference.

So edit the `build` copy and `cp` it to `verify`. `tests/models.test.mjs` fails
if you forget.

## Changing behaviour

The commit message is the release. semantic-release reads the history on `main`
and decides the bump itself — there is no file to add and no version PR to merge.

| Commit | Bump | Use for |
|---|---|---|
| `fix: ...` | patch | a rule that was wrong, a crash, a false positive |
| `feat: ...` | minor | new behaviour, a new skill |
| `refactor:` `docs:` `test:` `chore:` | none | no release |
| `feat!: ...` or a `BREAKING CHANGE:` footer | major | a rule or output shape someone's loop depends on |

A merged PR ships on its own: the workflow bumps `package.json`, syncs
`.claude-plugin/plugin.json` through `scripts/sync-plugin-version.mjs`, writes
`CHANGELOG.md`, tags, and publishes the GitHub release.

Squash-merge, and make the squash title the conventional-commit line — that is
the message semantic-release actually reads.

## Testing

`npm run check` proves the files are well-formed. It does not prove a skill works.

Before shipping a behaviour change, run the skill against a repo where you already know the answer — and include a case where it should **fail**. A skill that has only ever been observed passing has never been tested.

Running `build` on **this** repo is a special case: `forbidden-repairs.mjs` and
its tests have to contain every pattern the guard refuses, so the guard flags its
own source. That is what `--allow` is for — it downgrades a rule to a warning
instead of failing the round:

```bash
node skills/build/scripts/forbidden-repairs.mjs --since HEAD \
  --allow test-skip --allow suppression
```

Never widen a rule to make this go away. An escape hatch the guard honours from
inside the diff is one a cheating fixer can write for itself.

For `verify` specifically, the honest test is a repo with a deliberately broken change: a gate that fails, a plan requirement quietly dropped, and a bug the tests do not cover. It should report all three as `FAIL`.

# The plan file

```markdown
# <Subject>

## Goal
<The observable outcome.>

## Decisions
- <choice> → <the user's answer, or "assumed: …" when you decided it>

## Non-goals
- <What this does not do. Optional.>

## Steps

### S-001 — <imperative title>
- **Files:** <paths to create, modify or test>
- **Change:** <what to write; cite `path:line` only for a fact that is not obvious; say what must not move when it is at risk>
- **Verify:** `<command>`
```

Verify is one command whose exit code is the result, ideally the repo's test command on one file; for a bug fix, a test that fails first. `S-xxx` numbers never change.

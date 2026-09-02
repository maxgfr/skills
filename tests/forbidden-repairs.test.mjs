import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const SCRIPT = join(root, 'skills', 'verify', 'scripts', 'forbidden-repairs.mjs')

function scan(patch, extraArgs = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...extraArgs], {
      input: patch,
      encoding: 'utf8',
    })
    return { exitCode: 0, ...JSON.parse(stdout) }
  } catch (err) {
    return { exitCode: err.status, ...JSON.parse(err.stdout) }
  }
}

const patch = (file, ...lines) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -10,3 +10,4 @@', ...lines].join(
    '\n',
  )

test('an honest fix passes', () => {
  const r = scan(patch('src/user.ts', ' const a = 1', '+  if (!email) throw new BadRequest("email required")', ' return a'))
  assert.equal(r.verdict, 'CLEAN')
  assert.equal(r.exitCode, 0)
  assert.deepEqual(r.files_changed, ['src/user.ts'])
})

test('a type-checker suppression is refused', () => {
  const r = scan(patch('src/user.ts', '+// @ts-ignore', '+doThing(maybeUndefined)'))
  assert.equal(r.verdict, 'FORBIDDEN')
  assert.equal(r.exitCode, 1)
  assert.equal(r.violations[0].rule, 'suppression')
  assert.equal(r.violations[0].file, 'src/user.ts')
})

test('a skipped test is refused', () => {
  const r = scan(patch('src/user.test.ts', '+it.skip("rejects an expired token", () => {'))
  assert.equal(r.violations[0].rule, 'test-skip')
})

test('widening to any is refused in TypeScript, ignored elsewhere', () => {
  const ts = scan(patch('src/user.ts', '+const parsed = raw as any'))
  assert.equal(ts.violations[0].rule, 'any-cast')

  const py = scan(patch('src/user.py', '+parsed = cast(raw, any)'))
  assert.equal(py.verdict, 'CLEAN')
})

test('--allow downgrades a rule to a warning instead of failing the round', () => {
  const r = scan(patch('src/user.ts', '+const parsed = raw as any'), ['--allow', 'any-cast'])
  assert.equal(r.verdict, 'CLEAN')
  assert.equal(r.exitCode, 0)
  assert.equal(r.warnings[0].rule, 'any-cast')
})

test('deleting an assertion from a test is refused', () => {
  const r = scan(patch('tests/user.test.ts', '-  expect(res.status).toBe(401)'))
  assert.equal(r.violations[0].rule, 'test-deletion')
  assert.equal(r.violations[0].kind, 'del')
})

test('deleting a non-assertion line from a test is fine', () => {
  const r = scan(patch('tests/user.test.ts', '-  const unused = 3'))
  assert.equal(r.verdict, 'CLEAN')
})

test('editing CI is refused — that is rewriting the definition of green', () => {
  const r = scan(patch('.github/workflows/ci.yml', '-      - run: pnpm test', '+      - run: pnpm test || true'))
  assert.ok(r.violations.some((v) => v.rule === 'gate-tampering'))
})

test('rewriting a gate script in package.json is refused', () => {
  const r = scan(patch('package.json', '   "scripts": {', '+    "test": "echo skipped",', '     "lint": "eslint ."'))
  assert.equal(r.violations[0].rule, 'gate-tampering')
})

test('adding a dependency whose name starts like a gate is not gate tampering', () => {
  // `"testcontainers":`, `"lint-staged":`, `"build-tools":` all begin with a
  // gate word. Only the scripts block defines a gate; a dependencies block
  // cannot, and refusing it reverts an honest install.
  const r = scan(
    patch(
      'package.json',
      '   "devDependencies": {',
      '+    "testcontainers": "^10.0.0",',
      '+    "lint-staged": "^15.0.0",',
      '     "vitest": "^1.0.0"',
    ),
  )
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('a scripts block that closed before the change no longer scopes it', () => {
  const r = scan(
    patch(
      'package.json',
      '   "scripts": {',
      '     "test": "vitest"',
      '   },',
      '   "devDependencies": {',
      '+    "testcontainers": "^10.0.0",',
    ),
  )
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('a package.json change the patch cannot place is noted, not flagged', () => {
  // The hunk starts inside some object whose opener was elided. From a patch
  // alone there is no telling whether it is scripts or dependencies, and a
  // guess in either direction is a wrong guard. --since resolves it.
  const r = scan(patch('package.json', '+    "test": "echo skipped",'))
  assert.equal(r.verdict, 'CLEAN')
  assert.ok(r.notes.some((n) => /could not be placed/.test(n)), JSON.stringify(r.notes))
})

test('renaming a CI workflow away is gate tampering even with no content change', () => {
  // A pure rename has no +/- lines. `ci.yml` → `ci.yml.disabled` switches the
  // gate off and, read line by line, changed nothing.
  const p = [
    'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml.disabled',
    'similarity index 100%',
    'rename from .github/workflows/ci.yml',
    'rename to .github/workflows/ci.yml.disabled',
  ].join('\n')
  const r = scan(p)
  assert.equal(r.verdict, 'FORBIDDEN')
  assert.equal(r.violations[0].rule, 'gate-tampering')
  assert.equal(r.violations[0].kind, 'rename')
  assert.ok(r.files_changed.includes('.github/workflows/ci.yml'))
  assert.ok(r.files_changed.includes('.github/workflows/ci.yml.disabled'))
})

test('renaming a source file is not gate tampering', () => {
  const p = [
    'diff --git a/src/a.ts b/src/b.ts',
    'similarity index 100%',
    'rename from src/a.ts',
    'rename to src/b.ts',
  ].join('\n')
  const r = scan(p)
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
  assert.deepEqual(r.files_changed, ['src/a.ts', 'src/b.ts'])
})

test('editing the plan to match the code is refused when the plan is named', () => {
  const r = scan(patch('docs/plan.md', '+ ~~rate-limit the endpoint~~ (dropped)'), [
    '--plan',
    'docs/plan.md',
  ])
  assert.equal(r.violations[0].rule, 'spec-rewrite')
})

test('the plan is recognised when named by an absolute path', () => {
  // Phase 0 hands the guard `~/.claude/plans/…` or `/repo/docs/plan.md`, while
  // the diff says `docs/plan.md`. Compared raw, the rule never fired.
  const r = scan(patch('docs/plan.md', '+ ~~rate-limit the endpoint~~ (dropped)'), [
    '--plan',
    resolve(process.cwd(), 'docs/plan.md'),
  ])
  assert.equal(r.violations[0].rule, 'spec-rewrite')
})

test('editing a document that is not the plan is not a spec rewrite', () => {
  const r = scan(patch('docs/plan.md', '+ a note'), ['--plan', 'docs/other.md'])
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('an empty catch is refused', () => {
  const r = scan(patch('src/user.ts', '+try { risky() } catch (e) {}'))
  assert.equal(r.violations[0].rule, 'error-swallow')
})

test('an empty catch spanning several lines is refused too', () => {
  // The common shape by far, and the one a single-line rule cannot see. Missing
  // it means the guard refuses the tidy cheat and waves the ordinary one past.
  const r = scan(patch('src/user.ts', '+try {', '+  risky()', '+} catch (e) {', '+}'))
  assert.equal(r.verdict, 'FORBIDDEN')
  assert.equal(r.violations[0].rule, 'error-swallow')
})

test('a catch whose body is only a comment is still a swallow', () => {
  const r = scan(patch('src/user.ts', '+} catch (e) {', '+  // nothing to do here', '+}'))
  assert.equal(r.violations[0].rule, 'error-swallow')
})

test('a catch that comments then handles is not a swallow', () => {
  // The comment is not the body. Refusing this reverts an honest repair and
  // reports the fixer as a cheat.
  const r = scan(
    patch('src/user.ts', '+} catch (e) {', '+  // rethrow as a domain error', '+  throw new DomainError(e)', '+}'),
  )
  assert.equal(r.verdict, 'CLEAN')
})

test('a pre-existing empty catch the diff merely brushes past is not this round’s doing', () => {
  const r = scan(patch('src/user.ts', ' } catch (e) {', ' }', '+const after = 1'))
  assert.equal(r.verdict, 'CLEAN')
})

test('.skip( outside a test file is pagination, not a skipped test', () => {
  // `repo.createQueryBuilder('u').skip(20).take(20)` is the standard idiom in
  // TypeORM, Mongoose and Prisma. Flagging it stops the loop on an honest fix.
  const r = scan(patch('src/users.ts', "+  return repo.createQueryBuilder('u').skip(page * 20).take(20).getMany()"))
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('a bare .skip( inside a test file is still refused', () => {
  const r = scan(patch('tests/user.test.ts', '+  suite.skip(() => {'))
  assert.equal(r.violations[0].rule, 'test-skip')
})

test('a named skip receiver is refused wherever it appears', () => {
  const r = scan(patch('src/user.ts', '+it.skip("rejects an expired token", () => {'))
  assert.equal(r.violations[0].rule, 'test-skip')
})

test('renaming a test is not deleting an assertion', () => {
  // ASSERTION matches "should", which lives in test titles far more often than
  // in assertions. Reading the title as an assertion refuses every rename.
  const r = scan(patch('tests/user.test.ts', "-it('should return the user', () => {", "+it('returns the user', () => {"))
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('a bare Python assert is still an assertion once strings are blanked', () => {
  const r = scan(patch('tests/test_user.py', '-    assert response.status_code == 401'))
  assert.equal(r.violations[0].rule, 'test-deletion')
})

test('prose that names a suppression in order to forbid it is not a suppression', () => {
  // references/fix-loop.md lists every banned pattern by name. A guard that
  // cannot tell code from documentation fails on its own repo.
  const r = scan(patch('docs/rules.md', '+Never add `@ts-ignore` or `eslint-disable`, and never `it.skip(`.'))
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('a banned pattern quoted as data is not a repair', () => {
  // A rule table, a fixture, a migration guide — and this guard's own test file,
  // which cannot be edited without naming every pattern it refuses.
  const r = scan(
    patch('src/rules.ts', '+const BANNED = ["@ts-ignore", "eslint-disable", "it.skip("]'),
  )
  assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
})

test('a real suppression is still caught once strings are blanked', () => {
  // The blanking must not become the escape hatch: a genuine directive is a
  // comment, never a quoted value.
  assert.equal(scan(patch('src/user.ts', '+// @ts-ignore')).violations[0].rule, 'suppression')
  assert.equal(scan(patch('src/user.py', '+x = compute()  # noqa')).violations[0].rule, 'suppression')
  assert.equal(
    scan(patch('tests/a.test.ts', '+it.skip("rejects an expired token", () => {')).violations[0].rule,
    'test-skip',
  )
})

test('a type annotation in a comment is not a widening', () => {
  const r = scan(patch('src/user.ts', '+// the helper returns: any of the three shapes'))
  assert.equal(r.verdict, 'CLEAN')
})

test('a source file named after a legal document is still code', () => {
  // `(\.[a-z]+)?` on the CHANGELOG|LICENSE|NOTICE alternative swallowed a real
  // extension, so every rule skipped these paths — a guard that waves through
  // any file someone happened to name `license.js`.
  for (const f of ['src/license.js', 'src/changelog.ts', 'components/Notice.tsx', 'lib/license.py']) {
    const r = scan(patch(f, '+try { verify() } catch (e) {', '+}'))
    assert.equal(r.verdict, 'FORBIDDEN', `${f} was exempted: ${JSON.stringify(r.violations)}`)
  }
  // The genuine prose files stay exempt.
  for (const f of ['LICENSE', 'CHANGELOG.md', 'NOTICE']) {
    assert.equal(scan(patch(f, '+use @ts-ignore to silence it')).verdict, 'CLEAN', f)
  }
})

test('a block comment left open in one hunk does not blank the next', () => {
  // The per-file blob joins hunks that are not adjacent in the real file. A
  // `/**` whose `*/` is elided would blank everything up to a stray `*/`
  // further down — including the empty catch between them.
  const p = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,2 @@',
    ' /** a doc comment whose close is elided',
    '+const version = 2',
    '@@ -40,2 +40,3 @@',
    ' function g() {',
    '+  try { risky() } catch (e) {}',
    '@@ -80,2 +80,2 @@',
    '  */',
    '+const tail = 3',
  ].join('\n')
  const r = scan(p)
  assert.equal(r.verdict, 'FORBIDDEN', JSON.stringify(r.violations))
  assert.equal(r.violations[0].rule, 'error-swallow')
})

test('a glob in a string does not open a comment', () => {
  // The `/*` inside `'src/*.ts'` is not a comment. Treating it as one blanks
  // everything up to the next real `*/` — here an ordinary trailing note — and
  // the empty catch between them is never matched.
  const r = scan(
    patch(
      'src/b.ts',
      "+const files = glob('src/*.ts')",
      '+try { compile(files) } catch (e) {}',
      '+/* trailing note */',
    ),
  )
  assert.equal(r.verdict, 'FORBIDDEN', JSON.stringify(r.violations))
  assert.equal(r.violations[0].rule, 'error-swallow')
})

test('a #private member is not a comment', () => {
  // `#` opens a comment in Python, not in TypeScript. Blanking it hid the
  // widening the rule exists to catch.
  assert.equal(scan(patch('src/cache.ts', '+  #store: any = {}')).violations[0].rule, 'any-cast')
  assert.equal(scan(patch('src/cache.ts', '+  this.#cache = value as any')).violations[0].rule, 'any-cast')
  // and `#` is still a comment where it is one
  assert.equal(scan(patch('src/cache.py', '+x = 1  # noqa')).violations[0].rule, 'suppression')
})

test('one cheat on one line is one finding', () => {
  // In a test file `it.skip(` matches both the named-receiver rule and the bare
  // `.skip(` rule. The loop must not chase one line as two findings.
  const r = scan(patch('tests/auth.test.js', "+it.skip('logs in', () => {})"))
  assert.equal(r.violations.length, 1, JSON.stringify(r.violations))
  assert.equal(r.violations[0].rule, 'test-skip')
})

test('a gate file outside the repo root is guarded too', () => {
  const r = scan(patch('packages/api/Makefile', '+\tpytest -q || true'))
  assert.equal(r.violations[0].rule, 'gate-tampering')
})

test('a supplied patch says plainly that untracked files went unscanned', () => {
  // --since scans them; a piped patch cannot. Silence there reads as "clean
  // round" over a brand-new file full of it.skip().
  const r = scan(patch('src/user.ts', '+const a = 1'))
  assert.equal(r.untracked_scanned, false)
  assert.ok(Array.isArray(r.notes))
})

test('line numbers point at the added line, not the hunk header', () => {
  const r = scan(patch('src/user.ts', ' const a = 1', ' const b = 2', '+// @ts-ignore'))
  assert.equal(r.violations[0].line, 12)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const SCRIPT = join(root, 'skills', 'verify', 'scripts', 'detect-gates.mjs')

function detect(fixture) {
  const out = execFileSync(process.execPath, [SCRIPT, '--cwd', join(here, 'fixtures', fixture)], {
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

const cmds = (r) => r.gates.map((g) => g.cmd)

test('npm: derives gates from scripts and skips the mutating ones', () => {
  const r = detect('npm-basic')
  assert.equal(r.packageManager, 'npm')
  assert.deepEqual(
    cmds(r).filter((c) => c.startsWith('npm run')).sort(),
    ['npm run build', 'npm run lint', 'npm run test', 'npm run test:e2e', 'npm run typecheck'].sort(),
  )
  assert.ok(!cmds(r).includes('npm run lint:fix'), 'lint:fix mutates — never a gate')
  assert.ok(!cmds(r).includes('npm run test:watch'), 'watch mode never terminates')
  assert.ok(!cmds(r).includes('npm run dev'), 'dev server is not a gate')
})

test('gates are ordered fastest-and-most-specific first', () => {
  const r = detect('npm-basic')
  const kinds = r.gates.map((g) => g.kind)
  assert.ok(kinds.indexOf('typecheck') < kinds.indexOf('test'), 'typecheck before test')
  assert.ok(kinds.indexOf('test') < kinds.indexOf('e2e'), 'unit before e2e')
})

test('e2e is non-blocking by default, unit tests are blocking', () => {
  const r = detect('npm-basic')
  const e2e = r.gates.find((g) => g.kind === 'e2e')
  const unit = r.gates.find((g) => g.kind === 'test')
  assert.equal(e2e.blocking, false)
  assert.equal(unit.blocking, true)
})

test('pnpm: reads packageManager, flags the monorepo, and mines the CI workflow', () => {
  const r = detect('pnpm-turbo')
  assert.equal(r.packageManager, 'pnpm')
  assert.ok(cmds(r).includes('pnpm run typecheck'))
  assert.ok(
    r.notes.some((n) => /monorepo/i.test(n)),
    'a root-only gate in a workspace repo must be flagged',
  )
  assert.deepEqual(r.ci.workflows, ['ci.yml'])
  assert.ok(
    r.ci.commands.includes('pnpm run test:contract'),
    'block-scalar run: steps must be extracted',
  )
  assert.ok(
    cmds(r).includes('pnpm run test:contract'),
    'a CI command the manifests did not reveal becomes a gate',
  )
  assert.ok(
    !r.ci.commands.some((c) => c.startsWith('pnpm install')),
    'install steps are not gates',
  )
})

test('a CI command ending in a quote keeps it', () => {
  // `node --test "tests/**/*.test.mjs"` is not a YAML-quoted string; stripping
  // its trailing quote silently produces a command that cannot run.
  const r = detect('pnpm-turbo')
  assert.ok(
    r.ci.commands.includes('node --test "tests/**/*.test.mjs"'),
    `quote eaten: ${JSON.stringify(r.ci.commands)}`,
  )
})

test('a CI step named for validation is not dropped as noise', () => {
  // The repo's own gate is often a bare script invocation with no test/lint/build
  // word in it. Missing it is the silent-cap failure: a gate nobody runs.
  const r = detect('pnpm-turbo')
  assert.ok(
    r.ci.commands.includes('node scripts/validate-skills.mjs'),
    `validator dropped: ${JSON.stringify(r.ci.commands)}`,
  )
})

test('a shell continuation in a block scalar is one command, not three fragments', () => {
  // Splitting it per physical line promotes `pnpm exec playwright test \` to a
  // blocking gate — a fabricated failure on a healthy repo, and gate failures
  // are machine truth that no skeptic reviews.
  const r = detect('pnpm-turbo')
  assert.ok(
    r.ci.commands.includes('pnpm exec playwright test --reporter=list --project=chromium'),
    `continuation not joined: ${JSON.stringify(r.ci.commands)}`,
  )
  assert.ok(
    !r.ci.commands.some((c) => c.endsWith('\\')),
    'no command may end in a dangling backslash',
  )
  assert.ok(
    !r.ci.commands.includes('--reporter=list'),
    'a continuation fragment is not a command',
  )
})

test('Makefile: maps targets, ignores the ones that mutate or print', () => {
  const r = detect('makefile-repo')
  assert.deepEqual(cmds(r).sort(), ['make build', 'make lint', 'make test'].sort())
})

test('pyproject: derives per-tool commands and picks up the uv prefix', () => {
  const r = detect('pyproject-repo')
  assert.deepEqual(
    cmds(r).sort(),
    ['uv run mypy .', 'uv run pytest -q', 'uv run ruff check .', 'uv run ruff format --check .'].sort(),
  )
})

test("the repo's own aggregate gate is detected without a CI workflow to reveal it", () => {
  // `check` and `validate` are how a repo most often names the command that
  // defines green. Deriving them only from a CI workflow means a repo without
  // one reports its main gate as absent.
  const r = detect('aggregate-check')
  assert.ok(cmds(r).includes('npm run check'), `check dropped: ${JSON.stringify(cmds(r))}`)
  assert.ok(cmds(r).includes('npm run validate'))
  assert.ok(!cmds(r).includes('npm run check:fix'), 'a :fix variant mutates — never a gate')
  assert.ok(!cmds(r).includes('npm run start'), 'a server is not a gate')
  assert.equal(r.ci.workflows.length, 0, 'this fixture has no CI — the gates come from scripts')
})

test("an aggregate gate gets the combined budget, not a single gate's", () => {
  const r = detect('aggregate-check')
  assert.equal(r.gates.find((g) => g.cmd === 'npm run check').timeout_s, 600)
  assert.equal(r.gates.find((g) => g.cmd === 'npm run test').timeout_s, 300)
})

test('an empty directory yields no gates and says so', () => {
  const r = detect('.')
  assert.equal(r.gates.length, 0)
  assert.ok(r.notes.some((n) => /no verification command/i.test(n)))
})

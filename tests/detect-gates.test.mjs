import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  assert.ok(!cmds(r).includes('npm run check:fix'), 'a :fix variant mutates — never a gate')
  assert.ok(!cmds(r).includes('npm run start'), 'a server is not a gate')
  assert.equal(r.ci.workflows.length, 0, 'this fixture has no CI — the gates come from scripts')
})

test('a gate the aggregate already runs is run once, inside it', () => {
  // check = `npm run validate && npm test`: running all three runs the
  // validator twice and the tests twice, for no extra proof.
  const r = detect('aggregate-check')
  assert.deepEqual(cmds(r), ['npm run check'])
  assert.ok(r.notes.some((n) => /^2 gate\(s\) skipped.*npm run validate, npm run test\.$/.test(n)), JSON.stringify(r.notes))
  assert.deepEqual(cmds(detect('concurrently')), ['npm run check'], 'npm:lint and npm:typecheck run inside check')
})

test('a CI step that is the body of a covered script is dropped too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detect-ci-'))
  try {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test', 'ver-check': 'node v.mjs --check', check: 'npm test && npm run ver-check' } }),
    )
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'jobs:\n  t:\n    steps:\n      - run: node --test\n      - run: node v.mjs --check\n      - run: npm run lint:strict\n')
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--cwd', dir], { encoding: 'utf8' }))
    assert.deepEqual(cmds(out), ['npm run check', 'npm run lint:strict'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a shell comment in a CI block is not a gate, and a bash test suite or shellcheck is one', () => {
  // A comment that mentions "test" became the only gate of a shell repo: it
  // exits 0 when run, so verify said PASS while the real suite never ran.
  const dir = mkdtempSync(join(tmpdir(), 'detect-ci-'))
  try {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      [
        'jobs:',
        '  t:',
        '    steps:',
        '      - run: |',
        '          sudo apt-get install -y jq shellcheck',
        '          # Decimal-comma locale: the suite runs every test under it too',
        '          sudo locale-gen fr_FR.UTF-8',
        '      - run: shellcheck -s bash -S warning script.sh tests/run.sh',
        '      - run: bash tests/run.sh',
        '',
      ].join('\n'),
    )
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--cwd', dir], { encoding: 'utf8' }))
    assert.deepEqual(cmds(out), ['shellcheck -s bash -S warning script.sh tests/run.sh', 'bash tests/run.sh'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function detectCi(files) {
  const dir = mkdtempSync(join(tmpdir(), 'detect-ci-'))
  try {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    for (const [name, yaml] of Object.entries(files)) writeFileSync(join(dir, '.github', 'workflows', name), yaml)
    return JSON.parse(execFileSync(process.execPath, [SCRIPT, '--cwd', dir], { encoding: 'utf8' }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a shell if-block in CI is never split into gates, and says it was skipped', () => {
  // Run alone, `if node check …; then` is a syntax error: a failure the repo does not have.
  const r = detectCi({
    'ci.yml': [
      'on: [push]',
      'jobs:',
      '  t:',
      '    steps:',
      '      - run: |',
      '          node scripts/x.mjs render --out /tmp/s',
      '          if node scripts/x.mjs check --out /tmp/s; then',
      '            echo "::error::check accepted it"',
      '            exit 1',
      '          fi',
      '          node scripts/x.mjs check --out assets/example',
      '',
    ].join('\n'),
  })
  assert.deepEqual(cmds(r), ['node scripts/x.mjs check --out assets/example'])
  assert.ok(r.notes.some((n) => /1 shell block\(s\) with if\/for\/while\/case/.test(n)), JSON.stringify(r.notes))
})

test('a shell test builtin is not a gate', () => {
  const r = detectCi({ 'ci.yml': 'on: push\njobs:\n  t:\n    steps:\n      - run: test -f /tmp/demo/SRD.json\n      - run: test ! -e dist/docker\n      - run: "[ -d references ]"\n      - run: npm test\n' })
  assert.deepEqual(cmds(r), ['npm test'])
})

test('setup steps are not gates: file copies and installs, even with options', () => {
  const r = detectCi({
    'ci.yml': 'on: push\njobs:\n  t:\n    steps:\n      - run: cp tests/fixtures/brief.json /tmp/s/brief.json\n      - run: npm --prefix ui install --no-audit\n      - run: sudo apt-get install -y shellcheck\n      - run: npm --prefix ui run test -- --run\n',
  })
  assert.deepEqual(cmds(r), ['npm --prefix ui run test -- --run'])
})

test('a CI step that needs the GitHub runner is skipped, and a script alias runs once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detect-ci-'))
  try {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc' } }))
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      'on: push\njobs:\n  t:\n    steps:\n      - run: node x.mjs check --out "$RUNNER_TEMP/run18"\n      - run: pnpm test\n      - run: pnpm typecheck\n',
    )
    const r = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--cwd', dir], { encoding: 'utf8' }))
    assert.deepEqual(cmds(r).sort(), ['pnpm run test', 'pnpm run typecheck'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('only workflows that run on push or pull_request define green', () => {
  const r = detectCi({
    'ci.yml': 'on:\n  pull_request:\n    branches: [main]\njobs:\n  t:\n    steps:\n      - run: npm test\n',
    'refresh.yml': 'on:\n  schedule:\n    - cron: "0 3 * * *"\n  workflow_dispatch:\njobs:\n  r:\n    steps:\n      - run: uv run crible check-coverage --min-priced 70\n',
  })
  assert.deepEqual(cmds(r), ['npm test'])
  assert.deepEqual(r.ci.workflows, ['ci.yml'])
})

test("an aggregate gate gets the combined budget, not a single gate's", () => {
  const r = detect('aggregate-check')
  assert.equal(r.gates.find((g) => g.cmd === 'npm run check').timeout_s, 600)
  assert.equal(detect('npm-basic').gates.find((g) => g.cmd === 'npm run test').timeout_s, 300)
})

test('a concurrently-based aggregate check is a gate; a concurrently-based dev server is not', () => {
  // Denying every body that mentions `concurrently` dropped the one script a
  // repo author most often uses to define green. What makes a body a dev
  // server is the server.
  const r = detect('concurrently')
  assert.ok(cmds(r).includes('npm run check'), `check dropped: ${JSON.stringify(cmds(r))}`)
  assert.ok(!cmds(r).includes('npm run dev'), 'a dev server is not a gate')
})

test('an empty directory yields no gates and says so', () => {
  const r = detect('.')
  assert.equal(r.gates.length, 0)
  assert.ok(r.notes.some((n) => /no verification command/i.test(n)))
})

// --run executes the gates. Always against a throwaway repo: run against this
// one, `npm test` would run this very file again.
function runIn(scripts) {
  const dir = mkdtempSync(join(tmpdir(), 'detect-run-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts }))
  writeFileSync(join(dir, 'package-lock.json'), '{}')
  const r = spawnSync(process.execPath, [SCRIPT, '--cwd', dir, '--run'], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  return { exit: r.status, out: JSON.parse(r.stdout), raw: r.stdout }
}

test('--run: a gate that rewrites a tracked file is named in a note; an untouched repo gets none', () => {
  // An install run as a gate rewrote a lockfile, and the next gate failed on it.
  const dir = mkdtempSync(join(tmpdir(), 'detect-run-'))
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' })
  try {
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    writeFileSync(join(dir, 'lock.txt'), 'v1\n')
    const pkg = (test) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: { test } }))
    pkg('node -e ""')
    git('init', '-q')
    git('add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')
    const run = () => JSON.parse(spawnSync(process.execPath, [SCRIPT, '--cwd', dir, '--run'], { encoding: 'utf8' }).stdout)
    assert.equal(run().notes, undefined)
    pkg(`node -e "require('fs').writeFileSync('lock.txt','v2')"`)
    git('add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'mutating gate')
    assert.ok(run().notes.some((n) => /The gates modified tracked files: lock\.txt/.test(n)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--run: all gates green is ok, exit 0, one compact line with no output kept', () => {
  const r = runIn({ test: 'node -e "console.log(1)"', lint: 'node -e ""' })
  assert.equal(r.exit, 0)
  assert.equal(r.out.ok, true)
  assert.deepEqual(r.out.gates.map((g) => [g.cmd, g.exit, g.out]), [['npm run lint', 0, undefined], ['npm run test', 0, undefined]])
  assert.equal(r.raw.trim().split('\n').length, 1)
})

test('--run: a failing blocking gate is not ok, exits 1, and keeps at most 10 lines', () => {
  const r = runIn({ test: `node -e "for (let i = 0; i < 30; i++) console.log('line ' + i); process.exit(3)"` })
  assert.equal(r.exit, 1)
  assert.equal(r.out.ok, false)
  const [gate] = r.out.gates
  assert.equal(gate.exit, 3)
  assert.ok(gate.out.split('\n').length <= 10)
  assert.match(gate.out, /line 29/)
})

test('--run: a failing non-blocking gate is reported but does not sink ok', () => {
  const r = runIn({ test: 'node -e ""', 'test:e2e': 'node -e "process.exit(1)"' })
  assert.equal(r.exit, 0)
  assert.equal(r.out.ok, true)
  assert.equal(r.out.gates.find((g) => g.cmd === 'npm run test:e2e').blocking, false)
})

test('--run: no gate at all is ok null — nothing was proven', () => {
  const r = runIn({})
  assert.equal(r.exit, 0)
  assert.equal(r.out.ok, null)
  assert.deepEqual(r.out.gates, [])
})

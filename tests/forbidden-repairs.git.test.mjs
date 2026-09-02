// The guard's real job is to inspect what a fix round produced. `git diff`
// alone cannot see a file the round created, so these tests run against a real
// throwaway repository rather than a synthetic patch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const SCRIPT = join(root, 'skills', 'verify', 'scripts', 'forbidden-repairs.mjs')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-guard-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  return dir
}

function guard(dir, ...extra) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--since', 'HEAD', ...extra], {
      cwd: dir,
      encoding: 'utf8',
    })
    return { exitCode: 0, ...JSON.parse(stdout) }
  } catch (err) {
    return { exitCode: err.status, ...JSON.parse(err.stdout) }
  }
}

test('--since sees a modification to a tracked file', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1\n// @ts-ignore\n')
    const r = guard(dir)
    assert.equal(r.verdict, 'FORBIDDEN')
    assert.equal(r.violations[0].rule, 'suppression')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a suppression smuggled into a BRAND-NEW file is still caught', () => {
  // git diff shows nothing for an untracked path. A fix round that creates
  // `tests/regression.test.mjs` full of it.skip() would otherwise pass clean.
  const dir = repo()
  try {
    mkdirSync(join(dir, 'tests'))
    writeFileSync(
      join(dir, 'tests', 'regression.test.mjs'),
      'it.skip("the failing case", () => {})\n',
    )
    const r = guard(dir)
    assert.equal(r.verdict, 'FORBIDDEN', 'untracked file bypassed the guard')
    assert.equal(r.violations[0].rule, 'test-skip')
    assert.equal(r.violations[0].file, 'tests/regression.test.mjs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an honest new file passes', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'src', 'limiter.ts'), 'export const limit = 5\n')
    const r = guard(dir)
    assert.equal(r.verdict, 'CLEAN')
    assert.equal(r.exitCode, 0)
    assert.ok(r.files_changed.includes('src/limiter.ts'), 'new file must still be reported as changed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('gitignored files are not scanned', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'dep.ts'), 'const x = y as any\n')
    const r = guard(dir)
    assert.ok(
      !r.files_changed.some((f) => f.startsWith('node_modules/')),
      'ignored paths must stay out of the scan',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unresolvable ref fails loudly instead of reporting CLEAN', () => {
  const dir = repo()
  try {
    const r = (() => {
      try {
        const stdout = execFileSync(process.execPath, [SCRIPT, '--since', 'no-such-ref'], {
          cwd: dir,
          encoding: 'utf8',
          stdio: 'pipe',
        })
        return { exitCode: 0, stdout }
      } catch (err) {
        return { exitCode: err.status, stdout: err.stdout || '', stderr: String(err.stderr || '') }
      }
    })()
    assert.notEqual(r.exitCode, 0, 'a broken baseline must never look like a clean round')
    assert.ok(!/"verdict":"CLEAN"/.test(r.stdout))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const PKG = (scripts, deps) =>
  JSON.stringify({ name: 'x', version: '1.0.0', scripts, devDependencies: deps }, null, 2) + '\n'

test('a gate script rewritten deep inside a long scripts block is refused', () => {
  // The hunk starts ten lines inside "scripts", so its opener is elided from
  // the patch. --since reads the working-tree file and places the line.
  const dir = repo()
  try {
    const scripts = {}
    for (let i = 0; i < 12; i++) scripts[`task${i}`] = `echo ${i}`
    scripts.test = 'vitest run'
    writeFileSync(join(dir, 'package.json'), PKG(scripts, { vitest: '^1.0.0' }))
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'pkg')
    writeFileSync(join(dir, 'package.json'), PKG({ ...scripts, test: 'echo skipped' }, { vitest: '^1.0.0' }))
    const r = guard(dir)
    assert.equal(r.verdict, 'FORBIDDEN', JSON.stringify(r))
    assert.equal(r.violations[0].rule, 'gate-tampering')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a dependency added far from the scripts opener is not gate tampering', () => {
  const dir = repo()
  try {
    const scripts = { test: 'vitest run' }
    const deps = {}
    for (let i = 0; i < 12; i++) deps[`dep${i}`] = '^1.0.0'
    writeFileSync(join(dir, 'package.json'), PKG(scripts, deps))
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'pkg')
    writeFileSync(join(dir, 'package.json'), PKG(scripts, { ...deps, testcontainers: '^10.0.0' }))
    const r = guard(dir)
    assert.equal(r.verdict, 'CLEAN', JSON.stringify(r.violations))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('git mv of a workflow file is caught as a rename', () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'on: push\njobs: {}\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'ci')
    git(dir, 'mv', '.github/workflows/ci.yml', '.github/workflows/ci.yml.disabled')
    const r = guard(dir)
    assert.equal(r.verdict, 'FORBIDDEN', JSON.stringify(r))
    assert.ok(r.violations.some((v) => v.rule === 'gate-tampering'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an untracked binary file is noted, not scanned', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'src', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]))
    const r = guard(dir)
    assert.equal(r.verdict, 'CLEAN')
    assert.ok(!r.files_changed.includes('src/logo.png'), 'a binary must not be reported as scanned')
    assert.ok(r.notes.some((n) => /logo\.png/.test(n) && /binary/.test(n)), JSON.stringify(r.notes))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a large untracked file is scanned in-process, without one git spawn per file', () => {
  // `git diff --no-index` costs a process per untracked path. A round that
  // scaffolds a package would spawn git hundreds of times to read what
  // readFileSync already knows. The patch is synthesised instead.
  const dir = repo()
  try {
    const lines = Array.from({ length: 3000 }, (_, i) => `export const v${i} = ${i}`)
    lines[2500] = 'const x = y as any'
    writeFileSync(join(dir, 'src', 'big.ts'), lines.join('\n') + '\n')
    const r = guard(dir)
    assert.equal(r.verdict, 'FORBIDDEN')
    assert.equal(r.violations[0].file, 'src/big.ts')
    assert.equal(r.violations[0].line, 2501, 'line numbers must be true in a synthesised patch')
    assert.ok(
      !readFileSync(SCRIPT, 'utf8').includes("'--no-index'"),
      'the guard must not spawn git per untracked file',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

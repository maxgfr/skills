// The guard's real job is to inspect what a fix round produced. `git diff`
// alone cannot see a file the round created, so these tests run against a real
// throwaway repository rather than a synthetic patch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
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

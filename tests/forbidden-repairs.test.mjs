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
  const r = scan(patch('package.json', '+    "test": "echo skipped",'))
  assert.equal(r.violations[0].rule, 'gate-tampering')
})

test('editing the plan to match the code is refused when the plan is named', () => {
  const r = scan(patch('docs/plan.md', '+ ~~rate-limit the endpoint~~ (dropped)'), [
    '--plan',
    'docs/plan.md',
  ])
  assert.equal(r.violations[0].rule, 'spec-rewrite')
})

test('an empty catch is refused', () => {
  const r = scan(patch('src/user.ts', '+try { risky() } catch (e) {}'))
  assert.equal(r.violations[0].rule, 'error-swallow')
})

test('line numbers point at the added line, not the hunk header', () => {
  const r = scan(patch('src/user.ts', ' const a = 1', ' const b = 2', '+// @ts-ignore'))
  assert.equal(r.violations[0].line, 12)
})

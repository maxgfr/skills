// peer-build.mjs, exercised against fake `codex` and `claude` binaries on PATH.
// The two things worth proving: the peer can write to the worktree and nothing
// else, and what it wrote is measured from the worktree rather than believed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { parseArgs, buildInvocation, buildPrompt, touchedSince, main } = await import(
  join(root, 'skills/build/scripts/peer-build.mjs')
)
const PLAN = readFileSync(join(root, 'tests/fixtures/plans/approved.md'), 'utf8')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

function worktree() {
  const dir = mkdtempSync(join(tmpdir(), 'peer-build-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  mkdirSync(join(dir, 'docs', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'plans', 'plan.md'), PLAN)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  return dir
}

function fakeCli(binDir, name, body) {
  const file = join(binDir, name)
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`)
  chmodSync(file, 0o755)
}

function withPath(binDir, fn) {
  const saved = process.env.PATH
  process.env.PATH = `${binDir}:${saved}`
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = saved
  })
}

const BASE = (dir, host = 'claude') => [
  '--host', host, '--cwd', dir, '--plan', 'docs/plans/plan.md', '--step', 'S-001', '--out', join(dir, '.agents', 'build', 'peer'),
]

// ------------------------------------------------------------------ arguments

test('parseArgs needs a host, a worktree, a plan, a step id and an out dir', () => {
  const cfg = parseArgs(['--host', 'codex', '--cwd', '/wt', '--plan', 'p.md', '--step', 'S-002', '--out', 'o'])
  assert.equal(cfg.peer, 'claude')
  assert.equal(cfg.timeoutMs, 900_000)
  assert.throws(() => parseArgs(['--host', 'claude', '--cwd', '/wt', '--plan', 'p.md', '--step', 'two', '--out', 'o']), /S-xxx/)
  assert.throws(() => parseArgs(['--host', 'claude', '--cwd', '/wt', '--plan', 'p.md', '--step', 'S-001']), /--out/)
  assert.throws(() => parseArgs(['--host', 'gemini', '--cwd', '/wt', '--plan', 'p.md', '--step', 'S-001', '--out', 'o']), /--host/)
})

// -------------------------------------------------------------- the two CLIs

test('the codex invocation writes to the workspace and takes the prompt on stdin', () => {
  const { command, argv } = buildInvocation({ peer: 'codex', cwd: '/wt', lastMessagePath: '/out/m.txt' })
  assert.equal(command, 'codex')
  assert.equal(argv[argv.indexOf('--sandbox') + 1], 'workspace-write')
  assert.equal(argv[argv.indexOf('--cd') + 1], '/wt')
  assert.equal(argv.at(-1), '-')
})

test('the claude invocation accepts edits and can run the Verify command, headless', () => {
  const { command, argv } = buildInvocation({ peer: 'claude', cwd: '/wt', lastMessagePath: '/out/m.txt' })
  assert.equal(command, 'claude')
  assert.ok(argv.includes('-p'))
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'acceptEdits')
  assert.match(argv[argv.indexOf('--allowedTools') + 1], /\bBash\b/)
  assert.ok(argv.includes('--no-session-persistence'))
})

// Both directions, per AGENTS.md: the write grant is there, and nothing wider.
test('neither invocation carries a flag that bypasses approval, widens the sandbox, or reaches outside the worktree', () => {
  const forbidden = [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    '--full-auto',
    'danger-full-access',
    'bypassPermissions',
    'dontAsk',
    '--add-dir',
  ]
  for (const peer of ['codex', 'claude']) {
    const { argv } = buildInvocation({ peer, cwd: '/wt', lastMessagePath: '/out/m.txt' })
    for (const flag of forbidden) assert.ok(!argv.includes(flag), `${peer} argv carries ${flag}`)
  }
})

test('a model is passed through only when one was asked for', () => {
  assert.ok(!buildInvocation({ peer: 'codex', cwd: '/wt', lastMessagePath: '/m' }).argv.includes('--model'))
  const with_ = buildInvocation({ peer: 'claude', cwd: '/wt', lastMessagePath: '/m', model: 'sonnet' })
  assert.equal(with_.argv[with_.argv.indexOf('--model') + 1], 'sonnet')
})

// ------------------------------------------------------------------ the brief

test('the prompt carries the step verbatim, the Verify command, and the forbidden list', () => {
  const step = { id: 'S-001', raw: '### S-001 — Add the bucket\n- **Verify:** `npx vitest run` → 3 passed', verifyCmd: 'npx vitest run', verifyExpected: '3 passed' }
  const p = buildPrompt({ cwd: '/wt', planPath: 'docs/plans/plan.md', step })
  assert.ok(p.includes(step.raw))
  assert.ok(p.includes('npx vitest run'))
  assert.ok(p.includes('YOU MAY NOT'))
  assert.ok(p.includes('Do not commit'))
})

test('touchedSince reports new files and modified ones, not files an earlier step left', () => {
  const dir = mkdtempSync(join(tmpdir(), 'peer-touched-'))
  try {
    writeFileSync(join(dir, 'old.ts'), 'a')
    const before = new Map([['old.ts', 1]]) // a fake old mtime: any real stat differs
    writeFileSync(join(dir, 'new.ts'), 'b')
    const touched = touchedSince(new Map([['old.ts', 1]]), dir, ['old.ts', 'new.ts'])
    assert.deepEqual(touched.sort(), ['new.ts', 'old.ts'])
    const untouched = touchedSince(new Map([['old.ts', before.get('old.ts')]]), dir, ['old.ts'])
    assert.deepEqual(untouched, ['old.ts'], 'a different mtime is a touch')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- end to end

test('a peer that writes a file has that file measured from the worktree', async () => {
  const dir = worktree()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  // host claude → peer codex. The fake writes one file and a last message.
  fakeCli(bin, 'codex', `
const fs = require('fs')
const path = require('path')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
const cwd = a[a.indexOf('--cd') + 1]
fs.mkdirSync(path.join(cwd, 'src', 'limit'), { recursive: true })
fs.writeFileSync(path.join(cwd, 'src', 'limit', 'bucket.ts'), 'export const take = () => true\\n')
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], 'src/limit/bucket.ts\\nexit 0\\n3 passed')
`)
  try {
    const res = await withPath(bin, () => main(BASE(dir)))
    assert.equal(res.status, 'ok', JSON.stringify(res))
    assert.deepEqual(res.files_touched, ['src/limit/bucket.ts'])
    assert.equal(res.blocked_claimed, false)
    assert.match(res.last_message, /3 passed/)
    assert.ok(readFileSync(res.prompt, 'utf8').includes('### S-001'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a peer that says BLOCKED BY is surfaced, and its files are still measured', async () => {
  const dir = worktree()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], 'BLOCKED BY: the plan cites src/api/router.ts:12 but that file has 4 lines')
`)
  try {
    const res = await withPath(bin, () => main(BASE(dir)))
    assert.equal(res.status, 'ok')
    assert.equal(res.blocked_claimed, true)
    assert.deepEqual(res.files_touched, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a peer that is not installed is unavailable with the remedy, and nothing is written', async () => {
  const dir = worktree()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const saved = process.env.PATH
  process.env.PATH = bin
  let res
  try {
    res = await main(BASE(dir))
  } finally {
    process.env.PATH = saved
  }
  try {
    assert.equal(res.status, 'peer_unavailable')
    assert.match(res.reason, /not on PATH/)
    assert.equal(res.remedy, 'install codex')
    const written = git(dir, 'status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3))
    assert.deepEqual(written.filter((f) => !f.startsWith('.agents/')), [], 'a source file was written with no peer')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a step that is not in the plan, or a plan that is not approved, never reaches the peer', async () => {
  const dir = worktree()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  let spawned = false
  fakeCli(bin, 'codex', `require('fs').writeFileSync(${JSON.stringify(join(dir, 'SPAWNED'))}, '1')`)
  try {
    const missing = await withPath(bin, () => main([...BASE(dir).slice(0, 7), 'S-009', '--out', join(dir, 'out')]))
    assert.equal(missing.status, 'peer_unavailable')
    assert.match(missing.reason, /S-009 is not a step/)
    writeFileSync(join(dir, 'docs', 'plans', 'plan.md'), PLAN.replace('status: approved', 'status: awaiting-approval'))
    const draft = await withPath(bin, () => main(BASE(dir)))
    assert.equal(draft.status, 'peer_unavailable')
    assert.match(draft.reason, /not approved/)
    spawned = readFileSync(join(dir, 'SPAWNED'), { encoding: 'utf8', flag: 'a+' }) !== ''
    assert.equal(spawned, false, 'the peer was spawned for a step it must not build')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a non-zero exit is unavailable, carries the stderr tail, and still reports what was touched', async () => {
  const dir = worktree()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const fs = require('fs')
const path = require('path')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(path.join(a[a.indexOf('--cd') + 1], 'src', 'half.ts'), 'partial')
process.stderr.write('context window exceeded')
process.exit(2)
`)
  try {
    const res = await withPath(bin, () => main(BASE(dir)))
    assert.equal(res.status, 'peer_unavailable')
    assert.match(res.reason, /exited 2/)
    assert.match(res.reason, /context window exceeded/)
    assert.deepEqual(res.files_touched, ['src/half.ts'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the claude envelope is unwrapped, and a failing subtype is unavailable', async () => {
  const dir = worktree()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'claude', `
const a = process.argv.slice(2)
if (a[0] === 'auth') process.exit(0)
process.stdout.write(JSON.stringify({ subtype: 'success', result: 'src/app.ts\\nexit 0\\nok' }))
`)
  try {
    const ok = await withPath(bin, () => main(BASE(dir, 'codex')))
    assert.equal(ok.status, 'ok', JSON.stringify(ok))
    assert.match(ok.last_message, /exit 0/)
    fakeCli(bin, 'claude', `
const a = process.argv.slice(2)
if (a[0] === 'auth') process.exit(0)
process.stdout.write(JSON.stringify({ subtype: 'error_max_turns' }))
`)
    const bad = await withPath(bin, () => main(BASE(dir, 'codex')))
    assert.equal(bad.status, 'peer_unavailable')
    assert.match(bad.reason, /error_max_turns/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

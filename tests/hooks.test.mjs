// The two hooks are what make the skills automatic. Each is run the way the
// host runs it — as a process, JSON on stdin — against a throwaway repository,
// so every way the guard could nag when it should not, or stay silent when it
// should not, is a scenario here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const STOP = join(root, 'hooks', 'stop-guard.mjs')
const START = join(root, 'hooks', 'session-start.mjs')
const ROUTER = join(root, 'hooks', 'router.md')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'stop-guard-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'README.md'), '# x\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  return dir
}

// Every run gets its own state dir and HOME so no marker or config leaks
// between scenarios.
function stop(dir, input = {}, envExtra = {}) {
  const state = mkdtempSync(join(tmpdir(), 'stop-guard-state-'))
  const home = mkdtempSync(join(tmpdir(), 'stop-guard-home-'))
  const env = { ...process.env, MAXGFR_STOP_GUARD_STATE_DIR: state, HOME: home, ...envExtra }
  delete env.MAXGFR_NO_STOP_GUARD
  Object.assign(env, envExtra)
  const started = Date.now()
  const stdout = execFileSync(process.execPath, [STOP], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-1', cwd: dir, stop_hook_active: false, ...input }),
    encoding: 'utf8',
    env,
  })
  return { out: stdout.trim() ? JSON.parse(stdout) : null, ms: Date.now() - started, state, home }
}

const touchSource = (dir) => writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 2\n')

function report(dir, when) {
  const run = join(dir, '.agents', 'verify', '20260101-000000')
  mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'REPORT.md'), 'VERDICT: PASS\n')
  utimesSync(run, when, when)
}

test('a clean tree ends the turn silently', () => {
  const dir = repo()
  try {
    assert.equal(stop(dir).out, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('modified source with no verify report blocks, with the reason and both output shapes', () => {
  const dir = repo()
  try {
    touchSource(dir)
    const { out } = stop(dir)
    assert.ok(out, 'the turn was allowed to end over unverified source')
    assert.equal(out.decision, 'block')
    assert.match(out.reason, /verify/)
    assert.equal(out.hookSpecificOutput.hookEventName, 'Stop')
    assert.equal(out.hookSpecificOutput.decision, 'block')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a verify report newer than the change lets the turn end; an older one does not', () => {
  const dir = repo()
  try {
    touchSource(dir)
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'src', 'app.ts'), past, past)
    report(dir, new Date())
    assert.equal(stop(dir).out, null, 'a fresh report was not honoured')
    const older = new Date(Date.now() - 120_000)
    utimesSync(join(dir, '.agents', 'verify', '20260101-000000'), older, older)
    assert.equal(stop(dir).out?.decision, 'block', 'a stale report was taken as proof')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a new untracked source file counts as a change', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const b = 1\n')
    assert.equal(stop(dir).out?.decision, 'block')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('changes to plans, reports and prose alone never block', () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, 'docs', 'plans'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'plans', '2026-01-01-x.md'), '---\nstatus: approved\n---\n')
    writeFileSync(join(dir, 'README.md'), '# changed\n')
    writeFileSync(join(dir, 'CHANGELOG'), 'v1\n')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'settings.local.json'), '{}')
    assert.equal(stop(dir).out, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stop_hook_active means the guard already spoke — it stays silent', () => {
  const dir = repo()
  try {
    touchSource(dir)
    assert.equal(stop(dir, { stop_hook_active: true }).out, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the environment opt-out and both config opt-outs are honoured', () => {
  const dir = repo()
  try {
    touchSource(dir)
    assert.equal(stop(dir, {}, { MAXGFR_NO_STOP_GUARD: '1' }).out, null)

    mkdirSync(join(dir, '.agents'), { recursive: true })
    writeFileSync(join(dir, '.agents', 'verify.json'), JSON.stringify({ stop_guard: false }))
    assert.equal(stop(dir).out, null, 'repo config opt-out ignored')
    rmSync(join(dir, '.agents'), { recursive: true, force: true })

    const home = mkdtempSync(join(tmpdir(), 'stop-guard-home-'))
    mkdirSync(join(home, '.claude'))
    writeFileSync(join(home, '.claude', 'verify.json'), JSON.stringify({ stop_guard: false }))
    assert.equal(stop(dir, {}, { HOME: home }).out, null, 'user config opt-out ignored')

    // and a config that says something else is not an opt-out
    writeFileSync(join(home, '.claude', 'verify.json'), JSON.stringify({ tier: 'deep' }))
    assert.equal(stop(dir, {}, { HOME: home }).out?.decision, 'block')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the Codex user config opt-out is honoured only on the Codex path', () => {
  const dir = repo()
  const codexHome = mkdtempSync(join(tmpdir(), 'stop-guard-codex-'))
  try {
    touchSource(dir)
    writeFileSync(join(codexHome, 'verify.json'), JSON.stringify({ stop_guard: false }))
    assert.equal(stop(dir, {}, { PLUGIN_ROOT: root, CODEX_HOME: codexHome }).out, null)
    assert.equal(
      stop(dir, {}, { CLAUDE_PLUGIN_ROOT: root, CODEX_HOME: codexHome }).out?.decision,
      'block',
      'Claude must not consume the Codex user config merely because Codex is installed',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(codexHome, { recursive: true, force: true })
  }
})

test('stop guard config uses resolver precedence, including VERIFY_CONFIG', () => {
  const dir = repo()
  const codexHome = mkdtempSync(join(tmpdir(), 'stop-guard-codex-'))
  const explicit = join(codexHome, 'explicit.json')
  try {
    touchSource(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    mkdirSync(join(dir, '.agents'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'verify.json'), JSON.stringify({ stop_guard: false }))
    writeFileSync(join(dir, '.agents', 'verify.json'), JSON.stringify({ stop_guard: true }))
    assert.equal(
      stop(dir, {}, { PLUGIN_ROOT: root, CODEX_HOME: codexHome }).out?.decision,
      'block',
      'portable repo true must override legacy false',
    )

    writeFileSync(join(dir, '.agents', 'verify.json'), JSON.stringify({ tier: 'light' }))
    writeFileSync(explicit, JSON.stringify({ stop_guard: false }))
    assert.equal(
      stop(dir, {}, { PLUGIN_ROOT: root, CODEX_HOME: codexHome, VERIFY_CONFIG: explicit }).out,
      null,
      'VERIFY_CONFIG was omitted from stop-guard resolution',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(codexHome, { recursive: true, force: true })
  }
})

test('outside a git repository the guard has nothing to say', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop-guard-nogit-'))
  try {
    writeFileSync(join(dir, 'app.ts'), 'x')
    assert.equal(stop(dir).out, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the guard blocks once per session, then lets the turn end', () => {
  const dir = repo()
  try {
    touchSource(dir)
    const first = stop(dir)
    assert.equal(first.out?.decision, 'block')
    const env = { MAXGFR_STOP_GUARD_STATE_DIR: first.state, HOME: first.home }
    const second = execFileSync(process.execPath, [STOP], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-1', cwd: dir, stop_hook_active: false }),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    assert.equal(second.trim(), '', 'the same session was blocked twice')
    // a different session in the same state dir is blocked on its own account
    const other = execFileSync(process.execPath, [STOP], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-2', cwd: dir, stop_hook_active: false }),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    assert.equal(JSON.parse(other).decision, 'block')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the guard answers well inside the hook budget', () => {
  const dir = repo()
  try {
    touchSource(dir)
    const { ms } = stop(dir)
    assert.ok(ms < 2000, `stop-guard took ${ms}ms`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('empty stdin is not a crash, and the exit code is always 0', () => {
  const dir = repo()
  try {
    const stdout = execFileSync(process.execPath, [STOP], { input: '', encoding: 'utf8', cwd: dir })
    assert.equal(typeof stdout, 'string')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// -------------------------------------------------------------- session start

test('session-start emits the Claude Code envelope with the router byte for byte', () => {
  const stdout = execFileSync(process.execPath, [START], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, COPILOT_CLI: '' },
  })
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  const text = readFileSync(ROUTER, 'utf8')
  assert.ok(out.hookSpecificOutput.additionalContext.includes(text), 'the router was altered on the way in')
  assert.ok(!('additional_context' in out), 'two envelopes would inject twice')
})

test('session-start picks the envelope by host, and --plain prints the file itself', () => {
  const cursor = JSON.parse(
    execFileSync(process.execPath, [START], { encoding: 'utf8', env: { ...process.env, CURSOR_PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: '' } }),
  )
  assert.ok('additional_context' in cursor)
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_ROOT
  delete env.CURSOR_PLUGIN_ROOT
  const bare = JSON.parse(execFileSync(process.execPath, [START], { encoding: 'utf8', env }))
  assert.ok('additionalContext' in bare)
  const plain = execFileSync(process.execPath, [START, '--plain'], { encoding: 'utf8' })
  assert.equal(plain, readFileSync(ROUTER, 'utf8'))
})

test('session-start and Stop recovery use the active host invocation syntax', () => {
  const codexEnv = { ...process.env, PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root }
  const codex = JSON.parse(execFileSync(process.execPath, [START], { encoding: 'utf8', env: codexEnv }))
  assert.match(codex.additionalContext, /\$blueprint.*\$build.*\$verify/s)
  assert.doesNotMatch(codex.additionalContext, /Skill tool/)

  const dir = repo()
  try {
    touchSource(dir)
    const { out } = stop(dir, {}, { PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root })
    assert.match(out.reason, /\$verify/)
    assert.doesNotMatch(out.reason, /\/maxgfr:verify/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hooks.json names both hooks and every command it runs exists', () => {
  const hooks = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.match(hooks.SessionStart[0].matcher, /startup/)
  assert.match(hooks.SessionStart[0].matcher, /compact/)
  assert.ok(hooks.Stop, 'no Stop hook')
  for (const event of ['SessionStart', 'Stop']) {
    for (const h of hooks[event][0].hooks) {
      const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/.exec(h.command)
      assert.ok(m, `${event} command does not use CLAUDE_PLUGIN_ROOT`)
      readFileSync(join(root, m[1]))
    }
  }
})

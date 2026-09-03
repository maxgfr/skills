import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configCandidates,
  parseInvocation,
  resolveConfig,
} from '../skills/verify/scripts/resolve-config.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verify-config-'))
  const repo = join(root, 'repo')
  const home = join(root, 'home')
  const codex = join(root, 'codex')
  mkdirSync(repo)
  mkdirSync(home)
  mkdirSync(codex)
  return { root, repo, home, codex }
}

function json(path, value) {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

test('config candidates use the active host path and keep repo legacy before portable', () => {
  const { root, repo, home, codex } = fixture()
  try {
    assert.deepEqual(configCandidates({ cwd: repo, host: 'codex', env: { HOME: home, CODEX_HOME: codex } }), [
      join(codex, 'verify.json'),
      join(repo, '.claude', 'verify.json'),
      join(repo, '.agents', 'verify.json'),
    ])
    assert.deepEqual(configCandidates({ cwd: repo, host: 'claude', env: { HOME: home } }), [
      join(home, '.claude', 'verify.json'),
      join(repo, '.claude', 'verify.json'),
      join(repo, '.agents', 'verify.json'),
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolver deep-merges every layer in documented precedence order', () => {
  const { root, repo, home, codex } = fixture()
  const explicit = join(root, 'explicit.json')
  try {
    json(explicit, { tier: 'normal', loop: { max_iterations: 2 }, gates: { extra: ['env'] } })
    json(join(codex, 'verify.json'), { loop: { fix_severity: 'major' }, gates: { extra: ['user'] } })
    json(join(repo, '.claude', 'verify.json'), { judges: { panel: 2 }, gates: { extra: ['legacy'] } })
    json(join(repo, '.agents', 'verify.json'), { judges: { panel_blocking: 2 }, gates: { extra: ['portable'] } })
    const out = resolveConfig({
      cwd: repo,
      host: 'codex',
      env: { HOME: home, CODEX_HOME: codex, VERIFY_CONFIG: explicit },
      argv: ['deep', '--max-iterations', '5', '--skip', 'lint,e2e'],
    })
    assert.equal(out.tier, 'deep')
    assert.equal(out.config.loop.enabled, true)
    assert.equal(out.config.loop.fix_severity, 'major')
    assert.equal(out.config.loop.max_iterations, 5)
    assert.equal(out.config.judges.panel, 2)
    assert.equal(out.config.judges.panel_blocking, 2)
    assert.deepEqual(out.config.gates.extra, ['portable'])
    assert.deepEqual(out.config.gates.skip, ['lint', 'e2e'])
    assert.equal(out.config.lanes.behavior, 'full')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('each adjacent config layer overrides the one before it', () => {
  const { root, repo, home, codex } = fixture()
  const explicit = join(root, 'explicit.json')
  const hostFile = join(codex, 'verify.json')
  const legacy = join(repo, '.claude', 'verify.json')
  const portable = join(repo, '.agents', 'verify.json')
  const env = { HOME: home, CODEX_HOME: codex, VERIFY_CONFIG: explicit }
  try {
    json(explicit, { report: { keep_runs: 20 } })
    assert.equal(resolveConfig({ cwd: repo, host: 'codex', env }).config.report.keep_runs, 20, 'VERIFY_CONFIG must override preset')
    json(hostFile, { report: { keep_runs: 30 } })
    assert.equal(resolveConfig({ cwd: repo, host: 'codex', env }).config.report.keep_runs, 30, 'host config must override VERIFY_CONFIG')
    json(legacy, { report: { keep_runs: 40 } })
    assert.equal(resolveConfig({ cwd: repo, host: 'codex', env }).config.report.keep_runs, 40, 'legacy repo config must override host config')
    json(portable, { report: { keep_runs: 50 }, loop: { max_iterations: 4 } })
    assert.equal(resolveConfig({ cwd: repo, host: 'codex', env }).config.report.keep_runs, 50, 'portable repo config must override legacy')
    assert.equal(resolveConfig({ cwd: repo, host: 'codex', env, argv: ['--max-iterations', '5'] }).config.loop.max_iterations, 5, 'flags must override portable repo config')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('invocation parser distinguishes tiers, modes, modifiers, refs and model flags', () => {
  const parsed = parseInvocation([
    'normal', 'crosscheck', 'report', '--ref', 'light', '--behavior', 'full',
    '--panel', '3', '--finders', 'sonnet', '--model', 'fable',
    '--lanes', 'gates,defects', '--lenses', 'wiring,leftovers',
  ])
  assert.equal(parsed.tier, 'normal')
  assert.equal(parsed.mode, 'report')
  assert.equal(parsed.ref, 'light')
  assert.equal(parsed.overrides.lanes.peer, true)
  assert.equal(parsed.overrides.lanes.behavior, 'full')
  assert.equal(parsed.overrides.judges.panel_blocking, 3)
  assert.deepEqual(parsed.overrides.finders, ['wiring', 'leftovers'])
  assert.equal(parsed.overrides.models.finders, 'sonnet')
  assert.ok(Object.values(parsed.overrides.models).every((model) => model === 'fable' || model === 'sonnet'))
  assert.deepEqual(parsed.onlyLanes, ['gates', 'defects'])
})

test('a tier-like branch is a tier unless --ref makes the intent explicit', () => {
  assert.deepEqual(parseInvocation(['light']), {
    tier: 'light', mode: 'loop', ref: null, overrides: {}, onlyLanes: null,
  })
  assert.equal(parseInvocation(['--ref', 'light']).ref, 'light')
  assert.throws(() => parseInvocation(['main', 'other']), /multiple refs/)
})

test('report and crosscheck affect the concrete config rather than becoming refs', () => {
  const { root, repo, home } = fixture()
  try {
    const out = resolveConfig({ cwd: repo, host: 'claude', env: { HOME: home }, argv: ['deep', 'report', 'crosscheck'] })
    assert.equal(out.mode, 'report')
    assert.equal(out.ref, null)
    assert.equal(out.config.loop.enabled, false)
    assert.equal(out.config.lanes.peer, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('malformed configs and invalid flags fail loudly', () => {
  const { root, repo, home } = fixture()
  try {
    const broken = join(root, 'broken.json')
    writeFileSync(broken, '{')
    assert.throws(() => resolveConfig({ cwd: repo, host: 'claude', env: { HOME: home, VERIFY_CONFIG: broken } }), /invalid JSON/)
    assert.throws(() => parseInvocation(['--wat']), /unknown flag/)
    assert.throws(() => parseInvocation(['--panel', '0']), /positive integer/)
    assert.throws(() => resolveConfig({ cwd: repo, host: 'gemini', env: { HOME: home } }), /host must be/)
    assert.throws(() => parseInvocation(['--lenses', 'wiring,banana']), /unknown lenses/)
    json(join(repo, '.agents', 'verify.json'), { mystery: true })
    assert.throws(() => resolveConfig({ cwd: repo, host: 'claude', env: { HOME: home } }), /unknown config key/)
    json(join(repo, '.agents', 'verify.json'), { judges: { panel: 0 } })
    assert.throws(() => resolveConfig({ cwd: repo, host: 'claude', env: { HOME: home } }), /positive integer/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an empty invocation lens list is rejected after all layers are merged', () => {
  assert.throws(() => resolveConfig({ argv: ['--lenses', ','] }), /finders must be a non-empty array/)
})

test('CLI accepts resolver options with or without an explicit separator', () => {
  const { root, repo, home } = fixture()
  try {
    const script = join(process.cwd(), 'skills', 'verify', 'scripts', 'resolve-config.mjs')
    const env = { ...process.env, HOME: home }
    const separated = JSON.parse(execFileSync(process.execPath, [script, '--cwd', repo, '--host', 'claude', '--', 'deep'], { encoding: 'utf8', env }))
    const direct = JSON.parse(execFileSync(process.execPath, [script, '--cwd', repo, '--host', 'claude', 'deep'], { encoding: 'utf8', env }))
    assert.deepEqual(direct, separated)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

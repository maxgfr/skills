import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'scripts', 'doctor.mjs')

for (const host of ['codex', 'claude']) {
  test(`doctor reports an actionable healthy ${host} installation contract`, () => {
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--host', host, '--root', root, '--json'], { encoding: 'utf8' }))
    assert.equal(out.ok, true)
    assert.equal(out.host, host)
    assert.ok(out.checks.filter((check) => check.required).every((check) => check.ok))
    assert.equal(out.skills.length, 3)
    assert.equal(out.first_invocation, host === 'codex' ? '$blueprint' : '/maxgfr:blueprint')
    assert.match(out.config_path, host === 'codex' ? /\.codex\/verify\.json$/ : /\.claude\/verify\.json$/)
  })
}

test('doctor fails when a required plugin contract is absent', () => {
  const empty = mkdtempSync(join(tmpdir(), 'doctor-empty-'))
  try {
    const run = spawnSync(process.execPath, [SCRIPT, '--host', 'codex', '--root', empty, '--json'], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    const out = JSON.parse(run.stdout)
    assert.equal(out.ok, false)
    assert.ok(out.checks.some((check) => check.required && !check.ok))
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('doctor rejects a manifest that does not declare the host skill contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-manifest-'))
  try {
    mkdirSync(join(dir, '.codex-plugin'), { recursive: true })
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'maxgfr' }))
    writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{}], Stop: [{}] } }))
    writeFileSync(join(dir, 'hooks', 'router.md'), '# router')
    for (const skill of ['blueprint', 'build', 'verify']) {
      mkdirSync(join(dir, 'skills', skill), { recursive: true })
      writeFileSync(join(dir, 'skills', skill, 'SKILL.md'), '---\nname: x\ndescription: Use when x.\n---\n')
    }
    const run = spawnSync(process.execPath, [SCRIPT, '--host', 'codex', '--root', dir, '--json'], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    const out = JSON.parse(run.stdout)
    assert.equal(out.checks.find((check) => check.id === 'manifest').ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doctor supports text help and rejects unknown flags', () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /^Usage:/)
  const bad = spawnSync(process.execPath, [SCRIPT, '--wat'], { encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /unknown flag/i)
})

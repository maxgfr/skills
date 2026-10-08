// models.mjs is the only place a tier becomes a model and an effort, and where
// a role picks its tier. These pin the merge order, the inherit fallback, the
// refusals, and that the copy each skill ships is the same file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTiers } from '../skills/build/scripts/models.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'skills', 'build', 'scripts', 'models.mjs')
const NONE = { model: null, effort: null }
const DEFAULTS = { small: NONE, medium: NONE, large: NONE, attempts: ['small', 'small', 'medium'], review: 'medium', audit: 'large' }

function sandbox(repoConfig, userConfig) {
  const dir = mkdtempSync(join(tmpdir(), 'models-'))
  const repo = join(dir, 'repo')
  const home = join(dir, 'home')
  for (const [base, config] of [[repo, repoConfig], [home, userConfig]]) {
    mkdirSync(join(base, '.agents'), { recursive: true })
    if (config !== undefined)
      writeFileSync(join(base, '.agents', 'models.json'), typeof config === 'string' ? config : JSON.stringify(config))
  }
  return { dir, repo, home, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('no file, no host, or an unknown host keeps every default: inherit, small-small-medium, medium review, large audit', () => {
  const s = sandbox({ alpha: { small: 'a' } }, undefined)
  const empty = sandbox(undefined, undefined)
  try {
    assert.deepEqual(resolveTiers(empty.repo, 'alpha', empty.home), DEFAULTS)
    assert.deepEqual(resolveTiers(s.repo, null, s.home), DEFAULTS)
    assert.deepEqual(resolveTiers(s.repo, 'gamma', s.home), DEFAULTS)
  } finally {
    s.done()
    empty.done()
  }
})

test('a tier takes { model, effort }, or a bare string for the model alone', () => {
  const s = sandbox({ alpha: { small: { model: 'tiny', effort: 'max' }, medium: 'mid', large: { effort: 'high' } } }, undefined)
  try {
    const r = resolveTiers(s.repo, 'alpha', s.home)
    assert.deepEqual(r.small, { model: 'tiny', effort: 'max' })
    assert.deepEqual(r.medium, { model: 'mid', effort: null })
    assert.deepEqual(r.large, { model: null, effort: 'high' })
  } finally {
    s.done()
  }
})

test('the repo file overrides the user file key by key', () => {
  const s = sandbox(
    { alpha: { small: { model: 'r-s' }, attempts: ['small', 'medium'] } },
    { alpha: { small: { model: 'u-s', effort: 'max' }, medium: { model: 'u-m', effort: 'high' }, audit: 'medium' } },
  )
  try {
    const r = resolveTiers(s.repo, 'alpha', s.home)
    assert.deepEqual(r.small, { model: 'r-s', effort: null }, 'a tier is replaced whole, not merged field by field')
    assert.deepEqual(r.medium, { model: 'u-m', effort: 'high' })
    assert.deepEqual(r.attempts, ['small', 'medium'])
    assert.equal(r.audit, 'medium')
    assert.equal(r.review, 'medium')
  } finally {
    s.done()
  }
})

test('empty and "inherit" resolve to null', () => {
  const s = sandbox({ alpha: { small: '', medium: 'inherit', large: { model: 'inherit', effort: '' } } }, undefined)
  try {
    const r = resolveTiers(s.repo, 'alpha', s.home)
    assert.deepEqual([r.small, r.medium, r.large], [NONE, NONE, NONE])
  } finally {
    s.done()
  }
})

test('a typo or a bad value is an error that names the file and the key, never a silent default', () => {
  const cases = [
    ['{ nope', /models\.json is not valid JSON/],
    [{ alpha: { smal: 'x' } }, /alpha\.smal is not a known key/],
    [{ alpha: { small: { modle: 'x' } } }, /alpha\.small has an unknown key "modle"/],
    [{ alpha: { attempts: ['small', 'huge'] } }, /alpha\.attempts\[1\] must be one of small, medium, large/],
    [{ alpha: { attempts: [] } }, /non-empty list/],
    [{ alpha: { review: 'tiny' } }, /alpha\.review must be one of/],
  ]
  for (const [config, error] of cases) {
    const s = sandbox(config, undefined)
    try {
      assert.throws(() => resolveTiers(s.repo, 'alpha', s.home), error)
    } finally {
      s.done()
    }
  }
})

test('the CLI prints one compact JSON line and reads ~ from HOME', () => {
  const s = sandbox(undefined, { alpha: { small: { model: 'u-s', effort: 'max' } } })
  try {
    const run = spawnSync(process.execPath, [SCRIPT, '--cwd', s.repo, '--host', 'alpha'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: s.home, USERPROFILE: s.home },
    })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout.trim().split('\n').length, 1)
    assert.deepEqual(JSON.parse(run.stdout).small, { model: 'u-s', effort: 'max' })
  } finally {
    s.done()
  }
})

test('build and verify ship the identical models.mjs', () => {
  // Each skill must survive being installed alone, so the resolver is copied
  // rather than shared. Edit the build copy and `cp` it to verify.
  const build = readFileSync(SCRIPT, 'utf8')
  const verify = readFileSync(join(root, 'skills', 'verify', 'scripts', 'models.mjs'), 'utf8')
  assert.equal(verify, build, 'skills/verify/scripts/models.mjs drifted from skills/build/scripts/models.mjs')
})

// models.mjs is the only place a tier becomes a model name. These pin the
// lookup order, the inherit fallback, and that the copy each skill ships is
// the same file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveModels } from '../skills/build/scripts/models.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'skills', 'build', 'scripts', 'models.mjs')
const INHERIT = { small: null, medium: null, large: null }

function sandbox(repoConfig, userConfig) {
  const dir = mkdtempSync(join(tmpdir(), 'models-'))
  const repo = join(dir, 'repo')
  const home = join(dir, 'home')
  for (const [base, config] of [[repo, repoConfig], [home, userConfig]]) {
    mkdirSync(join(base, '.agents'), { recursive: true })
    if (config !== undefined)
      writeFileSync(join(base, '.agents', 'models.json'), typeof config === 'string' ? config : JSON.stringify(config))
  }
  return { dir, repo, home }
}

test('the repo file wins over the user file for the same host', () => {
  const s = sandbox({ alpha: { small: 'r-s', medium: 'r-m', large: 'r-l' } }, { alpha: { small: 'u-s', medium: 'u-m', large: 'u-l' } })
  try {
    assert.deepEqual(resolveModels(s.repo, 'alpha', s.home), { small: 'r-s', medium: 'r-m', large: 'r-l' })
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('a repo file that does not define the host falls through to the user file', () => {
  const s = sandbox({ beta: { small: 'b' } }, { alpha: { small: 'u-s', medium: 'u-m' } })
  try {
    assert.deepEqual(resolveModels(s.repo, 'alpha', s.home), { small: 'u-s', medium: 'u-m', large: null })
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('an absent tier, an empty one and "inherit" all resolve to null', () => {
  const s = sandbox({ alpha: { small: '', medium: 'inherit' } }, undefined)
  try {
    assert.deepEqual(resolveModels(s.repo, 'alpha', s.home), INHERIT)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('an unknown host, no host, or no file at all is every tier inherited', () => {
  const s = sandbox({ alpha: { small: 'a' } }, undefined)
  const empty = sandbox(undefined, undefined)
  try {
    assert.deepEqual(resolveModels(s.repo, 'gamma', s.home), INHERIT)
    assert.deepEqual(resolveModels(s.repo, null, s.home), INHERIT)
    assert.deepEqual(resolveModels(empty.repo, 'alpha', empty.home), INHERIT)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
    rmSync(empty.dir, { recursive: true, force: true })
  }
})

test('a malformed file is an error that names the file, not a silent inherit', () => {
  const s = sandbox('{ nope', undefined)
  try {
    assert.throws(() => resolveModels(s.repo, 'alpha', s.home), /models\.json is not valid JSON/)
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('the CLI prints one compact JSON line and reads ~ from HOME', () => {
  const s = sandbox(undefined, { alpha: { small: 'u-s' } })
  try {
    const run = spawnSync(process.execPath, [SCRIPT, '--cwd', s.repo, '--host', 'alpha'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: s.home, USERPROFILE: s.home },
    })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '{"small":"u-s","medium":null,"large":null}\n')
  } finally {
    rmSync(s.dir, { recursive: true, force: true })
  }
})

test('build and verify ship the identical models.mjs', () => {
  // Each skill must survive being installed alone, so the resolver is copied
  // rather than shared. A copy that drifts is two resolvers wearing one name.
  // Edit the build copy and `cp` it to verify.
  const build = readFileSync(SCRIPT, 'utf8')
  const verify = readFileSync(join(root, 'skills', 'verify', 'scripts', 'models.mjs'), 'utf8')
  assert.equal(verify, build, 'skills/verify/scripts/models.mjs drifted from skills/build/scripts/models.mjs')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'scripts/e2e-hosts.mjs')

test('both hosts cover explicit and implicit English/French selection plus nearby counter-prompts', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' }))
  assert.deepEqual(out.matrix.hosts.map((item) => item.host), ['codex', 'claude'])
  for (const host of out.matrix.hosts) {
    assert.equal(host.ok, true, JSON.stringify(host.cases))
    assert.equal(host.cases.filter((item) => item.kind === 'selection').length, 6)
    assert.equal(host.cases.filter((item) => item.kind === 'counter-prompt').length, 4)
    assert.deepEqual(new Set(host.cases.filter((item) => item.kind === 'selection').map((item) => item.language)), new Set(['en', 'fr']))
    assert.ok(host.cases.filter((item) => item.kind === 'selection').some((item) => item.explicit))
    assert.ok(host.cases.filter((item) => item.kind === 'selection').some((item) => !item.explicit))
  }
})

test('the matrix proves one refusal per public skill', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' }))
  assert.deepEqual(out.matrix.refusals.map((item) => item.skill), ['blueprint', 'build', 'verify'])
  assert.ok(out.matrix.refusals.every((item) => item.ok), JSON.stringify(out.matrix.refusals))
})

test('the three-skill fixture snapshots source, refs, worktrees and reports before and after', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' }))
  const chain = out.matrix.chain
  assert.equal(chain.ok, true, JSON.stringify(chain))
  assert.deepEqual(chain.steps.map((item) => item.skill), ['blueprint', 'build', 'verify'])
  assert.ok(chain.steps.every((item) => item.ok))
  assert.notEqual(chain.before.source, chain.after.source)
  assert.notDeepEqual(chain.before.refs, chain.after.refs)
  assert.equal(chain.before.worktrees.length, 1)
  assert.equal(chain.after.worktrees.length, 2)
  assert.deepEqual(chain.before.reports, [])
  assert.deepEqual(chain.after.reports, ['.agents/build/fixture/BUILD.md', '.agents/verify/fixture/REPORT.md'])
})

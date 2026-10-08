// The contract between the skills, pinned. Each test reads the Markdown an agent
// is handed and fails when a rule, a plan field, a removed config key, a verdict
// or a step status is missing from the file that must state it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

// The rule each implementer, reviewer and auditor is held to.
const RULE = 'skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan'

// A whole word, so `review` does not match `reviews` or `reviewer`.
const word = (w) => new RegExp(`\\b${w}\\b`)

const count = (text, needle) => text.split(needle).length - 1

test('the forbidden-change rule is stated where build, its briefs and the audit enforce it', () => {
  assert.equal(count(read('skills/build/SKILL.md'), RULE), 1, 'skills/build/SKILL.md')
  assert.equal(count(read('skills/build/references/dispatch.md'), RULE), 2, 'skills/build/references/dispatch.md')
  assert.equal(count(read('skills/verify/references/audit.md'), RULE), 1, 'skills/verify/references/audit.md')
})

test('build names every plan field the blueprint skeleton defines', () => {
  const skeleton = read('skills/blueprint/references/artifact.md')
  const fields = [...skeleton.matchAll(/^- \*\*([^*:]+):\*\*/gm)].map((m) => m[1])
  assert.deepEqual(fields, ['Files', 'Depends on', 'Change', 'Preserve', 'Verify'])
  const build = read('skills/build/SKILL.md')
  for (const field of fields) assert.match(build, word(field), field)
})

test('the removed config keys are gone, and the tiers and roles are documented in the README', () => {
  for (const file of ['skills/build/references/dispatch.md', 'skills/verify/SKILL.md', 'README.md']) {
    const text = read(file)
    assert.doesNotMatch(text, word('solo'), `solo in ${file}`)
    assert.doesNotMatch(text, word('attempts'), `attempts in ${file}`)
  }
  const readme = read('README.md')
  for (const name of ['small', 'medium', 'large', 'review', 'audit']) assert.match(readme, word(name), name)
})

test('verify names PASS, FAIL and UNPROVEN in its description and in its body', () => {
  const match = read('skills/verify/SKILL.md').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  assert.ok(match, 'skills/verify/SKILL.md opens with frontmatter')
  const description = match[1].match(/^description:\s*(.*)$/m)?.[1] ?? ''
  for (const verdict of ['PASS', 'FAIL', 'UNPROVEN']) {
    assert.match(description, word(verdict), `description: ${verdict}`)
    assert.match(match[2], word(verdict), `body: ${verdict}`)
  }
})

test('build and its dispatch brief name every step status', () => {
  const text = read('skills/build/SKILL.md') + read('skills/build/references/dispatch.md')
  for (const status of ['done', 'blocked', 'skipped', 'unproven']) assert.match(text, word(status), status)
})

// The contract between the skills, pinned. Each test reads the Markdown an agent
// is handed and fails when a rule, a plan field, a removed config key, a verdict
// or a step status is missing from the file that must state it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

// The rule build and the auditor hold the change to.
const RULE = 'skip, weaken or delete a test, change an expected value to fit, add a suppression comment, widen a type to any, swallow an error, or edit a gate, a CI file or the plan'

// A whole word, so `review` does not match `reviews` or `reviewer`.
const word = (w) => new RegExp(`\\b${w}\\b`)

const count = (text, needle) => text.split(needle).length - 1

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

test('the forbidden-change rule is stated once where build and the audit enforce it', () => {
  assert.equal(count(read('skills/build/SKILL.md'), RULE), 1, 'skills/build/SKILL.md')
  assert.equal(count(read('skills/verify/references/audit.md'), RULE), 1, 'skills/verify/references/audit.md')
})

test('build names every plan field the blueprint skeleton defines', () => {
  const skeleton = read('skills/blueprint/references/artifact.md')
  const fields = [...skeleton.matchAll(/^- \*\*([^*:]+):\*\*/gm)].map((m) => m[1])
  assert.deepEqual(fields, ['Files', 'Change', 'Verify'])
  const build = read('skills/build/SKILL.md')
  for (const field of fields) assert.match(build, word(field), field)
})

test('no models.json and no tiers, in the skills or the README', () => {
  for (const file of [...walk(join(ROOT, 'skills')), join(ROOT, 'README.md')]) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /models\.json/, `models.json in ${file}`)
    assert.doesNotMatch(text, /\btiers?\b/i, `tier in ${file}`)
  }
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

test('build names every step status', () => {
  const build = read('skills/build/SKILL.md')
  for (const status of ['done', 'blocked', 'skipped', 'unproven']) assert.match(build, word(status), status)
})

test('build repairs after verify, and verify leaves the repair to build', () => {
  assert.match(read('skills/build/SKILL.md'), word('repair'))
  assert.match(read('skills/verify/SKILL.md'), /the build skill repairs/)
})

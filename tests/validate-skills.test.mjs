// The validator's own rules, pinned. Both of these were wrong once: the cap
// was invented rather than taken from the documented listing behaviour, and the
// trigger check only accepted one phrasing, so it failed skills that route fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LISTING_CAP,
  TRIGGER,
  SKILL_LINE_BUDGET,
  extractReferences,
  validate,
} from '../scripts/validate-skills.mjs'

// A throwaway repo with one skill whose SKILL.md is `lines` long, plus
// whatever else the test writes into it.
function fixtureRepo(lines, extra = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'validate-skills-'))
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
  const body = Array.from({ length: Math.max(0, lines - 4) }, (_, i) => `line ${i + 1}`).join('\n')
  writeFileSync(
    join(dir, 'skills', 'demo', 'SKILL.md'),
    `---\nname: demo\ndescription: Demonstrates a validator rule for the tests. Use when a test needs a skill to validate.\n---\n${body}\n`,
  )
  extra(dir)
  return dir
}

test('the SKILL.md line budget is the one AGENTS.md states', () => {
  assert.equal(SKILL_LINE_BUDGET, 150)
})

test('a SKILL.md over the line budget fails; one at the budget passes', () => {
  const over = fixtureRepo(SKILL_LINE_BUDGET + 1)
  const at = fixtureRepo(SKILL_LINE_BUDGET)
  try {
    const bad = validate(over).problems
    assert.ok(bad.some((p) => /past the 150-line budget/.test(p.message)), JSON.stringify(bad))
    assert.deepEqual(validate(at).problems, [])
  } finally {
    rmSync(over, { recursive: true, force: true })
    rmSync(at, { recursive: true, force: true })
  }
})

test('a hooks.json whose command does not exist fails; one whose command exists passes', () => {
  const hooks = (script) =>
    JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"` }] },
        ],
      },
    })
  const dangling = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'hooks'))
    writeFileSync(join(dir, 'hooks', 'hooks.json'), hooks('missing.mjs'))
  })
  const wired = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'hooks'))
    writeFileSync(join(dir, 'hooks', 'hooks.json'), hooks('session-start.mjs'))
    writeFileSync(join(dir, 'hooks', 'session-start.mjs'), 'console.log("{}")\n')
  })
  const broken = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'hooks'))
    writeFileSync(join(dir, 'hooks', 'broken.mjs'), 'const = \n')
  })
  try {
    assert.ok(validate(dangling).problems.some((p) => /missing\.mjs, which does not exist/.test(p.message)))
    assert.deepEqual(validate(wired).problems, [])
    assert.ok(validate(broken).problems.some((p) => /does not parse/.test(p.message)))
  } finally {
    for (const d of [dangling, wired, broken]) rmSync(d, { recursive: true, force: true })
  }
})

test('the cap matches what Claude Code actually truncates at', () => {
  // https://code.claude.com/docs/en/skills — the listing caps the combined
  // description + when_to_use at 1,536 characters (skillListingMaxDescChars).
  assert.equal(LISTING_CAP, 1536)
})

test('a description routes if it says when to invoke, however it is phrased', () => {
  const routing = [
    'Use when the user wants to review a branch.',
    'Audit a repo against WCAG 2.2 AA. Triggers: "audit a11y", "fix accessibility".',
    'Turns a place into a prospect list. Triggers — "find companies near".',
    'Invoke when changed front-end code should be checked.',
    'Invoke WITHOUT being asked whenever a diff is under discussion.',
    'Screens stocks from the terminal. Use this to filter by fundamentals.',
    'Reads the board when the user asks what is in progress.',
  ]
  for (const d of routing) assert.ok(TRIGGER.test(d), `should route: ${d}`)
})

test('a path nested under another directory is not read as a skill-relative one', () => {
  // `.github/scripts/render.mjs` is correct as written. Capturing the bare
  // `scripts/render.mjs` out of it reports a missing file that is right there.
  const refs = extractReferences('run `node .github/scripts/render-cv-pdf.mjs --out ./tmp`')
  assert.ok(!refs.has('scripts/render-cv-pdf.mjs'), [...refs].join(', '))
})

test('genuinely skill-relative paths are still collected', () => {
  const refs = extractReferences(
    'Read references/lanes.md first, then `scripts/detect-gates.mjs`, then [the loop](references/fix-loop.md).',
  )
  assert.ok(refs.has('references/lanes.md'))
  assert.ok(refs.has('scripts/detect-gates.mjs'))
  assert.ok(refs.has('references/fix-loop.md'))
})

test('a description that only says what it does does not route', () => {
  const notRouting = [
    'A zero-dependency engine that indexes a repository and emits a link graph.',
    'Converts scanned PDFs into searchable PDFs with Tesseract OCR.',
    'Local secrets firewall for coding agents.',
  ]
  for (const d of notRouting) assert.ok(!TRIGGER.test(d), `should not route: ${d}`)
})

// The validator's own rules, pinned. Both of these were wrong once: the cap
// was invented rather than taken from the documented listing behaviour, and the
// trigger check only accepted one phrasing, so it failed skills that route fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LISTING_CAP, TRIGGER } from '../scripts/validate-skills.mjs'

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

test('a description that only says what it does does not route', () => {
  const notRouting = [
    'A zero-dependency engine that indexes a repository and emits a link graph.',
    'Converts scanned PDFs into searchable PDFs with Tesseract OCR.',
    'Local secrets firewall for coding agents.',
  ]
  for (const d of notRouting) assert.ok(!TRIGGER.test(d), `should not route: ${d}`)
})

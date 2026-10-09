// The validator's own rules, pinned. Both of these were wrong once: the cap
// was invented rather than taken from the documented listing behaviour, and the
// trigger check only accepted one phrasing, so it failed skills that route fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LISTING_CAP,
  TRIGGER,
  SKILL_LINE_BUDGET,
  MODEL_NAME,
  extractReferences,
  validate,
  yamlProblems,
} from '../scripts/validate-skills.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

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
  assert.equal(SKILL_LINE_BUDGET, 50)
})

test('a SKILL.md over the line budget fails; one at the budget passes', () => {
  const over = fixtureRepo(SKILL_LINE_BUDGET + 1)
  const at = fixtureRepo(SKILL_LINE_BUDGET)
  try {
    const bad = validate(over).problems
    assert.ok(bad.some((p) => /past the 50-line budget/.test(p.message)), JSON.stringify(bad))
    assert.deepEqual(validate(at).problems, [])
  } finally {
    rmSync(over, { recursive: true, force: true })
    rmSync(at, { recursive: true, force: true })
  }
})

test('a skill holds Markdown only: a script in it fails', () => {
  const scripted = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'skills', 'demo', 'scripts'))
    writeFileSync(join(dir, 'skills', 'demo', 'scripts', 'x.mjs'), 'export {}\n')
  })
  const plain = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'skills', 'demo', 'agents'))
    writeFileSync(join(dir, 'skills', 'demo', 'agents', 'openai.yaml'), 'policy:\n  allow_implicit_invocation: true\n')
  })
  try {
    assert.ok(validate(scripted).problems.some((p) => /x\.mjs/.test(p.file) && /is not Markdown/.test(p.message)))
    assert.deepEqual(validate(plain).problems, [])
  } finally {
    rmSync(scripted, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  }
})

test('a model name anywhere under skills/ fails; tier words pass', () => {
  const named = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'skills', 'demo', 'agents'))
    writeFileSync(join(dir, 'skills', 'demo', 'agents', 'openai.yaml'), 'interface:\n  default_prompt: "Run it on sonnet."\n')
  })
  const tiers = fixtureRepo(10, (dir) => {
    mkdirSync(join(dir, 'skills', 'demo', 'agents'))
    writeFileSync(join(dir, 'skills', 'demo', 'agents', 'openai.yaml'), 'interface:\n  default_prompt: "Run it on small, medium or large."\n')
  })
  try {
    assert.ok(validate(named).problems.some((p) => /names the model "sonnet"/.test(p.message)))
    assert.deepEqual(validate(tiers).problems, [])
    for (const name of ['haiku', 'Opus', 'fable', 'gpt-5', 'gemini-2.5-pro']) assert.ok(MODEL_NAME.test(name), name)
    for (const word of ['small', 'medium', 'large', 'inherit', 'codex', 'claude', 'opencode']) assert.ok(!MODEL_NAME.test(word), word)
  } finally {
    rmSync(named, { recursive: true, force: true })
    rmSync(tiers, { recursive: true, force: true })
  }
})

test('the frontmatter is judged by the installer\'s own YAML parser, yaml 2.9.1', () => {
  // The skills installer (skills@1.5.23) reads frontmatter with `parse` from
  // yaml 2.9.1 and skips the skill when it throws. A plain value holding ": "
  // reads as a nested mapping there, so it must fail here; quoted, it passes.
  const description = 'Plans a change before it is written. Use when a decision is open: invoke it first.'
  const withDescription = (value) => (dir) =>
    writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), `---\nname: demo\ndescription: ${value}\n---\nbody\n`)
  const unquoted = fixtureRepo(10, withDescription(description))
  const quoted = fixtureRepo(10, withDescription(`'${description}'`))
  try {
    const bad = validate(unquoted).problems
    assert.ok(bad.some((p) => /not valid YAML/.test(p.message) && /would skip the skill/.test(p.message)), JSON.stringify(bad))
    assert.deepEqual(validate(quoted).problems, [])
  } finally {
    rmSync(unquoted, { recursive: true, force: true })
    rmSync(quoted, { recursive: true, force: true })
  }

  // `invalid` is yaml 2.9.1's own verdict on `name: demo` + the lines, checked
  // by hand against that version (true: `parse` throws, or name or description
  // is not a string, so the installer skips the skill). The validator must
  // report a problem exactly when it is true.
  const scenarios = [
    // a continuation line of a multi-line plain value holding ": ", and a nested value holding ": "
    { lines: 'description: Plan a change.\n  Use when a decision is open: invoke it first.', invalid: true },
    { lines: `description: ${description}\nmetadata:\n  opencode/autoinvoke: a: b`, invalid: true },
    // a colon at end of line or before a tab
    { lines: 'description: Use when the user says:', invalid: true },
    { lines: 'description: Use when:\tx', invalid: true },
    // text after a closing quote, and a leading YAML indicator
    { lines: "description: 'Plan' it: now", invalid: true },
    { lines: 'description: "x" y: z', invalid: true },
    { lines: 'description: @foo', invalid: true },
    { lines: 'description: *foo', invalid: true },
    { lines: 'description: `x`', invalid: true },
    // an invalid backslash escape inside double quotes
    { lines: 'description: "Matches \\d digits"', invalid: true },
    // a duplicate top-level key
    { lines: 'description: First copy.\ndescription: Second copy.', invalid: true },
    // a description that parses to a map, not a string: the installer skips it too
    { lines: 'description:\n  Use when the user asks to plan a change: plan it first, then build it.', invalid: true },
    // quoted values, with and without a nested map
    { lines: `description: '${description}'\nlicense: MIT`, invalid: false },
    { lines: "description: 'It''s a plan for a change. Use when a decision is open: invoke it first.'", invalid: false },
    { lines: `description: '${description}'\nmetadata:\n  opencode/autoinvoke: 'true'`, invalid: false },
    // a colon not followed by a space, a block scalar, a flow list and a block list
    { lines: `description: '${description}'\nallowed-tools: Bash(git diff:*), Read`, invalid: false },
    { lines: 'description: >\n  Plans a change before it is written. Use when a decision is open: invoke it first.', invalid: false },
    { lines: `description: '${description}'\nallowed-tools: [Read, Grep]`, invalid: false },
    { lines: `description: '${description}'\nallowed-tools:\n  - Read\n  - Grep`, invalid: false },
  ]
  for (const { lines, invalid } of scenarios) {
    const found = yamlProblems(`name: demo\n${lines}`)
    assert.equal(found.length > 0, invalid, `yaml 2.9.1 ${invalid ? 'rejects' : 'accepts'} ${JSON.stringify(lines)} → ${JSON.stringify(found)}`)
    if (invalid) assert.ok(found.length === 1 && /would skip the skill/.test(found[0]), JSON.stringify(found))

    // The same verdict reaches the full run over a repo.
    const repo = fixtureRepo(10, (dir) =>
      writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), `---\nname: demo\n${lines}\n---\nbody\n`),
    )
    try {
      const reported = validate(repo).problems.some((p) => /would skip the skill/.test(p.message))
      assert.equal(reported, invalid, `validate on ${JSON.stringify(lines)}`)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }

  // The real skills' frontmatter, as shipped, parses in yaml 2.9.1.
  for (const name of ['blueprint', 'build', 'verify']) {
    const text = readFileSync(join(repoRoot, 'skills', name, 'SKILL.md'), 'utf8')
    const block = text.slice(4, text.indexOf('\n---', 4))
    assert.deepEqual(yamlProblems(block), [], `skills/${name}/SKILL.md`)
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
  // `docs/references/style.md` is correct as written. Capturing the bare
  // `references/style.md` out of it reports a missing file that is right there.
  const refs = extractReferences('see `docs/references/style.md` for the house style')
  assert.ok(!refs.has('references/style.md'), [...refs].join(', '))
})

test('genuinely skill-relative paths are still collected', () => {
  const refs = extractReferences(
    'Read references/lanes.md first, then `references/audit.md`, then [the loop](references/fix-loop.md).',
  )
  assert.deepEqual([...refs].sort(), ['references/audit.md', 'references/fix-loop.md', 'references/lanes.md'])
})

test('a description that only says what it does does not route', () => {
  const notRouting = [
    'A zero-dependency engine that indexes a repository and emits a link graph.',
    'Converts scanned PDFs into searchable PDFs with Tesseract OCR.',
    'Local secrets firewall for coding agents.',
  ]
  for (const d of notRouting) assert.ok(!TRIGGER.test(d), `should not route: ${d}`)
})

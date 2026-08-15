#!/usr/bin/env node
// forbidden-repairs.mjs — deterministic guard for verify's auto-fix loop.
//
// A fix loop that may edit anything will eventually make the gates pass by
// lying: skipping the test, silencing the type error, editing CI. This scans
// the diff the loop just produced and refuses those repairs by name.
//
// Usage:
//   node forbidden-repairs.mjs --since <git-ref>       # diff a ref against the working tree
//   node forbidden-repairs.mjs --patch <file.diff>     # scan a saved patch
//   git diff | node forbidden-repairs.mjs              # read a patch on stdin
//
// Options:
//   --plan <path>      treat edits to this file as a spec-rewrite violation
//   --allow <rule>     downgrade a rule to a warning (repeatable)
//   --pretty           indent the JSON output
//
// Exit code: 1 if any violation survives, else 0. JSON report on stdout.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const pretty = args.includes('--pretty')
const planPath = argFor('--plan')
const allowed = new Set(argsFor('--allow'))

function argFor(flag) {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}

function argsFor(flag) {
  const out = []
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) out.push(args[i + 1])
  return out
}

// ------------------------------------------------------------------- input

const MAX = 64 * 1024 * 1024

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX, ...opts })
}

// A fix round that creates a NEW file — a fresh test full of it.skip(), a module
// carrying an @ts-ignore — produces nothing in `git diff`. Scanning only tracked
// changes would let exactly the cheat this guard exists for walk straight past.
function untrackedPatch() {
  let paths = []
  try {
    paths = git(['ls-files', '--others', '--exclude-standard'])
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
  } catch {
    return ''
  }
  let out = ''
  for (const path of paths) {
    try {
      out += git(['diff', '--no-index', '--', '/dev/null', path])
    } catch (err) {
      // --no-index exits 1 whenever the files differ, which is always here.
      if (err.stdout) out += err.stdout
    }
  }
  return out
}

function readPatch() {
  const since = argFor('--since')
  if (since) {
    // An unresolvable baseline must fail loudly. Swallowing it would report a
    // clean round over changes nobody looked at.
    git(['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { stdio: 'pipe' })
    return git(['diff', since]) + untrackedPatch()
  }
  const patch = argFor('--patch')
  if (patch) return readFileSync(patch, 'utf8')
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------- rules

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e)\//i
const TEST_NAME = /\.(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|test_.*\.py$/i
const isTestFile = (f) => TEST_FILE.test(f) || TEST_NAME.test(f)

const ADDED_RULES = [
  {
    rule: 'suppression',
    why: 'Silences the checker instead of fixing what it caught.',
    re: /@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore|#\s*type:\s*ignore|#\s*noqa|#\s*pylint:\s*disable|\/\/\s*nolint|#\[allow\(/,
  },
  {
    rule: 'test-skip',
    why: 'Turns a failing test off rather than making it pass honestly.',
    re: /\b(?:it|test|describe|context)\.(?:skip|only|todo)\(|\bx(?:it|describe|test)\(|@pytest\.mark\.skip|\bt\.Skip\(|@Ignore\b|\.skip\s*\(/,
  },
  {
    rule: 'any-cast',
    why: 'Widens the type until the type error disappears.',
    re: /\bas\s+any\b|:\s*any\b|<any>|\bas\s+unknown\s+as\b/,
    files: /\.(ts|tsx|mts|cts)$/,
  },
  {
    rule: 'error-swallow',
    why: 'Makes the failure invisible instead of handling it.',
    re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b|catch\s*(\([^)]*\))?\s*\{\s*\/\/|\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
  },
]

const GATE_FILE = /^\.github\/workflows\/|^\.gitlab-ci\.yml$|^Makefile$|^justfile$|^\.circleci\//i
const GATE_SCRIPT_LINE = /"(test|lint|typecheck|type-check|build|check|e2e)[^"]*"\s*:/i
const ASSERTION = /\b(expect|assert|should|require\.(?:Equal|NoError)|t\.(?:Error|Fatal))\b/

// ------------------------------------------------------------------- parse

function parse(patch) {
  const changes = []
  let file = null
  let newLine = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git')) {
      const m = /diff --git a\/(.+?) b\/(.+)$/.exec(line)
      file = m ? m[2] : null
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      if (p !== '/dev/null') file = p.replace(/^b\//, '')
      continue
    }
    if (line.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (!file) continue
    if (line.startsWith('+')) {
      changes.push({ file, line: newLine++, text: line.slice(1), kind: 'add' })
    } else if (line.startsWith('-')) {
      changes.push({ file, line: newLine, text: line.slice(1), kind: 'del' })
    } else if (line.startsWith(' ')) {
      newLine++
    }
  }
  return changes
}

// ------------------------------------------------------------------- check

const patch = readPatch()
const changes = parse(patch)
const findings = []

function flag(rule, why, change) {
  findings.push({
    rule,
    why,
    file: change.file,
    line: change.line,
    kind: change.kind,
    text: change.text.trim().slice(0, 200),
    severity: allowed.has(rule) ? 'warning' : 'violation',
  })
}

for (const change of changes) {
  if (change.kind === 'add') {
    for (const r of ADDED_RULES) {
      if (r.files && !r.files.test(change.file)) continue
      if (r.re.test(change.text)) flag(r.rule, r.why, change)
    }
  }

  if (change.kind === 'del' && isTestFile(change.file) && ASSERTION.test(change.text)) {
    flag('test-deletion', 'Removes an assertion the change was supposed to satisfy.', change)
  }

  if (GATE_FILE.test(change.file)) {
    flag('gate-tampering', 'Edits the definition of green instead of meeting it.', change)
  }

  if (/(^|\/)package\.json$/.test(change.file) && GATE_SCRIPT_LINE.test(change.text)) {
    flag('gate-tampering', 'Rewrites a gate script instead of satisfying it.', change)
  }

  if (planPath && change.file === planPath.replace(/^\.\//, '')) {
    flag('spec-rewrite', 'Rewrites the promise to match the code.', change)
  }
}

const violations = findings.filter((f) => f.severity === 'violation')
const warnings = findings.filter((f) => f.severity === 'warning')

process.stdout.write(
  JSON.stringify(
    {
      files_changed: [...new Set(changes.map((c) => c.file))],
      violations,
      warnings,
      verdict: violations.length ? 'FORBIDDEN' : 'CLEAN',
    },
    null,
    pretty ? 2 : 0,
  ) + '\n',
)

process.exit(violations.length ? 1 : 0)

#!/usr/bin/env node
// forbidden-repairs.mjs — deterministic guard for verify's auto-fix loop.
//
// A fix loop that may edit anything will eventually make the gates pass by
// lying: skipping the test, silencing the type error, editing CI. This scans
// the diff the loop just produced and refuses those repairs by name.
//
// The guard stops the loop and reverts hunks, so a false positive is not a
// cosmetic annoyance — it kills an honest repair and reports the fixer as a
// cheat. Every rule here is scoped to where the cheat can actually live.
//
// Usage:
//   node forbidden-repairs.mjs --since <git-ref>       # diff a ref against the working tree
//   node forbidden-repairs.mjs --patch <file.diff>     # scan a saved patch
//   git diff | node forbidden-repairs.mjs              # read a patch on stdin
//
// Options:
//   --plan <path>          treat edits to this file as a spec-rewrite violation
//   --allow <rule>         downgrade a rule to a warning (repeatable)
//   --include-untracked    also scan new files (implied by --since)
//   --pretty               indent the JSON output
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
const notes = []

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX, ...opts })
}

function untrackedPaths() {
  try {
    // Piped, not inherited: outside a git repo this fails on purpose, and
    // "fatal: not a git repository" on stderr would corrupt a caller that
    // merges the two streams while reading the JSON report.
    return git(['ls-files', '--others', '--exclude-standard'], { stdio: 'pipe' })
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
  } catch {
    return null // not a git repo, or git is unavailable
  }
}

// A fix round that creates a NEW file — a fresh test full of it.skip(), a module
// carrying an @ts-ignore — produces nothing in `git diff`. Scanning only tracked
// changes would let exactly the cheat this guard exists for walk straight past.
//
// The patch is synthesised here rather than asked of `git diff --no-index`: that
// is one process per file, and a fix round that scaffolds a package spawns git
// two hundred times to learn what `readFileSync` already knows.
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024

function syntheticPatch(paths) {
  let out = ''
  for (const path of paths) {
    let buf
    try {
      buf = readFileSync(path)
    } catch {
      continue // listed a moment ago, gone now — a temp file the round cleaned up
    }
    if (buf.length > MAX_UNTRACKED_BYTES) {
      notes.push(`${path} was NOT scanned — untracked and larger than ${MAX_UNTRACKED_BYTES} bytes.`)
      continue
    }
    if (buf.includes(0)) {
      notes.push(`${path} was NOT scanned — untracked and binary.`)
      continue
    }
    const text = buf.toString('utf8')
    const body = text.endsWith('\n') ? text.slice(0, -1) : text
    const lines = body === '' ? [] : body.split('\n')
    out +=
      `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n` +
      `@@ -0,0 +1,${lines.length} @@\n` +
      lines.map((l) => `+${l}`).join('\n') +
      '\n'
  }
  return out
}

function readPatch() {
  const since = argFor('--since')
  const wantUntracked = since !== null || args.includes('--include-untracked')

  let base = ''
  if (since) {
    // An unresolvable baseline must fail loudly. Swallowing it would report a
    // clean round over changes nobody looked at.
    git(['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { stdio: 'pipe' })
    base = git(['diff', since])
  } else {
    const patch = argFor('--patch')
    if (patch) base = readFileSync(patch, 'utf8')
    else {
      try {
        base = readFileSync(0, 'utf8')
      } catch {
        base = ''
      }
    }
  }

  const paths = untrackedPaths()
  if (wantUntracked) {
    if (paths === null) {
      notes.push('Untracked files could not be listed — not a git repository.')
      return { patch: base, untrackedScanned: false }
    }
    return { patch: base + syntheticPatch(paths), untrackedScanned: true }
  }

  // A supplied patch is scanned exactly as given. Saying so beats letting a new
  // file full of it.skip() pass as a clean round because nobody diffed it.
  if (paths && paths.length) {
    notes.push(
      `${paths.length} untracked file(s) were NOT scanned — a supplied patch does not contain them. Use --since <ref> or --include-untracked.`,
    )
  }
  return { patch: base, untrackedScanned: false }
}

// ------------------------------------------------------------------- rules

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e)\//i
const TEST_NAME = /\.(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|test_.*\.py$/i
const isTestFile = (f) => TEST_FILE.test(f) || TEST_NAME.test(f)

// Prose is not code. A document that names `@ts-ignore` in order to forbid it —
// this repo's own references/fix-loop.md does exactly that — is not a
// suppression, and a fix loop cannot hide a silenced checker in a changelog.
// The basename alternative takes a prose extension or none at all. `(\.[a-z]+)?`
// would swallow a real one, exempting `src/license.js`, `src/changelog.ts` and
// `components/Notice.tsx` from every rule — a guard that waves through any file
// someone happened to name after a legal document.
const NON_CODE =
  /\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)(CHANGELOG|LICENSE|NOTICE|COPYING|AUTHORS)(\.(md|txt|rst|adoc))?$/i

// `#` opens a comment in Python, Ruby, shell and YAML. In a brace language it
// opens a private class member, and blanking `#store: any = {}` hides exactly
// the widening the any-cast rule exists to catch.
const BRACE_LANG =
  /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|java|cs|go|rs|c|h|cc|cpp|hpp|kt|swift|scala|php|css|scss|less)$/i

// Comments and string literals are blanked — length-preserving, so reported
// line numbers stay true — before the rules that must not read prose.
const LINE_COMMENT = /(^|[^:])\/\/[^\n]*/g
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const HASH_COMMENT = /#[^\n]*/g
const STRING_LITERAL = /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g
const blankKeepingNewlines = (m) => m.replace(/[^\n]/g, ' ')

function blankComments(text, file = '') {
  const out = text
    .replace(LINE_COMMENT, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(BLOCK_COMMENT, blankKeepingNewlines)
  if (BRACE_LANG.test(file)) return out
  return out.replace(HASH_COMMENT, (m) => ' '.repeat(m.length))
}

function blankStrings(text) {
  return text.replace(STRING_LITERAL, (m) => m[0] + ' '.repeat(m.length - 2) + m[0])
}

// Strings first: a `/*` inside `glob('src/*.ts')` is not a comment, and letting
// it open one blanks the code that follows.
function blankNonCode(text, file = '') {
  return blankComments(blankStrings(text), file)
}

const ADDED_RULES = [
  {
    rule: 'suppression',
    why: 'Silences the checker instead of fixing what it caught.',
    // Comments survive — the suppression IS a comment — but string literals do
    // not: a real `// @ts-ignore` is never quoted, while a linter's own rule
    // table, a test fixture and a migration guide all carry it as data.
    re: /@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore|#\s*type:\s*ignore|#\s*noqa|#\s*pylint:\s*disable|\/\/\s*nolint|#\[allow\(/,
    strip: 'strings',
  },
  {
    rule: 'test-skip',
    why: 'Turns a failing test off rather than making it pass honestly.',
    // Named receivers are unambiguous anywhere: nothing legitimate calls
    // `it.skip(` or `@pytest.mark.skip` outside a test.
    re: /\b(?:it|test|describe|context|suite)\.(?:skip|only|todo|failing)\(|\bx(?:it|describe|test)\(|@pytest\.mark\.(?:skip|xfail)|\bt\.Skip\(|@Ignore\b|\bself\.skipTest\(/,
    strip: 'strings',
  },
  {
    rule: 'test-skip',
    why: 'Turns a failing test off rather than making it pass honestly.',
    // A bare `.skip(` is a skip only inside a test file. Everywhere else it is
    // pagination: `repo.createQueryBuilder('u').skip(20).take(20)` is the
    // standard idiom in TypeORM, Mongoose and Prisma. Refusing that stops an
    // honest fix loop and reports the fixer as a cheat.
    re: /\.(?:skip|only)\s*\(/,
    files: isTestFile,
    strip: 'strings',
  },
  {
    rule: 'any-cast',
    why: 'Widens the type until the type error disappears.',
    re: /\bas\s+any\b|:\s*any\b|<any>|\bas\s+unknown\s+as\b/,
    files: /\.(ts|tsx|mts|cts)$/,
    strip: 'all',
  },
]

// An empty catch spans lines far more often than not, so it cannot be found one
// diff line at a time — see swallowedErrors().
const SWALLOW_RULES = [
  { re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g, lang: 'js' },
  { re: /except[^:\n]*:\s*pass\b/g, lang: 'py' },
  { re: /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, lang: 'js' },
]

const GATE_FILE =
  /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)makefile$|(^|\/)justfile$|(^|\/)taskfile\.ya?ml$|(^|\/)\.circleci\//i
const GATE_SCRIPT_LINE = /"(test|lint|typecheck|type-check|build|check|validate|e2e)[^"]*"\s*:/i
const ASSERTION = /\b(expect|assert|should|require\.(?:Equal|NoError)|t\.(?:Error|Fatal))\b/

function matchesFile(matcher, file) {
  return typeof matcher === 'function' ? matcher(file) : matcher.test(file)
}

// ------------------------------------------------------------------- parse

// Context lines are kept, not just +/-: an empty catch whose braces straddle an
// added line is only visible against the surrounding code.
function parse(patch) {
  const changes = []
  const byFile = new Map()
  let file = null
  let newLine = 0
  let hunk = 0

  // Keyed by hunk, not just by file. Lines from two hunks are not adjacent in
  // the real file — an elided gap sits between them — so a `/**` left open in
  // one hunk must not reach a `*/` in the next.
  const record = (f, n, text, added) => {
    const key = `${f} ${hunk}`
    if (!byFile.has(key)) byFile.set(key, { file: f, lines: [] })
    byFile.get(key).lines.push({ n, text, added })
  }

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
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) {
      newLine = Number(header[1])
      hunk++
      continue
    }
    if (!file) continue
    if (line.startsWith('+')) {
      const text = line.slice(1)
      changes.push({ file, line: newLine, text, kind: 'add' })
      record(file, newLine++, text, true)
    } else if (line.startsWith('-')) {
      changes.push({ file, line: newLine, text: line.slice(1), kind: 'del' })
    } else if (line.startsWith(' ')) {
      record(file, newLine++, line.slice(1), false)
    }
  }
  return { changes, byFile }
}

// -------------------------------------------------------- swallowed errors

// Blanking comments before the match is what separates the two cases the
// single-line rule got backwards: `catch (e) { // rethrow` followed by a throw
// is honest handling, while `catch (e) {` / `// ignore` / `}` is the cheat.
function swallowedErrors(byFile) {
  const found = []
  for (const { file, lines } of byFile.values()) {
    if (NON_CODE.test(file) || !lines.some((l) => l.added)) continue

    const offsets = []
    let at = 0
    for (const l of lines) {
      offsets.push(at)
      at += l.text.length + 1
    }
    const blob = blankNonCode(lines.map((l) => l.text).join('\n'), file)

    const lineAt = (index) => {
      let lo = 0
      let hi = offsets.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (offsets[mid] <= index) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    for (const { re } of SWALLOW_RULES) {
      re.lastIndex = 0
      for (const m of blob.matchAll(re)) {
        const from = lineAt(m.index)
        const to = lineAt(m.index + m[0].length - 1)
        // Only a repair this round produced is refusable. A pre-existing empty
        // catch the diff merely brushed past is not this guard's business.
        const addedLine = lines.slice(from, to + 1).find((l) => l.added)
        if (!addedLine) continue
        found.push({ file, line: addedLine.n, text: addedLine.text, kind: 'add' })
      }
    }
  }
  return found
}

// ------------------------------------------------------------------- check

const { patch, untrackedScanned } = readPatch()
const { changes, byFile } = parse(patch)
const findings = []

function flag(rule, why, change) {
  // Two rules can name the same cheat — `it.skip(` matches both the named
  // receiver and the bare `.skip(` inside a test file. Reporting it twice makes
  // the loop chase one line as two findings.
  if (findings.some((f) => f.rule === rule && f.file === change.file && f.line === change.line))
    return
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
  const prose = NON_CODE.test(change.file)

  if (change.kind === 'add' && !prose) {
    // Blanked once per line, not once per rule: four rules read the same line,
    // and the blanking is the expensive part of the scan.
    let stringsBlanked = null
    let allBlanked = null
    for (const r of ADDED_RULES) {
      if (r.files && !matchesFile(r.files, change.file)) continue
      let text = change.text
      if (r.strip === 'all') {
        allBlanked ??= blankNonCode(change.text, change.file)
        text = allBlanked
      } else if (r.strip === 'strings') {
        stringsBlanked ??= blankStrings(change.text)
        text = stringsBlanked
      }
      if (r.re.test(text)) flag(r.rule, r.why, change)
    }
  }

  // A test title is prose, not an assertion: renaming `it('should return 401')`
  // deletes a line containing "should" without deleting anything that checks.
  if (change.kind === 'del' && isTestFile(change.file)) {
    if (ASSERTION.test(blankNonCode(change.text, change.file)))
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

for (const hit of swallowedErrors(byFile)) {
  flag('error-swallow', 'Makes the failure invisible instead of handling it.', hit)
}

const violations = findings.filter((f) => f.severity === 'violation')
const warnings = findings.filter((f) => f.severity === 'warning')

process.stdout.write(
  JSON.stringify(
    {
      files_changed: [...new Set(changes.map((c) => c.file))],
      untracked_scanned: untrackedScanned,
      violations,
      warnings,
      notes,
      verdict: violations.length ? 'FORBIDDEN' : 'CLEAN',
    },
    null,
    pretty ? 2 : 0,
  ) + '\n',
)

process.exit(violations.length ? 1 : 0)

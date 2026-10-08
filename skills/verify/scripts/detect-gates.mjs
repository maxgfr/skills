#!/usr/bin/env node
// detect-gates.mjs — deterministic, zero-dependency detection of a repo's real
// verification commands. No model in the loop: this reads lockfiles, manifests
// and CI workflows and reports the commands that define "green" for this repo.
//
// Usage:
//   node detect-gates.mjs [--cwd <dir>] [--run] [--pretty]
//
// Output: JSON on stdout. With --run, every detected gate is executed once and
// the output is compact: each command, its exit code, and at most 10 lines of
// output when it failed. The exit code is 1 when a blocking gate failed.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

const KIND_ORDER = ['typecheck', 'lint', 'format', 'test', 'build', 'e2e', 'check', 'ci']

// Script names that map to a gate kind. Matched against the script/target name.
const NAME_RULES = [
  { kind: 'typecheck', re: /^(typecheck|type-check|check-types|checktypes|types|tsc)$/ },
  { kind: 'lint', re: /^(lint|lint:check|lint:ci|eslint|biome|biome:check)$/ },
  { kind: 'format', re: /^(format:check|fmt:check|fmt-check|format-check|prettier:check)$/ },
  { kind: 'test', re: /^(test|tests|test:unit|unit|test:ci)$/ },
  { kind: 'e2e', re: /^(test:e2e|e2e|test:integration|integration|test:browser)$/ },
  { kind: 'build', re: /^(build|compile)$/ },
  // The repo's own aggregate gate. Without this, a repo whose green is defined
  // by `npm run check` and which has no CI workflow to fall back on reports its
  // main gate as absent — the one command the author considers definitive.
  { kind: 'check', re: /^(check|checks|validate|verify|ci|qa)$/ },
]

// Names we never turn into a gate: they mutate, watch, or serve.
const NAME_DENY = /(:fix|:write|--fix|watch|dev$|^dev|^start|^serve|^clean|:ui$|:debug$)/
// Script bodies that reveal an interactive or mutating command. `concurrently`
// is deliberately absent: `concurrently "npm:lint" "npm:typecheck"` is a common
// shape for the aggregate check, and what makes a body a dev server is the
// server, which the other alternatives still catch.
const BODY_DENY = /(--watch\b|--fix\b|--write\b|nodemon|vite dev|next dev)/

const args = process.argv.slice(2)
if (args.includes('--help')) {
  process.stdout.write('Usage: node detect-gates.mjs [--cwd <dir>] [--run] [--pretty]\n\nExample: node detect-gates.mjs --cwd . --run\n')
  process.exit(0)
}
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--pretty' || args[i] === '--run') continue
  if (args[i] === '--cwd') {
    if (!args[i + 1]) {
      process.stderr.write('--cwd needs a value.\n')
      process.exit(1)
    }
    i += 1
    continue
  }
  process.stderr.write(`Unknown flag: ${args[i]}\n`)
  process.exit(1)
}
const cwd = resolve(argFor('--cwd') ?? process.cwd())
const pretty = args.includes('--pretty')

function argFor(flag) {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}

// One read per path, ever. The lockfile probes and the manifest parse ask for
// the same handful of files, and a stat-then-read is two syscalls where the
// read alone answers both questions.
const files = new Map()
function read(...p) {
  const file = join(cwd, ...p)
  if (files.has(file)) return files.get(file)
  let text = null
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    text = null
  }
  files.set(file, text)
  return text
}

function has(...p) {
  return read(...p) !== null
}

const notes = []
const gates = []
let seq = 0

function addGate(kind, cmd, source, opts = {}) {
  if (gates.some((g) => g.cmd === cmd)) return
  gates.push({
    id: `${kind}-${++seq}`,
    kind,
    cmd,
    source,
    blocking: opts.blocking ?? kind !== 'e2e',
    // An aggregate `check` runs the other gates back to back, so it needs their
    // combined budget rather than a single gate's.
    timeout_s:
      opts.timeout_s ?? (kind === 'e2e' ? 900 : kind === 'build' || kind === 'check' ? 600 : 300),
  })
}

// ---------------------------------------------------------------- JavaScript

function detectPackageManager(pkg) {
  if (pkg?.packageManager) {
    const name = String(pkg.packageManager).split('@')[0]
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return name
  }
  if (has('pnpm-lock.yaml')) return 'pnpm'
  if (has('bun.lockb') || has('bun.lock')) return 'bun'
  if (has('yarn.lock')) return 'yarn'
  if (has('package-lock.json')) return 'npm'
  return null
}

function runPrefix(pm) {
  return { npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn run', bun: 'bun run' }[pm] ?? 'npm run'
}

let packageManager = null
const pkgRaw = read('package.json')
let pkg = null
if (pkgRaw) {
  try {
    pkg = JSON.parse(pkgRaw)
  } catch {
    notes.push('package.json is present but not valid JSON — skipped.')
  }
}

if (pkg) {
  packageManager = detectPackageManager(pkg)
  if (!packageManager) {
    packageManager = 'npm'
    notes.push('No lockfile found — assuming npm. Pass the right command via config if wrong.')
  }
  const prefix = runPrefix(packageManager)
  const scripts = pkg.scripts ?? {}
  for (const [name, body] of Object.entries(scripts)) {
    if (NAME_DENY.test(name)) continue
    if (typeof body === 'string' && BODY_DENY.test(body)) continue
    const rule = NAME_RULES.find((r) => r.re.test(name))
    if (rule) addGate(rule.kind, `${prefix} ${name}`, 'package.json')
  }
  if (pkg.workspaces || has('pnpm-workspace.yaml') || has('turbo.json')) {
    notes.push('Monorepo detected — gates run at the root and may not cover every package.')
  }
}

// ------------------------------------------------------------------ Makefile

const makefile = read('Makefile') ?? read('makefile')
if (makefile) {
  for (const line of makefile.split('\n')) {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!=)/.exec(line)
    if (!m) continue
    const target = m[1]
    if (NAME_DENY.test(target)) continue
    const rule = NAME_RULES.find((r) => r.re.test(target))
    if (rule) addGate(rule.kind, `make ${target}`, 'Makefile')
  }
}

// ------------------------------------------------------------------ justfile

const justfile = read('justfile') ?? read('Justfile')
if (justfile) {
  for (const line of justfile.split('\n')) {
    const m = /^([a-zA-Z0-9_-]+)(\s+[^:]*)?:(?!=)/.exec(line)
    if (!m) continue
    const recipe = m[1]
    if (NAME_DENY.test(recipe)) continue
    const rule = NAME_RULES.find((r) => r.re.test(recipe))
    if (rule) addGate(rule.kind, `just ${recipe}`, 'justfile')
  }
}

// -------------------------------------------------------------------- Python

const pyproject = read('pyproject.toml')
if (pyproject) {
  const pyPrefix = has('uv.lock') ? 'uv run ' : has('poetry.lock') ? 'poetry run ' : ''
  if (/\bmypy\b/.test(pyproject)) addGate('typecheck', `${pyPrefix}mypy .`, 'pyproject.toml')
  if (/\bpyright\b/.test(pyproject)) addGate('typecheck', `${pyPrefix}pyright`, 'pyproject.toml')
  if (/\bruff\b/.test(pyproject)) {
    addGate('lint', `${pyPrefix}ruff check .`, 'pyproject.toml')
    addGate('format', `${pyPrefix}ruff format --check .`, 'pyproject.toml')
  }
  if (/\bpytest\b/.test(pyproject)) addGate('test', `${pyPrefix}pytest -q`, 'pyproject.toml')
}

// ---------------------------------------------------------------------- Rust

if (has('Cargo.toml')) {
  addGate('typecheck', 'cargo check --all-targets', 'Cargo.toml')
  addGate('lint', 'cargo clippy --all-targets -- -D warnings', 'Cargo.toml')
  addGate('test', 'cargo test', 'Cargo.toml')
}

// ------------------------------------------------------------------------ Go

if (has('go.mod')) {
  addGate('typecheck', 'go vet ./...', 'go.mod')
  addGate('test', 'go test ./...', 'go.mod')
  addGate('build', 'go build ./...', 'go.mod')
}

// ---------------------------------------------------------------------- Deno

if (has('deno.json') || has('deno.jsonc')) {
  addGate('typecheck', 'deno check .', 'deno.json')
  addGate('lint', 'deno lint', 'deno.json')
  addGate('test', 'deno test -A', 'deno.json')
}

// ------------------------------------------------------------------------ CI
// The CI workflow is the repo's own definition of "green". Anything it runs
// that we did not already derive is worth surfacing.

const CI_SIGNAL = /\b(tests?|lint|typecheck|type-check|tsc|build|check|shellcheck|validate|verify|audit|vitest|jest|playwright|cypress|pytest|mypy|ruff|eslint|biome|clippy|cargo|go test)\b/
// Setup, not proof: installs (also `npm --prefix ui install`), file shuffling,
// and the shell's own `test`/`[` builtins.
const CI_INSTALL = /^(?:sudo\s+)?(?:npm|pnpm|yarn|bun)\s(?!.*\brun\b).*\b(?:ci|i|install|add)(?:\s|$)/
const CI_NOISE = /^(?:sudo\s+)?(test\s+[-!]|\[\s|(?:cp|mv|rm|ln|touch|chmod|export)\s|npm ci|npm i\b|npm install|pnpm i\b|pnpm install|yarn install|bun install|corepack|git |echo |cd |mkdir |curl |apt-get|brew )/

// YAML may quote the whole scalar. A command that merely ENDS in a quote —
// `node --test "tests/**/*.mjs"` — is not quoted, and stripping that quote
// yields a command that cannot run.
function unquote(value) {
  const first = value[0]
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length > 1) {
    return value.slice(1, -1)
  }
  return value
}

// Only a workflow that runs on push or pull_request says what green is. A
// scheduled data refresh or a manual release job is not a gate.
function runsOnChanges(yaml) {
  const m = /^on:(.*(?:\n(?:[ \t].*|\s*))*)/m.exec(yaml)
  return !m || /\b(push|pull_request)\b/.test(m[1])
}

const SHELL_OPEN = /^(if|for|while|until|case)\b/
const SHELL_CLOSE = /^(fi|done|esac)\b/
let compoundsSkipped = 0

function extractRunCommands(yaml) {
  const out = []
  const lines = yaml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // Block scalars first: `run: |` would otherwise parse as an inline command
    // whose body is the pipe character.
    const block = /^(\s*)(?:-[ \t]*)?run:[ \t]*[|>][-+]?[ \t]*$/.exec(lines[i])
    if (block) {
      const baseIndent = block[1].length
      // A shell command may span several physical lines. Emitting each one as
      // its own command yields fragments like `playwright test \`, which then
      // become gates that cannot run — a fabricated failure on a healthy repo.
      let pending = ''
      // An if/for/while/case leans on the steps before it: run alone, or split
      // into lines, it fails where the repo does not. It is skipped whole.
      let depth = 0
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]
        if (line.trim() === '') continue
        const indent = line.length - line.trimStart().length
        if (indent <= baseIndent) break
        i = j
        const text = line.trim()
        // A comment runs as a no-op that exits 0: as a gate it proves nothing.
        if (text.startsWith('#')) continue
        if (SHELL_OPEN.test(text)) {
          if (depth === 0) compoundsSkipped++
          depth++
        }
        if (depth) {
          if (SHELL_CLOSE.test(text)) depth--
          continue
        }
        if (text.endsWith('\\')) {
          pending += text.slice(0, -1).trim() + ' '
          continue
        }
        out.push((pending + text).trim())
        pending = ''
      }
      if (pending.trim()) out.push(pending.trim())
      continue
    }
    const inline = /^\s*(?:-[ \t]*)?run:[ \t]*(\S.*?)\s*$/.exec(lines[i])
    if (inline) out.push(unquote(inline[1]))
  }
  return out
}

const ciCommands = []
const ciWorkflows = []
const wfDir = join(cwd, '.github', 'workflows')
if (existsSync(wfDir)) {
  for (const file of readdirSync(wfDir).sort()) {
    if (!/\.ya?ml$/.test(file)) continue
    const yaml = read('.github', 'workflows', file)
    if (!yaml || !runsOnChanges(yaml)) continue
    const found = extractRunCommands(yaml)
      .filter((c) => CI_SIGNAL.test(c) && !CI_NOISE.test(c) && !CI_INSTALL.test(c))
      .map((c) => c.trim())
    if (found.length) {
      ciWorkflows.push(file)
      for (const c of found) if (!ciCommands.includes(c)) ciCommands.push(c)
    }
  }
}

if (compoundsSkipped)
  notes.push(`${compoundsSkipped} shell block(s) with if/for/while/case in CI were not run as gates: they depend on the steps before them.`)

const CI_EXTRA_CAP = 6
// `pnpm test` and `pnpm run test` are one gate; running both runs the suite twice.
const sameScript = (c) => c.replace(/^(pnpm|yarn|bun) run /, '$1 ').replace(/^npm run (test|start)\b/, 'npm $1')
// $RUNNER_TEMP, $GITHUB_WORKSPACE, ${{ … }}: the step only exists on a GitHub runner.
const RUNNER_ONLY = /\$\{?(RUNNER_|GITHUB_)|\$\{\{/
const ciExtras = ciCommands.filter(
  (c) => !RUNNER_ONLY.test(c) && !gates.some((g) => sameScript(g.cmd) === sameScript(c)),
)
for (const cmd of ciExtras.slice(0, CI_EXTRA_CAP)) addGate('ci', cmd, 'ci', { blocking: true })
if (ciExtras.length > CI_EXTRA_CAP) {
  notes.push(
    `CI runs ${ciExtras.length} gate-like commands; only the first ${CI_EXTRA_CAP} were added. Dropped: ${ciExtras
      .slice(CI_EXTRA_CAP)
      .join(' | ')}`,
  )
}

// ------------------------------------------------------------- Aggregates
// A gate another gate already runs is run once, inside the aggregate: `check`
// = `npm run validate && npm test` makes the other two redundant, and so does
// a CI step that is the body of one of those scripts.

const scripts = Object.fromEntries(
  Object.entries(pkg?.scripts ?? {}).filter(([, body]) => typeof body === 'string'),
)
const scriptByBody = new Map(Object.entries(scripts).map(([name, body]) => [body.trim(), name]))

function scriptOf(cmd) {
  const m = /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+([\w:.-]+)$/.exec(cmd)
  if (m && scripts[m[1]] !== undefined) return m[1]
  return scriptByBody.get(cmd) ?? null
}

function invoked(name, seen = new Set()) {
  const body = scripts[name] || ''
  for (const m of body.matchAll(/(?:\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+|["']npm:)([\w:.-]+)/g)) {
    const called = m[1]
    if (scripts[called] === undefined || seen.has(called) || called === name) continue
    seen.add(called)
    invoked(called, seen)
  }
  return seen
}

const covered = new Map()
for (const g of gates) {
  const name = scriptOf(g.cmd)
  if (name) for (const inner of invoked(name)) if (!covered.has(inner)) covered.set(inner, g.cmd)
}
const dropped = []
for (let i = gates.length - 1; i >= 0; i--) {
  const name = scriptOf(gates[i].cmd)
  if (name && covered.has(name) && covered.get(name) !== gates[i].cmd) dropped.unshift(gates.splice(i, 1)[0].cmd)
}
if (dropped.length) notes.push(`${dropped.length} gate(s) skipped, already run by an aggregate: ${dropped.slice(0, 2).join(', ')}${dropped.length > 2 ? ', …' : ''}.`)

// ------------------------------------------------------------------- Output

gates.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

if (!gates.length) {
  notes.push(
    'No verification command detected. Nothing was proven; verify reports UNPROVEN.',
  )
}

if (args.includes('--run')) {
  const ran = gates.map(runGate)
  const failed = ran.some((g) => g.exit !== 0 && g.blocking !== false)
  const out = { ok: ran.length ? !failed : null, gates: ran }
  if (notes.length) out.notes = notes
  process.stdout.write(JSON.stringify(out, null, pretty ? 2 : 0) + '\n')
  process.exit(failed ? 1 : 0)
}

// One gate, once, non-interactive. A gate that did not finish has exit -1: it
// is a failure to prove, never a pass.
function runGate(gate) {
  const r = spawnSync(gate.cmd, {
    cwd,
    // bash where it exists, as on GitHub Actions: a CI step written for bash
    // is not a failure of the repo when /bin/sh cannot parse it.
    shell: process.platform !== 'win32' && existsSync('/bin/bash') ? '/bin/bash' : true,
    encoding: 'utf8',
    timeout: gate.timeout_s * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI || '1' },
  })
  const exit = typeof r.status === 'number' ? r.status : -1
  const row = { cmd: gate.cmd, exit }
  if (!gate.blocking) row.blocking = false
  if (exit !== 0) {
    const why = r.error ? [`${r.error.code || r.error.message}${r.error.code === 'ETIMEDOUT' ? ` after ${gate.timeout_s}s` : ''}`] : []
    const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.trimEnd()).filter(Boolean)
    row.out = [...why, ...lines.slice(-(10 - why.length))].join('\n')
  }
  return row
}

const result = {
  cwd,
  repo: basename(cwd),
  packageManager,
  gates,
  ci: { workflows: ciWorkflows, commands: ciCommands },
  notes,
}

process.stdout.write(JSON.stringify(result, null, pretty ? 2 : 0) + '\n')

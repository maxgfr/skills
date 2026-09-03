#!/usr/bin/env node
// detect-gates.mjs — deterministic, zero-dependency detection of a repo's real
// verification commands. No model in the loop: this reads lockfiles, manifests
// and CI workflows and reports the commands that define "green" for this repo.
//
// Usage:
//   node detect-gates.mjs [--cwd <dir>] [--pretty]
//
// Output: JSON on stdout.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

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
  process.stdout.write('Usage: node detect-gates.mjs [--cwd <dir>] [--pretty]\n\nExample: node detect-gates.mjs --cwd . --pretty\n')
  process.exit(0)
}
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--pretty') continue
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

const CI_SIGNAL = /\b(test|lint|typecheck|type-check|tsc|build|check|validate|verify|audit|vitest|jest|playwright|cypress|pytest|mypy|ruff|eslint|biome|clippy|cargo|go test)\b/
const CI_NOISE = /^(npm ci|npm i\b|npm install|pnpm i\b|pnpm install|yarn install|bun install|corepack|git |echo |cd |mkdir |curl |apt-get|brew )/

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
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]
        if (line.trim() === '') continue
        const indent = line.length - line.trimStart().length
        if (indent <= baseIndent) break
        i = j
        const text = line.trim()
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
    if (!yaml) continue
    const found = extractRunCommands(yaml)
      .filter((c) => CI_SIGNAL.test(c) && !CI_NOISE.test(c))
      .map((c) => c.trim())
    if (found.length) {
      ciWorkflows.push(file)
      for (const c of found) if (!ciCommands.includes(c)) ciCommands.push(c)
    }
  }
}

const CI_EXTRA_CAP = 6
const ciExtras = ciCommands.filter((c) => !gates.some((g) => g.cmd === c))
for (const cmd of ciExtras.slice(0, CI_EXTRA_CAP)) addGate('ci', cmd, 'ci', { blocking: true })
if (ciExtras.length > CI_EXTRA_CAP) {
  notes.push(
    `CI runs ${ciExtras.length} gate-like commands; only the first ${CI_EXTRA_CAP} were added. Dropped: ${ciExtras
      .slice(CI_EXTRA_CAP)
      .join(' | ')}`,
  )
}

// ------------------------------------------------------------------- Output

gates.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

if (!gates.length) {
  notes.push(
    'No verification command detected. verify will fall back to behaviour proof only — say so in the report.',
  )
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

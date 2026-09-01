#!/usr/bin/env node
// peer-run.mjs — consult the other CLI agent, read-only, and check what it cites.
//
// Two agents disagreeing is only useful if the disagreement is about the repo
// rather than about prose. So everything with a right answer lives here: which
// binary to run, with which flags, for how long, and whether the `path:line` the
// peer cited actually says what it claims. What the objection *means* is left to
// the model that reads the result.
//
// The host is passed in, never sniffed. `CODEX_HOME`, `~/.claude` and
// `command -v codex` all say where something is installed — none of them says
// who is running. The peer is simply the other one.
//
// Usage:
//   node peer-run.mjs --host claude|codex --mode plan|diff --cwd <repo> \
//     --prompt <file> --schema <file> --out <dir> [--model <m>] [--timeout-ms N]
//
// Exit code is 0 whenever the wrapper itself worked. The verdict is the
// `status` field on stdout: ok | peer_unavailable | peer_output_invalid.

import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PEER_OF = { claude: 'codex', codex: 'claude' }
export const DEFAULT_TIMEOUT_MS = 300_000
// Enough for eight objections with quotes; past this the peer is not answering
// the brief, and buffering its output unbounded is how a wrapper becomes the
// thing that falls over.
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

const AUTH = {
  codex: { argv: ['login', 'status'], remedy: 'codex login' },
  claude: { argv: ['auth', 'status'], remedy: 'claude auth login' },
}

// ------------------------------------------------------------------ arguments

export function parseArgs(argv) {
  const out = { timeoutMs: DEFAULT_TIMEOUT_MS }
  const want = {
    '--host': 'host',
    '--mode': 'mode',
    '--cwd': 'cwd',
    '--prompt': 'prompt',
    '--schema': 'schema',
    '--out': 'out',
    '--model': 'model',
  }
  for (let i = 0; i < argv.length; i++) {
    const key = want[argv[i]]
    if (key) {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${argv[i - 1]} needs a value.`)
      out[key] = value
    } else if (argv[i] === '--timeout-ms') {
      const n = Number(argv[++i])
      if (!Number.isFinite(n) || n < 1000 || n > 3_600_000)
        throw new Error('--timeout-ms must be between 1000 and 3600000.')
      out.timeoutMs = n
    } else if (argv[i].startsWith('--')) throw new Error(`Unknown flag: ${argv[i]}`)
  }
  if (!PEER_OF[out.host]) throw new Error('--host must be "claude" or "codex".')
  if (out.mode !== 'plan' && out.mode !== 'diff') throw new Error('--mode must be "plan" or "diff".')
  for (const k of ['cwd', 'prompt', 'schema', 'out'])
    if (!out[k]) throw new Error(`--${k} is required.`)
  out.peer = PEER_OF[out.host]
  return out
}

// -------------------------------------------------------------- the two CLIs

// Both argv arrays are read-only by construction and carry no flag that could
// let the peer write, approve, or persist anything. A change here is a change to
// what a second vendor's model is allowed to do on this machine.
export function buildInvocation({ peer, cwd, schemaPath, lastMessagePath, model }) {
  if (peer === 'codex') {
    const argv = [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--skip-git-repo-check',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      lastMessagePath,
      '--cd',
      cwd,
    ]
    if (model) argv.push('--model', model)
    argv.push('-') // the prompt arrives on stdin, never as an argument
    return { command: 'codex', argv }
  }
  const argv = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    readFileSync(schemaPath, 'utf8'),
    '--permission-mode',
    'plan',
    '--restricted',
    '--tools',
    'Read,Glob,Grep',
    '--no-session-persistence',
    '--disable-slash-commands',
  ]
  if (model) argv.push('--model', model)
  return { command: 'claude', argv }
}

// ------------------------------------------------------------------- process

function unavailable(reason, remedy) {
  return { status: 'peer_unavailable', reason, ...(remedy ? { remedy } : {}) }
}

export function checkAuth(peer, run = execFileSync) {
  const { argv, remedy } = AUTH[peer]
  try {
    run(peer, argv, { stdio: 'pipe', timeout: 20_000 })
    return { ok: true }
  } catch (err) {
    if (err && err.code === 'ENOENT')
      return unavailable(`\`${peer}\` is not on PATH.`, `install ${peer}`)
    return unavailable(`\`${peer}\` is not authenticated.`, remedy)
  }
}

// SIGTERM, a grace period, then the whole process group — a peer that spawned
// its own children leaves them behind otherwise. `timeout` is not on a stock
// macOS, so the deadline is enforced here rather than borrowed from the shell.
export function runBounded({ command, argv, cwd, stdin, timeoutMs }) {
  return new Promise((done) => {
    let child
    try {
      child = spawn(command, argv, { cwd, shell: false, detached: true, stdio: 'pipe' })
    } catch (err) {
      return done({ spawnError: err })
    }
    const chunks = { out: [], err: [] }
    let bytes = 0
    let timedOut = false
    const collect = (key) => (buf) => {
      bytes += buf.length
      if (bytes <= MAX_OUTPUT_BYTES) chunks[key].push(buf)
    }
    child.stdout.on('data', collect('out'))
    child.stderr.on('data', collect('err'))
    child.on('error', (err) => done({ spawnError: err }))

    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          /* already gone */
        }
      }
    }
    const deadline = setTimeout(() => {
      timedOut = true
      kill('SIGTERM')
      setTimeout(() => kill('SIGKILL'), 2000).unref()
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(deadline)
      done({
        code,
        timedOut,
        truncated: bytes > MAX_OUTPUT_BYTES,
        stdout: Buffer.concat(chunks.out).toString('utf8'),
        stderr: Buffer.concat(chunks.err).toString('utf8'),
      })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}

// ------------------------------------------------------------------- parsing

// A malformed answer is reported as malformed. Asking a model to salvage prose
// from a broken envelope is how an unparseable response becomes a confident one.
export function parsePeerOutput({ peer, stdout, lastMessage }) {
  const text = peer === 'codex' ? lastMessage : stdout
  if (!text || !text.trim()) return { status: 'peer_output_invalid', reason: 'The peer returned nothing.' }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { status: 'peer_output_invalid', reason: 'The peer response is not JSON.' }
  }
  if (peer === 'claude') {
    if (value.subtype && value.subtype !== 'success')
      return { status: 'peer_unavailable', reason: `claude returned subtype "${value.subtype}".` }
    const inner = value.structured_output ?? value.result
    if (inner === undefined)
      return { status: 'peer_output_invalid', reason: 'No structured_output in the claude envelope.' }
    if (typeof inner === 'string') {
      try {
        value = JSON.parse(inner)
      } catch {
        return { status: 'peer_output_invalid', reason: 'The claude result is not JSON.' }
      }
    } else value = inner
  }
  return { status: 'ok', response: value }
}

// Shallow on purpose: the schema was already enforced by the CLI. This catches
// the shapes the rest of this file indexes into, so a missing key surfaces here
// rather than as a crash three functions later.
export function validateShape(mode, r) {
  const items = mode === 'plan' ? r?.objections : r?.findings
  if (!r || typeof r !== 'object') return 'The response is not an object.'
  if (r.status !== 'ok' && r.status !== 'insufficient_context')
    return 'status must be "ok" or "insufficient_context".'
  if (!Array.isArray(r.files_read)) return 'files_read must be an array.'
  if (!Array.isArray(items)) return `${mode === 'plan' ? 'objections' : 'findings'} must be an array.`
  for (const it of items) {
    if (!it || typeof it.id !== 'string') return 'every item needs a string id.'
    if (!Array.isArray(it.evidence)) return `${it.id} has no evidence array.`
  }
  // A peer that read nothing answered from memory, whatever it says. That is the
  // single failure this whole exercise exists to avoid, so it is not a warning.
  if (r.status === 'ok' && r.files_read.length === 0)
    return 'status is "ok" but files_read is empty — the peer inspected no repository file.'
  return null
}

// ----------------------------------------------------------------- citations

export function parseLocator(locator) {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(String(locator).trim())
  if (!m) return null
  const from = Number(m[2])
  const to = m[3] ? Number(m[3]) : from
  if (from < 1 || to < from) return null
  return { path: m[1], from, to }
}

const squash = (s) => String(s).replace(/\s+/g, ' ').trim()

// Proves the text is there, and nothing more. Whether the quote *supports* the
// objection is judgement, and stays with the host.
export function checkCitation(repoRoot, locator, quote) {
  const at = parseLocator(locator)
  if (!at) return { ok: false, why: `"${locator}" is not a path:line locator.` }
  if (isAbsolute(at.path)) return { ok: false, why: 'the locator is an absolute path.' }
  let root
  let target
  try {
    root = realpathSync(repoRoot)
    target = realpathSync(resolve(root, at.path))
  } catch {
    return { ok: false, why: `${at.path} does not exist.` }
  }
  if (target !== root && !target.startsWith(root + sep))
    return { ok: false, why: `${at.path} resolves outside the repository.` }

  // Existing and inside the repo is not yet readable: a peer citing `src:1`
  // gets past both checks, and an unguarded read then throws EISDIR out of the
  // wrapper — turning one bad citation into no result at all.
  let lines
  try {
    if (!statSync(target).isFile()) return { ok: false, why: `${at.path} is not a file.` }
    lines = readFileSync(target, 'utf8').split('\n')
  } catch (err) {
    return { ok: false, why: `${at.path} could not be read (${err.code || err.message}).` }
  }
  if (at.to > lines.length)
    return { ok: false, why: `${at.path} has ${lines.length} lines, but line ${at.to} was cited.` }
  const cited = squash(lines.slice(at.from - 1, at.to).join(' '))
  if (!squash(quote)) return { ok: false, why: 'the citation carries no quote.' }
  if (!cited.includes(squash(quote)))
    return { ok: false, why: `the quoted text is not at ${at.path}:${at.from}.` }
  return { ok: true }
}

// An objection resting on a citation that does not hold up is dropped before
// anyone argues about it. Rejected here means never adjudicated — not "mentioned
// with a caveat", which is how a fabricated line ends up in a plan anyway.
export function verifyCitations(repoRoot, mode, response) {
  const items = (mode === 'plan' ? response.objections : response.findings) || []
  const kept = []
  const rejected = []
  for (const item of items) {
    const claims = []
    if (mode === 'diff' && item.location)
      claims.push({ locator: `${item.location.path}:${item.location.line}`, quote: item.location.quote })
    for (const e of item.evidence || [])
      if (e && e.kind !== 'plan') claims.push({ locator: e.locator, quote: e.quote })

    // A plan-only contradiction cites the plan, not the repo. Nothing to check
    // against the filesystem, and nothing to reject it for.
    if (!claims.length) {
      kept.push(item)
      continue
    }
    const bad = claims
      .map((c) => ({ c, r: checkCitation(repoRoot, c.locator, c.quote) }))
      .filter((x) => !x.r.ok)
    if (bad.length)
      rejected.push({ id: item.id, why: bad.map((b) => `${b.c.locator}: ${b.r.why}`) })
    else kept.push(item)
  }
  return { kept, rejected }
}

// ---------------------------------------------------------------------- main

export async function main(argv) {
  let cfg
  try {
    cfg = parseArgs(argv)
  } catch (err) {
    return { status: 'peer_unavailable', reason: err.message }
  }
  const repoRoot = resolve(cfg.cwd)
  // The child runs with its working directory set to the repo, so a relative
  // path means one thing to this process and another to the peer: the schema
  // would be looked for in the wrong place, and the peer would write its answer
  // somewhere this process never reads. Resolve everything the child sees, here,
  // against OUR cwd — which is what the caller meant when they typed it.
  const outDir = resolve(cfg.out)
  const schemaPath = resolve(cfg.schema)
  const promptPath = resolve(cfg.prompt)
  mkdirSync(outDir, { recursive: true })
  const lastMessagePath = join(outDir, 'peer-last-message.json')
  const base = { host: cfg.host, peer: cfg.peer, mode: cfg.mode }

  if (!existsSync(promptPath)) return { ...base, ...unavailable(`No prompt file at ${promptPath}.`) }
  if (!existsSync(schemaPath)) return { ...base, ...unavailable(`No schema file at ${schemaPath}.`) }

  const auth = checkAuth(cfg.peer)
  if (!auth.ok) return { ...base, ...auth }

  const { command, argv: args } = buildInvocation({
    peer: cfg.peer,
    cwd: repoRoot,
    schemaPath,
    lastMessagePath,
    model: cfg.model,
  })
  const started = Date.now()
  const run = await runBounded({
    command,
    argv: args,
    cwd: repoRoot,
    stdin: readFileSync(promptPath, 'utf8'),
    timeoutMs: cfg.timeoutMs,
  })
  const duration_ms = Date.now() - started
  const tail = (run.stderr || '').split('\n').filter(Boolean).slice(-10).join('\n')

  if (run.spawnError)
    return { ...base, duration_ms, ...unavailable(`Could not start \`${command}\`: ${run.spawnError.message}`) }
  // Whatever a timed-out peer managed to emit is a partial thought. Reading it
  // as advice is worse than having asked nobody.
  if (run.timedOut)
    return { ...base, duration_ms, ...unavailable(`\`${command}\` exceeded ${cfg.timeoutMs}ms and was killed.`) }
  if (run.truncated)
    return { ...base, duration_ms, ...unavailable(`\`${command}\` produced more than ${MAX_OUTPUT_BYTES} bytes.`) }
  if (run.code !== 0)
    return { ...base, duration_ms, ...unavailable(`\`${command}\` exited ${run.code}. ${tail}`.trim()) }

  const parsed = parsePeerOutput({
    peer: cfg.peer,
    stdout: run.stdout,
    lastMessage: existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8') : '',
  })
  if (parsed.status !== 'ok') return { ...base, duration_ms, ...parsed }

  const shapeError = validateShape(cfg.mode, parsed.response)
  if (shapeError) return { ...base, duration_ms, status: 'peer_output_invalid', reason: shapeError }

  // A peer that could not read the repository answered honestly, and that answer
  // is worth nothing to us: it is the one case this whole exercise exists to
  // avoid. Report it as unavailable rather than as a clean run with no findings,
  // so no caller has to know that a third status exists.
  if (parsed.response.status === 'insufficient_context')
    return {
      ...base,
      duration_ms,
      ...unavailable(
        `\`${cfg.peer}\` could not inspect the repository: ${parsed.response.context_error || 'no reason given'}`,
      ),
    }

  writeFileSync(join(outDir, 'PEER.json'), JSON.stringify(parsed.response, null, 2))
  const { kept, rejected } = verifyCitations(repoRoot, cfg.mode, parsed.response)
  const key = cfg.mode === 'plan' ? 'objections' : 'findings'
  return {
    ...base,
    status: 'ok',
    duration_ms,
    peer_status: parsed.response.status,
    files_read: parsed.response.files_read,
    [key]: kept,
    rejected_citations: rejected,
    artifact: join(outDir, 'PEER.json'),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  })
}

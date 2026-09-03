#!/usr/bin/env node
// peer-build.mjs — hand one plan step to the other CLI agent, in a worktree it
// may write to, and report what it touched.
//
// The peer writes; it does not get to say whether it succeeded. Everything
// with a right answer lives here: which binary, which flags, how long to wait,
// which files changed. Whether the step is *done* is decided by the build
// workflow's reviewer, who runs the step's Verify command, and by the guard,
// which scans the diff — exactly as for a host implementer. A second vendor's
// claim is still a claim.
//
// Usage:
//   node peer-build.mjs --host claude|codex --cwd <worktree> --plan <path> \
//     --step S-xxx --out <dir> [--model <m>] [--timeout-ms N]
//
// Exit code is 0 whenever the wrapper itself worked. The verdict is `status`
// on stdout: ok | peer_unavailable | peer_output_invalid.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBounded, checkAuth, PEER_OF, MAX_OUTPUT_BYTES } from './peer-run.mjs'
import { parsePlan } from './plan-steps.mjs'

export const DEFAULT_TIMEOUT_MS = 900_000

// ------------------------------------------------------------------ arguments

export function parseArgs(argv) {
  const out = { timeoutMs: DEFAULT_TIMEOUT_MS }
  const want = {
    '--host': 'host',
    '--cwd': 'cwd',
    '--plan': 'plan',
    '--step': 'step',
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
      if (!Number.isFinite(n) || n < 1000 || n > 7_200_000)
        throw new Error('--timeout-ms must be between 1000 and 7200000.')
      out.timeoutMs = n
    } else if (argv[i].startsWith('--')) throw new Error(`Unknown flag: ${argv[i]}`)
  }
  if (!PEER_OF[out.host]) throw new Error('--host must be "claude" or "codex".')
  for (const k of ['cwd', 'plan', 'step', 'out'])
    if (!out[k]) throw new Error(`--${k} is required.`)
  if (!/^S-\d{3}$/.test(out.step)) throw new Error('--step must be an S-xxx id.')
  out.peer = PEER_OF[out.host]
  return out
}

// -------------------------------------------------------------- the two CLIs

// Write access to the worktree and nothing more. No flag here bypasses an
// approval, widens the sandbox past the worktree, or lets the peer persist a
// session. A change to these arrays is a change to what a second vendor's model
// may do on this machine, and the tests pin every forbidden flag by name.
export function buildInvocation({ peer, cwd, lastMessagePath, model }) {
  if (peer === 'codex') {
    const argv = [
      'exec',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--color',
      'never',
      '--skip-git-repo-check',
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
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read,Glob,Grep,Edit,Write,Bash',
    '--no-session-persistence',
    '--disable-slash-commands',
  ]
  if (model) argv.push('--model', model)
  return { command: 'claude', argv }
}

// ------------------------------------------------------------------ the brief

export const FORBIDDEN = `YOU MAY NOT: skip, delete, weaken or .only a test; change an expected value to match what the code produces; add @ts-ignore, @ts-expect-error, eslint-disable, # type: ignore or # noqa; widen a type to any or "unknown as"; swallow an error in an empty catch; edit a gate command, a CI workflow, a Makefile target, or the plan file; commit; renumber or rename a step; touch a file the step does not name.

If the step cannot be completed without one of those, stop and say so in your final message, starting with the words BLOCKED BY. That answer is correct and useful.`

export function buildPrompt({ cwd, planPath, step }) {
  return `You are implementing one step of an approved plan, in an isolated worktree that is the only place you may write.

Worktree: ${cwd}
Plan: ${planPath}
Run every command from ${cwd}. Do not commit.

Implement exactly this step, and nothing else. The plan is the promise; this step is your whole scope.

${step.raw}

Rules:
- Touch only the files the step names under Files:. A file it does not name belongs to another step.
- Never guess a path or a symbol — open the file. The plan cites what it depends on; if a cited fact is wrong, say so and stop rather than improvising.
- When the change is in, run the Verify command exactly as written, from ${cwd}:
    ${step.verifyCmd}
  Expected: ${step.verifyExpected || 'see the step'}
- Your final message: the files you changed, one per line, then the Verify command's exit code and the first 15 lines of its output verbatim. Nothing else. A reviewer will run the command again; your report is not the evidence.

${FORBIDDEN}`
}

// ------------------------------------------------------------- what changed

function changedFiles(cwd) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    })
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim())
      .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
      .map((p) => p.replace(/^"|"$/g, ''))
  } catch {
    return null
  }
}

function mtimes(cwd, files) {
  const out = new Map()
  for (const f of files) {
    try {
      out.set(f, statSync(join(cwd, f)).mtimeMs)
    } catch {
      out.set(f, null)
    }
  }
  return out
}

// Files the peer touched: new in the status list, or modified since the
// snapshot. Earlier steps' changes are already in the worktree and stay out.
export function touchedSince(before, cwd, after) {
  return after.filter((f) => {
    if (!before.has(f)) return true
    let now = null
    try {
      now = statSync(join(cwd, f)).mtimeMs
    } catch {
      now = null
    }
    return now !== before.get(f)
  })
}

// ---------------------------------------------------------------------- main

function unavailable(reason, remedy) {
  return { status: 'peer_unavailable', reason, ...(remedy ? { remedy } : {}) }
}

export async function main(argv) {
  let cfg
  try {
    cfg = parseArgs(argv)
  } catch (err) {
    return { status: 'peer_unavailable', reason: err.message }
  }
  const cwd = resolve(cfg.cwd)
  const outDir = resolve(cfg.out)
  const planPath = isAbsolute(cfg.plan) ? cfg.plan : resolve(cwd, cfg.plan)
  const base = { host: cfg.host, peer: cfg.peer, step: cfg.step }

  if (!existsSync(cwd)) return { ...base, ...unavailable(`No worktree at ${cwd}.`) }
  if (!existsSync(planPath)) return { ...base, ...unavailable(`No plan at ${planPath}.`) }
  const plan = parsePlan(readFileSync(planPath, 'utf8'))
  if (plan.status !== 'approved') return { ...base, ...unavailable(`${cfg.plan} is not approved.`) }
  const step = plan.steps.find((s) => s.id === cfg.step)
  if (!step) return { ...base, ...unavailable(`${cfg.step} is not a step of ${cfg.plan}.`) }

  mkdirSync(outDir, { recursive: true })
  const lastMessagePath = join(outDir, 'peer-last-message.txt')
  const promptPath = join(outDir, 'prompt.md')
  const prompt = buildPrompt({ cwd, planPath: cfg.plan, step })
  writeFileSync(promptPath, prompt)

  const started = Date.now()
  const auth = checkAuth(cfg.peer, execFileSync, Math.floor(cfg.timeoutMs / 4))
  if (!auth.ok) return { ...base, duration_ms: Date.now() - started, ...auth }

  const beforeList = changedFiles(cwd)
  if (beforeList === null) return { ...base, ...unavailable(`${cwd} is not a git worktree.`) }
  const before = mtimes(cwd, beforeList)

  const { command, argv: args } = buildInvocation({
    peer: cfg.peer,
    cwd,
    lastMessagePath,
    model: cfg.model,
  })
  const run = await runBounded({
    command,
    argv: args,
    cwd,
    stdin: prompt,
    timeoutMs: Math.max(1000, cfg.timeoutMs - (Date.now() - started)),
  })
  const duration_ms = Date.now() - started
  const tail = (run.stderr || '').split('\n').filter(Boolean).slice(-10).join('\n')
  // This wrapper's own artifacts — the prompt, the last message — live under
  // the out dir, which is usually inside the worktree. They are not the peer's
  // work and must not be reviewed as if they were.
  const outRel = relative(cwd, outDir).split(sep).join('/')
  const ours = (f) => f.startsWith('.agents/') || (outRel && !outRel.startsWith('..') && f.startsWith(outRel + '/'))
  const after = (changedFiles(cwd) || []).filter((f) => !ours(f))
  const files_touched = touchedSince(before, cwd, after)

  if (run.spawnError)
    return { ...base, duration_ms, ...unavailable(`Could not start \`${command}\`: ${run.spawnError.message}`) }
  if (run.timedOut)
    return {
      ...base,
      duration_ms,
      files_touched,
      ...unavailable(`\`${command}\` exceeded ${cfg.timeoutMs}ms and was killed. The files it touched are still in the worktree; review them or revert.`),
    }
  if (run.truncated)
    return { ...base, duration_ms, files_touched, ...unavailable(`\`${command}\` produced more than ${MAX_OUTPUT_BYTES} bytes.`) }
  if (run.code !== 0)
    return { ...base, duration_ms, files_touched, ...unavailable(`\`${command}\` exited ${run.code}. ${tail}`.trim()) }

  // The last message is free text: what the peer says it did. It is recorded
  // for the reviewer's benefit and for the audit trail, and believed by nobody.
  let last_message = ''
  if (cfg.peer === 'codex') {
    last_message = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8') : ''
  } else {
    try {
      const env = JSON.parse(run.stdout)
      if (env.subtype && env.subtype !== 'success')
        return { ...base, duration_ms, files_touched, ...unavailable(`claude returned subtype "${env.subtype}".`) }
      last_message = typeof env.result === 'string' ? env.result : JSON.stringify(env.result ?? '')
    } catch {
      return { ...base, duration_ms, files_touched, status: 'peer_output_invalid', reason: 'The claude envelope is not JSON.' }
    }
    writeFileSync(lastMessagePath, last_message)
  }

  return {
    ...base,
    status: 'ok',
    duration_ms,
    files_touched,
    blocked_claimed: /^\s*BLOCKED BY/m.test(last_message),
    last_message: last_message.slice(0, 4000),
    artifact: lastMessagePath,
    prompt: promptPath,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cliArgs = process.argv.slice(2)
  if (cliArgs.includes('--help')) {
    process.stdout.write('Usage: node peer-build.mjs --host claude|codex --cwd <worktree> --plan <path> --step S-xxx --out <dir> [--model <m>] [--timeout-ms N]\n\nExample: node peer-build.mjs --host codex --cwd . --plan docs/plans/x.md --step S-001 --out .agents/peer --timeout-ms 900000\n')
    process.exit(0)
  }
  try {
    parseArgs(cliArgs)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  main(cliArgs).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  })
}

#!/usr/bin/env node
// stop-guard.mjs — refuse, once, to end a turn that changed source files and
// never ran verify.
//
// The skills make "done" mean "proven"; this hook is what makes that automatic
// rather than remembered. It is deterministic: two git commands, a few stats,
// no model. It blocks at most once per session, and only when every one of
// these holds — a source file is modified or new, no verify report is newer
// than the newest such file, and nobody opted out.
//
// Stdin: the Stop hook's JSON ({ session_id, cwd, stop_hook_active, ... }).
// Stdout: nothing, or the block decision. Exit code is always 0.
//
// Opt out: MAXGFR_NO_STOP_GUARD=1, or `"stop_guard": false` in
// $CODEX_HOME/verify.json, ~/.claude/verify.json, <repo>/.agents/verify.json,
// or the legacy <repo>/.claude/verify.json, according to the active host.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatInvocation, invocationOptions } from './invocation.mjs'
import { resolveConfig } from '../skills/verify/scripts/resolve-config.mjs'

export function reasonFor(env = process.env) {
  const call = formatInvocation('verify', ['<plan>'], invocationOptions(env))
  return `Source files changed since the last verify run. Run ${call} before finishing — or set MAXGFR_NO_STOP_GUARD=1 to skip this guard.`
}

export function stopBlock(env = process.env) {
  const reason = reasonFor(env)
  return {
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason },
  }
}

// Paths that are not source: a plan, a report, a note. Changing only these is
// not a change verify has anything to say about.
export const IGNORED_DIRS = ['docs/plans/', '.agents/', '.claude/', '.codex/', '.worktrees/']
export const IGNORED_FILES = /(\.(md|mdx|txt|rst)$)|(^|\/)(CHANGELOG|LICENSE)[^/]*$/i

export function isSource(path) {
  if (IGNORED_DIRS.some((d) => path.startsWith(d))) return false
  return !IGNORED_FILES.test(path)
}

function git(cwd, args, timeout) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', timeout })
}

export function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8')
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function optedOutByConfig(repoRoot, env) {
  const host = invocationOptions(env).host
  try {
    return resolveConfig({ cwd: repoRoot, host, env }).config.stop_guard === false
  } catch {
    // A malformed config must not disable a safety guard.
    return false
  }
}

// Modified or new files, repo-relative, that count as source.
export function changedSource(repoRoot) {
  const out = git(repoRoot, ['status', '--porcelain', '--untracked-files=all'], 1500)
  const files = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    let path = line.slice(3).trim()
    if (path.includes(' -> ')) path = path.split(' -> ')[1]
    path = path.replace(/^"|"$/g, '')
    if (isSource(path)) files.push(path)
  }
  return files
}

function newestMtime(root, files) {
  let newest = null
  for (const f of files) {
    try {
      const m = statSync(join(root, f)).mtimeMs
      if (newest === null || m > newest) newest = m
    } catch {
      /* deleted — no mtime to compare, handled by the caller */
    }
  }
  return newest
}

// The newest verify run directory's mtime, across both report locations.
export function newestReport(repoRoot) {
  let newest = null
  for (const base of ['.agents/verify', '.claude/verify']) {
    const dir = join(repoRoot, base)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      try {
        const m = statSync(join(dir, entry)).mtimeMs
        if (newest === null || m > newest) newest = m
      } catch {
        /* raced away */
      }
    }
  }
  return newest
}

function stateDir(env) {
  return env.MAXGFR_STOP_GUARD_STATE_DIR || env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'maxgfr-stop-guard')
}

// Returns null to let the turn end, or the block decision.
export function decide(input, env = process.env) {
  if (input.stop_hook_active) return null
  if (env.MAXGFR_NO_STOP_GUARD === '1') return null

  const cwd = input.cwd ? resolve(input.cwd) : process.cwd()
  let repoRoot
  try {
    repoRoot = git(cwd, ['rev-parse', '--show-toplevel'], 1000).trim()
  } catch {
    return null // not a git repo, or git is unavailable
  }
  if (optedOutByConfig(repoRoot, env)) return null

  let changed
  try {
    changed = changedSource(repoRoot)
  } catch {
    return null
  }
  if (!changed.length) return null

  const newestSource = newestMtime(repoRoot, changed)
  const report = newestReport(repoRoot)
  // Deleted-only changes have no mtime; a report cannot be shown to postdate
  // them, so they block like any other change.
  if (report !== null && newestSource !== null && report >= newestSource) return null

  const marker = join(stateDir(env), `stop-guard-${String(input.session_id || 'unknown').replace(/[^\w-]/g, '_')}`)
  if (existsSync(marker)) return null
  try {
    mkdirSync(stateDir(env), { recursive: true })
    writeFileSync(marker, String(Date.now()))
  } catch {
    /* no state dir — block anyway; it will block again, which is the lesser evil */
  }
  return stopBlock(env)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let out = null
  try {
    out = decide(readStdin())
  } catch (err) {
    process.stderr.write(`maxgfr stop-guard: ${err.message}\n`)
  }
  if (out) process.stdout.write(JSON.stringify(out) + '\n')
  process.exit(0)
}

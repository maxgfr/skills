#!/usr/bin/env node
// session-start.mjs — put the skill router in front of the model before its
// first message, and again after /clear and after a compaction.
//
// A skill the model never thinks to look up is a skill that never fires. This
// prints skills/using-maxgfr/SKILL.md as additional context, in whichever
// envelope the running host reads. The plugin root is taken from this file's
// own location, not from an environment variable, so it also works from a
// plain checkout.
//
// Usage:
//   node session-start.mjs           # the JSON envelope for the current host
//   node session-start.mjs --plain   # the raw Markdown, for AGENTS.md wiring
//
// Always exits 0: a router that failed to load must never block a session.

import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROUTER = 'skills/using-maxgfr/SKILL.md'

export function pluginRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function routerText(root = pluginRoot()) {
  return readFileSync(join(root, ROUTER), 'utf8')
}

export function payload(text) {
  return (
    '<EXTREMELY_IMPORTANT>\n' +
    'You have the maxgfr process skills: blueprint plans, build implements, verify proves.\n\n' +
    "**Below is the full content of the 'using-maxgfr' router skill. Follow it; invoke the three skills it names with the Skill tool.**\n\n" +
    text +
    '\n</EXTREMELY_IMPORTANT>'
  )
}

// Hosts disagree on the field name. Claude Code reads both `additional_context`
// and `hookSpecificOutput.additionalContext` and would inject twice, so the
// branches are exclusive — this mirrors what superpowers learned the hard way.
export function envelope(text, env = process.env) {
  const context = payload(text)
  if (env.CURSOR_PLUGIN_ROOT) return { additional_context: context }
  if (env.CLAUDE_PLUGIN_ROOT && !env.COPILOT_CLI)
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }
  return { additionalContext: context }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const text = routerText()
    if (process.argv.includes('--plain')) process.stdout.write(text)
    else process.stdout.write(JSON.stringify(envelope(text)) + '\n')
  } catch (err) {
    process.stderr.write(`maxgfr session-start: ${err.message}\n`)
  }
  process.exit(0)
}

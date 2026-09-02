#!/usr/bin/env node
// plan-steps.mjs — turn an approved blueprint plan into a build schedule.
//
// Which plan, which steps, in what order, which can run side by side: every one
// of those has a right answer, and a model asked to read them off a Markdown
// file will read them off a Markdown file that sometimes says something else.
// So the parsing lives here, and the workflow receives steps, not prose.
//
// Usage:
//   node plan-steps.mjs [--cwd <repo>] [--plan <path>] [--pretty]
//
// Output: JSON on stdout. `ok: false` carries a one-line `error` and the exit
// code is 1 — the skill prints that line and stops.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLAN_DIR = 'docs/plans'
export const STEP_ID = /S-\d{3}/g

// ------------------------------------------------------------ find the plan

// The plan the caller named, or else the most recently modified approved plan
// under docs/plans/. An unapproved plan is never picked up on its own: the
// approval gate is the one part of blueprint that never scales down.
export function findPlan(cwd, given) {
  if (given) {
    const path = isAbsolute(given) ? given : resolve(cwd, given)
    return existsSync(path) ? path : null
  }
  const dir = join(cwd, PLAN_DIR)
  if (!existsSync(dir)) return null
  let best = null
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue
    const path = join(dir, entry)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (frontmatter(text).status !== 'approved') continue
    const mtime = statSync(path).mtimeMs
    if (!best || mtime > best.mtime) best = { path, mtime }
  }
  return best ? best.path : null
}

// ------------------------------------------------------------------- parse

export function frontmatter(text) {
  if (!text.startsWith('---\n')) return {}
  const end = text.indexOf('\n---', 4)
  if (end === -1) return {}
  const fields = {}
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

function section(text, title) {
  const re = new RegExp(`^## ${title}\\s*$`, 'm')
  const m = re.exec(text)
  if (!m) return null
  const from = m.index + m[0].length
  const next = /^## /m.exec(text.slice(from))
  return text.slice(from, next ? from + next.index : undefined).trim()
}

// `- **Key:** value`, with continuation lines folded in until the next bullet
// at the same level.
function bullets(block) {
  const out = {}
  let key = null
  for (const line of block.split('\n')) {
    const m = /^- \*\*([^*]+?):\*\*\s*(.*)$/.exec(line)
    if (m) {
      key = m[1].trim().toLowerCase()
      out[key] = m[2].trim()
    } else if (key && /^\s+\S/.test(line)) {
      out[key] += '\n' + line.trim()
    } else if (key && line.trim() === '') {
      key = null
    }
  }
  return out
}

const BACKTICK = /`([^`]+)`/g

// A `Files:` entry names a path, possibly with a line range. Two steps that
// name the same file are serialised, and the range is not what decides that.
function filesOf(value) {
  if (!value) return []
  const files = []
  for (const m of value.matchAll(BACKTICK)) {
    const raw = m[1].trim()
    const path = raw.replace(/:\d+(?:-\d+)?$/, '')
    if (path && !files.includes(path)) files.push(path)
  }
  return files
}

function idsOf(value) {
  if (!value || /^none\b/i.test(value.trim())) return []
  return [...new Set(value.match(STEP_ID) || [])]
}

export function parsePlan(text) {
  const fm = frontmatter(text)
  const goal = section(text, 'Goal') || ''
  const orderText = section(text, 'Execution order') || ''
  const executionOrder = [...new Set(orderText.match(STEP_ID) || [])]

  const stepsBlock = section(text, 'Steps') || ''
  const steps = []
  const headers = [...stepsBlock.matchAll(/^### (S-\d{3})\s*[—–-]\s*(.*)$/gm)]
  headers.forEach((h, i) => {
    const from = h.index
    const to = i + 1 < headers.length ? headers[i + 1].index : stepsBlock.length
    const raw = stepsBlock.slice(from, to).trim()
    const b = bullets(raw)
    const verify = b['verify'] || ''
    const cmdMatch = /`([^`]+)`/.exec(verify)
    const arrow = verify.indexOf('→')
    steps.push({
      id: h[1],
      title: h[2].trim(),
      files: filesOf(b['files']),
      dependsOn: idsOf(b['depends on']),
      implements: (b['implements'] || '').match(/Q-\d{3}/g) || [],
      change: b['change'] || '',
      preserve: b['preserve'] || '',
      doneWhen: b['done when'] || '',
      verifyCmd: cmdMatch ? cmdMatch[1].trim() : null,
      verifyExpected: arrow >= 0 ? verify.slice(arrow + 1).trim() : '',
      raw,
    })
  })

  return { status: fm.status || null, frontmatter: fm, goal, executionOrder, steps }
}

// ----------------------------------------------------------------- schedule

// Kahn layering: a wave is every step whose dependencies all sit in earlier
// waves. Then each wave is split so that two steps naming the same file — or a
// step naming none, which could touch anything — never run side by side. The
// implementers share one worktree; "they probably will not collide" is not a
// scheduling policy.
export function waves(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]))
  for (const s of steps)
    for (const d of s.dependsOn)
      if (!byId.has(d)) return { error: `${s.id} depends on ${d}, which is not a step in this plan.` }

  const placed = new Set()
  const layers = []
  let remaining = steps.slice()
  while (remaining.length) {
    const ready = remaining.filter((s) => s.dependsOn.every((d) => placed.has(d)))
    if (!ready.length)
      return { error: `Dependency cycle among ${remaining.map((s) => s.id).join(', ')}.` }
    layers.push(ready)
    for (const s of ready) placed.add(s.id)
    remaining = remaining.filter((s) => !placed.has(s.id))
  }

  const out = []
  for (const layer of layers) {
    const groups = []
    for (const s of layer) {
      if (!s.files.length) {
        groups.push({ files: null, ids: [s.id] })
        continue
      }
      const fits = groups.find(
        (g) => g.files !== null && !g.files.some((f) => s.files.includes(f)),
      )
      if (fits) {
        fits.ids.push(s.id)
        fits.files.push(...s.files)
      } else groups.push({ files: s.files.slice(), ids: [s.id] })
    }
    for (const g of groups) out.push(g.ids)
  }
  return { waves: out }
}

// -------------------------------------------------------------------- main

export function schedule(cwd, given) {
  const planPath = findPlan(cwd, given)
  if (!planPath)
    return {
      ok: false,
      error: given
        ? `No plan at ${given}.`
        : `No approved plan under ${PLAN_DIR}/ — run /blueprint first, or name the plan: /build <path>.`,
    }
  const plan = parsePlan(readFileSync(planPath, 'utf8'))
  const rel = relative(cwd, planPath) || planPath
  if (plan.status !== 'approved')
    return {
      ok: false,
      planPath: rel,
      error: `${rel} is ${plan.status ? `"${plan.status}"` : 'missing a status'}, not approved. Approve it in blueprint first; build never starts on an unapproved plan.`,
    }
  if (!plan.steps.length) return { ok: false, planPath: rel, error: `${rel} has no S-xxx steps.` }
  const noVerify = plan.steps.filter((s) => !s.verifyCmd)
  if (noVerify.length)
    return {
      ok: false,
      planPath: rel,
      error: `${noVerify.map((s) => s.id).join(', ')} ${noVerify.length > 1 ? 'have' : 'has'} no \`Verify:\` command. A step with no command cannot be proven done; fix the plan.`,
    }
  const w = waves(plan.steps)
  if (w.error) return { ok: false, planPath: rel, error: w.error }
  return {
    ok: true,
    planPath: rel,
    status: plan.status,
    goal: plan.goal,
    executionOrder: plan.executionOrder,
    steps: plan.steps,
    waves: w.waves,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const argFor = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 && args[i + 1] ? args[i + 1] : null
  }
  const cwd = resolve(argFor('--cwd') ?? process.cwd())
  const result = schedule(cwd, argFor('--plan'))
  process.stdout.write(JSON.stringify(result, null, args.includes('--pretty') ? 2 : 0) + '\n')
  process.exit(result.ok ? 0 : 1)
}

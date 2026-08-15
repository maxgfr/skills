#!/usr/bin/env node
// validate-skills.mjs — the repo's own gate. Zero dependencies.
//
// A skill that never triggers is dead weight, and a skill pointing at a file
// that does not exist wastes a real agent's turn discovering it. Both are
// caught here, in CI, before anyone installs the thing.
//
// Usage: node scripts/validate-skills.mjs [--quiet]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, basename, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const quiet = process.argv.includes('--quiet')

// Claude Code's skill listing caps each entry's combined description +
// when_to_use at this many characters, then truncates.
export const LISTING_CAP = 1536

// A description routes if it says when to invoke the skill. That can be phrased
// several ways; only demanding "Use when" flags perfectly good skills.
export const TRIGGER =
  /\buse\s+(when|this|for)\b|\btriggers?\b\s*[:—-]|\binvoke\s+(when|this|it|without)\b|\bwhen the user\b|\buse it when\b|\bfor when\b/i
// Paths a SKILL.md points at, which must resolve inside the skill directory.
// The lookbehind matters: without it `.github/scripts/build.mjs` yields a bare
// `scripts/build.mjs`, which is then looked for inside the skill and reported
// missing — flagging a path that is perfectly correct as written.
export function extractReferences(body) {
  const refs = new Set()
  for (const m of body.matchAll(/\]\(([^)#]+\.(?:md|mjs|js|sh|json))\)/g)) refs.add(m[1])
  for (const m of body.matchAll(/`((?:references|scripts|workflows|assets)\/[^`\s]+)`/g))
    refs.add(m[1])
  for (const m of body.matchAll(
    /(?<![\w/.-])((?:references|scripts|workflows)\/[A-Za-z0-9._-]+\.(?:md|mjs))\b/g,
  ))
    refs.add(m[1])
  return refs
}

const problems = []
const checked = []

function fail(file, message) {
  problems.push({ file: relative(root, file), message })
}

// ------------------------------------------------------------- discovery

function findSkills(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (!statSync(full).isDirectory()) continue
    if (existsSync(join(full, 'SKILL.md'))) out.push(full)
    else findSkills(full, out)
  }
  return out
}

// ----------------------------------------------------------- frontmatter

function parseFrontmatter(text, file) {
  if (!text.startsWith('---\n')) {
    fail(file, 'SKILL.md must open with a YAML frontmatter block (---).')
    return null
  }
  const end = text.indexOf('\n---', 4)
  if (end === -1) {
    fail(file, 'Frontmatter block is never closed.')
    return null
  }
  const block = text.slice(4, end)
  const fields = {}
  let currentKey = null
  for (const line of block.split('\n')) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (m) {
      currentKey = m[1]
      fields[currentKey] = m[2].trim()
    } else if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] += ' ' + line.trim()
    }
  }
  for (const key of Object.keys(fields)) {
    fields[key] = fields[key].replace(/^["']|["']$/g, '')
  }
  return { fields, body: text.slice(end + 4) }
}

// ---------------------------------------------------------------- checks

// Importing this file for its constants must not run the validation: the run
// ends in process.exit(1), which would kill an importing test file outright —
// reporting the test as the failure and never running its assertions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

function main() {
  const skillDirs = findSkills(join(root, 'skills'))

  if (!skillDirs.length) problems.push({ file: 'skills/', message: 'No SKILL.md found anywhere.' })

  for (const dir of skillDirs) {
    const file = join(dir, 'SKILL.md')
    const text = readFileSync(file, 'utf8')
    const parsed = parseFrontmatter(text, file)
    if (!parsed) continue
    const { fields, body } = parsed
    const dirName = basename(dir)
    checked.push(dirName)

    if (!fields.name) fail(file, 'Frontmatter is missing "name".')
    else if (fields.name !== dirName)
      fail(file, `name "${fields.name}" does not match its directory "${dirName}".`)
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name))
      fail(file, `name "${fields.name}" must be lowercase kebab-case.`)

    const desc = fields.description
    if (!desc) fail(file, 'Frontmatter is missing "description".')
    else {
      if (desc.length < 40)
        fail(
          file,
          `description is ${desc.length} chars — too short to route on. Say when to use it.`,
        )

      // Claude Code truncates a listing entry's combined description + when_to_use
      // at 1,536 characters (skillListingMaxDescChars). Past that the tail is
      // simply never seen, so triggers hidden at the end stop working.
      const listed = desc.length + (fields.when_to_use || '').length
      if (listed > LISTING_CAP)
        fail(
          file,
          `description + when_to_use is ${listed} chars — ${listed - LISTING_CAP} past the ${LISTING_CAP}-char listing cap, so the tail is truncated. Put the key use case first and cut the rest.`,
        )

      if (!TRIGGER.test(desc + ' ' + (fields.when_to_use || '')))
        fail(
          file,
          'description must state when to invoke it ("Use when ...", "Triggers: ...", "Invoke when ..."), otherwise the agent cannot decide to run it.',
        )
    }

    const referenced = extractReferences(body)

    for (const ref of referenced) {
      if (/^https?:/.test(ref)) continue
      const target = join(dir, ref)
      if (!existsSync(target)) fail(file, `references a file that does not exist: ${ref}`)
    }

    // Every .mjs the skill ships must parse.
    for (const entry of existsSync(join(dir, 'scripts')) ? readdirSync(join(dir, 'scripts')) : []) {
      if (!entry.endsWith('.mjs')) continue
      const script = join(dir, 'scripts', entry)
      try {
        execFileSync(process.execPath, ['--check', script], { stdio: 'pipe' })
      } catch (err) {
        fail(script, `does not parse: ${String(err.stderr || err).split('\n')[1] || err.message}`)
      }
    }

    // Workflow scripts run inside a wrapper that permits top-level return, so a
    // plain `node --check` rejects a perfectly valid one. Compile the body the
    // way the runtime will — without ever running it.
    const wfDir = join(dir, 'workflows')
    for (const entry of existsSync(wfDir) ? readdirSync(wfDir) : []) {
      if (!entry.endsWith('.mjs')) continue
      const script = join(wfDir, entry)
      const src = readFileSync(script, 'utf8')
      if (!/^export\s+const\s+meta\s*=\s*\{/m.test(src))
        fail(script, 'a workflow script must start with `export const meta = { ... }`.')
      try {
        // eslint-disable-next-line no-new-func
        new Function(`async function __workflow(args, agent, parallel, pipeline, phase, log) {
${src.replace(/^export\s+const\s+meta\s*=/m, 'const meta =')}
}`)
      } catch (err) {
        fail(script, `does not parse as a workflow body: ${err.message}`)
      }
      for (const forbidden of ['Date.now(', 'Math.random(']) {
        if (src.includes(forbidden))
          fail(script, `uses ${forbidden}) — non-determinism breaks workflow resume.`)
      }
    }

    // References should not be orphans — an unlinked reference is one the agent never reads.
    const refDir = join(dir, 'references')
    if (existsSync(refDir)) {
      for (const entry of readdirSync(refDir)) {
        if (!entry.endsWith('.md')) continue
        if (!body.includes(`references/${entry}`))
          fail(file, `references/${entry} exists but SKILL.md never points at it.`)
      }
    }
  }

  // --------------------------------------------------- plugin manifest sync

  const pluginPath = join(root, '.claude-plugin', 'plugin.json')
  if (existsSync(pluginPath)) {
    let plugin = null
    try {
      plugin = JSON.parse(readFileSync(pluginPath, 'utf8'))
    } catch (err) {
      fail(pluginPath, `is not valid JSON: ${err.message}`)
    }
    if (plugin) {
      const declared = new Set((plugin.skills || []).map((p) => p.replace(/^\.\//, '')))
      const actual = new Set(skillDirs.map((d) => relative(root, d)))
      for (const d of declared)
        if (!actual.has(d)) fail(pluginPath, `declares "${d}", which is not a skill directory.`)
      for (const d of actual)
        if (!declared.has(d)) fail(pluginPath, `does not declare the skill at "${d}".`)
    }
  }

  const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
  if (existsSync(marketplacePath)) {
    let marketplace = null
    try {
      marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'))
    } catch (err) {
      fail(marketplacePath, `is not valid JSON: ${err.message}`)
    }
    // The plugin's name is the namespace its skills are invoked under
    // (`<plugin>:<skill>`). A marketplace advertising a different name installs
    // nothing, and the failure surfaces only when a user tries it.
    if (marketplace && existsSync(pluginPath)) {
      const pluginName = JSON.parse(readFileSync(pluginPath, 'utf8')).name
      const advertised = (marketplace.plugins || []).map((p) => p.name)
      if (!advertised.includes(pluginName)) {
        fail(
          marketplacePath,
          `advertises ${JSON.stringify(advertised)} but plugin.json is named "${pluginName}".`,
        )
      }
    }
  }

  // ---------------------------------------------------------------- output

  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem${problems.length > 1 ? 's' : ''}\n`)
    for (const p of problems) console.error(`  ${p.file}\n    ${p.message}`)
    console.error('')
    process.exit(1)
  }

  if (!quiet) console.log(`✓ ${checked.length} skill(s) valid: ${checked.join(', ')}`)
}

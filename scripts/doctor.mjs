#!/usr/bin/env node
// Read-only compatibility doctor for the two supported hosts.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { error: error.message }
  }
}

function executable(name) {
  return spawnSync('sh', ['-c', 'command -v "$1"', 'doctor', name], { encoding: 'utf8' }).status === 0
}

export function doctor({ host, root, env = process.env } = {}) {
  const pluginRoot = resolve(root || dirname(dirname(fileURLToPath(import.meta.url))))
  const checks = []
  const add = (id, ok, detail, required = true) => checks.push({ id, ok, required, detail })
  const manifestPath = join(pluginRoot, host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json')
  const manifestRead = readJson(manifestPath)
  const manifest = manifestRead.value
  const expectedSkills = ['./skills/blueprint', './skills/build', './skills/verify']
  const skillContract = host === 'codex'
    ? manifest?.skills === './skills/'
    : JSON.stringify(manifest?.skills) === JSON.stringify(expectedSkills)
  add('manifest', Boolean(manifest && manifest.name === 'maxgfr' && skillContract), manifest ? `${manifestPath}; skills=${JSON.stringify(manifest.skills)}` : `${manifestPath}: ${manifestRead.error || 'missing'}`)

  let skills = []
  if (host === 'claude' && Array.isArray(manifest?.skills)) {
    skills = manifest.skills
      .filter((entry) => existsSync(join(pluginRoot, entry, 'SKILL.md')))
      .map((entry) => entry.split('/').filter(Boolean).at(-1))
  } else {
    const dir = join(pluginRoot, 'skills')
    if (existsSync(dir)) skills = readdirSync(dir).filter((name) => existsSync(join(dir, name, 'SKILL.md'))).sort()
  }
  add('skills', skills.length === 3 && ['blueprint', 'build', 'verify'].every((name) => skills.includes(name)), `${skills.length} public skills: ${skills.join(', ') || 'none'}`)

  const hooksPath = host === 'codex' && manifest?.hooks
    ? join(pluginRoot, manifest.hooks)
    : join(pluginRoot, 'hooks', 'hooks.json')
  const hooksRead = readJson(hooksPath)
  const hooks = hooksRead.value?.hooks
  add('hooks', Boolean(hooks?.SessionStart && hooks?.Stop), hooks ? hooksPath : `${hooksPath}: ${hooksRead.error || 'missing'}`)
  add('router', existsSync(join(pluginRoot, 'hooks', 'router.md')), join(pluginRoot, 'hooks', 'router.md'))

  const marketplace = join(pluginRoot, '.agents', 'plugins', 'marketplace.json')
  add('marketplace', host !== 'codex' || Boolean(readJson(marketplace).value), marketplace, false)
  add('node', Number(process.versions.node.split('.')[0]) >= 18, `Node ${process.versions.node}`)

  const peer = host === 'codex' ? 'claude' : 'codex'
  add('peer-cli', executable(peer), executable(peer) ? `${peer} is available for crosscheck` : `${peer} is optional; crosscheck will report unavailable`, false)

  const home = env.HOME || homedir()
  const configPath = host === 'codex'
    ? join(env.CODEX_HOME || join(home, '.codex'), 'verify.json')
    : join(home, '.claude', 'verify.json')
  const firstInvocation = host === 'codex' ? '$blueprint' : '/maxgfr:blueprint'
  return {
    ok: checks.filter((check) => check.required).every((check) => check.ok),
    host,
    root: pluginRoot,
    skills,
    config_path: configPath,
    first_invocation: firstInvocation,
    checks,
  }
}

function textReport(result) {
  const lines = [`maxgfr doctor: ${result.ok ? 'PASS' : 'FAIL'} (${result.host})`]
  for (const check of result.checks) lines.push(`${check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'} ${check.id}: ${check.detail}`)
  lines.push(`Config: ${result.config_path}`, `Try: ${result.first_invocation}`)
  return lines.join('\n') + '\n'
}

function cli(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node scripts/doctor.mjs --host codex|claude [--root PLUGIN] [--json]\n\nExample: node scripts/doctor.mjs --host codex --json\n')
    return 0
  }
  let host = null
  let root = null
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') {
      json = true
      continue
    }
    if (!['--host', '--root'].includes(argv[i])) throw new Error(`Unknown flag: ${argv[i]}`)
    if (!argv[i + 1]) throw new Error(`${argv[i]} needs a value.`)
    if (argv[i] === '--host') host = argv[++i]
    else root = argv[++i]
  }
  if (!['codex', 'claude'].includes(host)) throw new Error('--host must be codex or claude.')
  const result = doctor({ host, root })
  process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : textReport(result))
  return result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = cli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

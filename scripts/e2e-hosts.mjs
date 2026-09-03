#!/usr/bin/env node
// Cross-host contract test. The default path is deterministic and safe for CI;
// --live additionally asks the installed CLIs to parse their plugin surfaces.

import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { doctor } from './doctor.mjs'
import { envelope, routerText } from '../hooks/session-start.mjs'
import { schedule } from '../skills/build/scripts/plan-steps.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const promptFixture = JSON.parse(readFileSync(join(pluginRoot, 'tests/fixtures/host-prompts.json'), 'utf8'))

function check(id, ok, detail) {
  return { id, ok, detail }
}

function hostContract(host) {
  const diagnosis = doctor({ host, root: pluginRoot })
  const env = host === 'codex'
    ? { PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_ROOT: pluginRoot }
    : { CLAUDE_PLUGIN_ROOT: pluginRoot }
  const injected = envelope(routerText(pluginRoot), env)
  const context = host === 'codex' ? injected.additionalContext : injected.hookSpecificOutput?.additionalContext
  const manifestPath = join(pluginRoot, host === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const expected = host === 'codex' ? ['$blueprint', '$build', '$verify'] : ['/maxgfr:blueprint', '/maxgfr:build', '/maxgfr:verify']
  const checks = [
    ...diagnosis.checks.filter((item) => item.required).map((item) => check(`doctor:${item.id}`, item.ok, item.detail)),
    check('public-skills', diagnosis.skills.join(',') === 'blueprint,build,verify', diagnosis.skills.join(', ')),
    check('invocation-syntax', expected.every((call) => context?.includes(call)), expected.join(', ')),
    check('internal-router', !diagnosis.skills.includes('using-maxgfr') && context?.includes('# maxgfr process router'), 'router injected but not public'),
    check('manifest', manifest.name === 'maxgfr', manifestPath),
  ]
  return { host, ok: checks.every((item) => item.ok), skills: diagnosis.skills, checks }
}

function invocation(host, skill) {
  return host === 'codex' ? `$${skill}` : `/maxgfr:${skill}`
}

function behaviorHost(host) {
  const router = routerText(pluginRoot).toLowerCase()
  const publicSkills = new Set(doctor({ host, root: pluginRoot }).skills)
  const env = host === 'codex'
    ? { PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_ROOT: pluginRoot }
    : { CLAUDE_PLUGIN_ROOT: pluginRoot }
  const injected = envelope(routerText(pluginRoot), env)
  const context = String(host === 'codex' ? injected.additionalContext : injected.hookSpecificOutput?.additionalContext).toLowerCase()
  const cases = promptFixture.selection.map((item) => {
    const skillText = readFileSync(join(pluginRoot, 'skills', item.skill, 'SKILL.md'), 'utf8').toLowerCase()
    const call = invocation(host, item.skill)
    const renderedPrompt = item.explicit ? `${call} ${item.prompt}` : item.prompt
    const triggerPresent = item.explicit ? context.includes(call.toLowerCase()) : skillText.includes(item.prompt.toLowerCase())
    return { ...item, kind: 'selection', prompt: renderedPrompt, expected: item.skill, ok: publicSkills.has(item.skill) && triggerPresent }
  })
  const counterEvidence = {
    tdd: ['tdd', 'red-green'],
    'diagnosing-bugs': ['debugging a failure'],
    'code-review': ['reviewing a diff or pr'],
    brainstorming: ['brainstorming without a written implementation-plan deliverable'],
  }
  for (const item of promptFixture.counter_prompts) {
    const evidence = counterEvidence[item.expected] || []
    cases.push({ ...item, kind: 'counter-prompt', ok: evidence.some((needle) => router.includes(needle)) })
  }
  return { host, ok: cases.every((item) => item.ok), cases }
}

function run(command, argv, cwd) {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${argv.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  return (result.stdout || '').trim()
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function reports(root) {
  const agents = join(root, '.agents')
  const found = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'BUILD.md' || entry.name === 'REPORT.md') found.push(path.slice(root.length + 1))
    }
  }
  try { walk(agents) } catch (error) { if (error.code !== 'ENOENT') throw error }
  return found.sort()
}

function snapshot(repo, sourceRoot) {
  const refs = run('git', ['show-ref'], repo).split('\n').filter(Boolean).sort()
  const worktrees = run('git', ['worktree', 'list', '--porcelain'], repo)
    .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9)).sort()
  return { source: digest(join(sourceRoot, 'src/app.mjs')), refs, worktrees, reports: reports(sourceRoot) }
}

function chainFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'maxgfr-host-matrix-'))
  const repo = join(fixtureRoot, 'repo')
  const worktree = join(fixtureRoot, 'worktree')
  try {
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/app.mjs'), 'export const value = 1\n')
    run('git', ['init', '-b', 'main'], repo)
    run('git', ['config', 'user.name', 'maxgfr fixture'], repo)
    run('git', ['config', 'user.email', 'fixture@example.invalid'], repo)
    run('git', ['add', 'src/app.mjs'], repo)
    run('git', ['commit', '-m', 'fixture baseline'], repo)
    const before = snapshot(repo, repo)

    mkdirSync(join(repo, 'docs/plans'), { recursive: true })
    writeFileSync(join(repo, 'docs/plans/fixture.md'), `---\nstatus: approved\n---\n## Goal\nExercise the three-skill chain.\n## Execution order\nS-001\n## Steps\n### S-001 — Change source\n- **Files:** \`src/app.mjs\`\n- **Depends on:** none\n- **Change:** export value 2\n- **Verify:** \`node --check src/app.mjs\` → exit 0\n`)
    const planned = schedule(repo, 'docs/plans/fixture.md')
    run('git', ['add', 'docs/plans/fixture.md'], repo)
    run('git', ['commit', '-m', 'blueprint fixture'], repo)

    run('git', ['worktree', 'add', '-b', 'build/fixture', worktree], repo)
    writeFileSync(join(worktree, 'src/app.mjs'), 'export const value = 2\n')
    const proof = spawnSync(process.execPath, ['--check', 'src/app.mjs'], { cwd: worktree, encoding: 'utf8' })
    mkdirSync(join(worktree, '.agents/build/fixture'), { recursive: true })
    writeFileSync(join(worktree, '.agents/build/fixture/BUILD.md'), `status: built\nverify_exit_code: ${proof.status}\n`)
    mkdirSync(join(worktree, '.agents/verify/fixture'), { recursive: true })
    writeFileSync(join(worktree, '.agents/verify/fixture/REPORT.md'), `verdict: ${proof.status === 0 ? 'PASS' : 'FAIL'}\ncommand: node --check src/app.mjs\nexit_code: ${proof.status}\n`)
    const after = snapshot(repo, worktree)
    const steps = [
      { skill: 'blueprint', ok: planned.ok && planned.planPath === 'docs/plans/fixture.md' },
      { skill: 'build', ok: proof.status === 0 && after.reports.includes('.agents/build/fixture/BUILD.md') },
      { skill: 'verify', ok: proof.status === 0 && after.reports.includes('.agents/verify/fixture/REPORT.md') },
    ]
    return { ok: steps.every((item) => item.ok), steps, before, after }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

function behaviorMatrix() {
  const refusals = promptFixture.refusals.map((item) => ({
    ...item,
    ok: readFileSync(join(pluginRoot, 'skills', item.skill, 'SKILL.md'), 'utf8').toLowerCase().includes(item.expected),
  }))
  const hosts = ['codex', 'claude'].map(behaviorHost)
  const chain = chainFixture()
  return { ok: hosts.every((item) => item.ok) && refusals.every((item) => item.ok) && chain.ok, hosts, refusals, chain }
}

function liveCommand(command, argv, options = {}) {
  const run = spawnSync(command, argv, { cwd: pluginRoot, encoding: 'utf8', timeout: 60_000, ...options })
  return {
    command: [command, ...argv].join(' '),
    ok: run.status === 0,
    exit_code: run.status,
    output: `${run.stdout || ''}${run.stderr || ''}`.trim().split('\n').slice(0, 15),
  }
}

function liveCodexInstall() {
  const codexHome = mkdtempSync(join(tmpdir(), 'maxgfr-codex-e2e-'))
  const env = { ...process.env, CODEX_HOME: codexHome }
  try {
    const steps = [
      liveCommand('codex', ['plugin', 'marketplace', 'add', pluginRoot], { env }),
      liveCommand('codex', ['plugin', 'add', 'maxgfr@maxgfr-skills'], { env }),
      liveCommand('codex', ['plugin', 'list'], { env }),
    ]
    const listing = steps.at(-1).output.join('\n')
    return {
      command: 'isolated Codex marketplace install',
      ok: steps.every((step) => step.ok) && /maxgfr@maxgfr-skills\s+installed, enabled\s+1\.3\.3/.test(listing),
      exit_code: steps.find((step) => !step.ok)?.exit_code ?? 0,
      output: steps.flatMap((step) => [`$ ${step.command}`, ...step.output]).slice(0, 30),
    }
  } finally {
    rmSync(codexHome, { recursive: true, force: true })
  }
}

function liveContracts() {
  return [
    liveCodexInstall(),
    liveCommand('claude', ['plugin', 'validate', pluginRoot]),
  ]
}

export function runContracts({ live = false } = {}) {
  const hosts = ['codex', 'claude'].map(hostContract)
  const matrix = behaviorMatrix()
  const liveResults = live ? liveContracts() : null
  return {
    ok: hosts.every((host) => host.ok) && matrix.ok && (!liveResults || liveResults.every((result) => result.ok)),
    hosts,
    matrix,
    live: liveResults,
  }
}

function textReport(result) {
  const lines = [`maxgfr host contract: ${result.ok ? 'PASS' : 'FAIL'}`]
  for (const host of result.hosts) lines.push(`${host.ok ? 'PASS' : 'FAIL'} ${host.host}: ${host.skills.join(', ')}`)
  lines.push(`${result.matrix.ok ? 'PASS' : 'FAIL'} behavior matrix: selection, counter-prompts, refusals, blueprint → build → verify`)
  for (const item of result.live || []) lines.push(`${item.ok ? 'PASS' : 'FAIL'} ${item.command}${item.output.length ? ` — ${item.output[0]}` : ''}`)
  return lines.join('\n') + '\n'
}

function cli(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node scripts/e2e-hosts.mjs [--json] [--live]\n\nExample: node scripts/e2e-hosts.mjs --live --json\n')
    return 0
  }
  for (const arg of argv) if (!['--json', '--live'].includes(arg)) throw new Error(`Unknown flag: ${arg}`)
  const result = runContracts({ live: argv.includes('--live') })
  process.stdout.write(argv.includes('--json') ? JSON.stringify(result, null, 2) + '\n' : textReport(result))
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

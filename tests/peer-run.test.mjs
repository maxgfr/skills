// peer-run.mjs, exercised against fake `codex` and `claude` binaries on PATH.
// No test here reaches a real model: the point is to prove the wrapper's failure
// handling, and a test that needs the network is a test that stops running.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(join(root, 'skills/blueprint/scripts/peer-run.mjs'))
const {
  parseArgs,
  buildInvocation,
  checkCitation,
  verifyCitations,
  validateShape,
  parsePeerOutput,
  main,
  PEER_OF,
} = mod

const SCHEMA = join(root, 'skills/blueprint/scripts/schema-diff.json')

function scratch() {
  return mkdtempSync(join(tmpdir(), 'peer-run-'))
}

// A fake CLI: `auth`/`login status` decides authentication, everything else is
// the run itself. Written as a node script so the tests stay portable.
function fakeCli(binDir, name, body) {
  const file = join(binDir, name)
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`)
  chmodSync(file, 0o755)
}

function withPath(binDir, fn) {
  const saved = process.env.PATH
  process.env.PATH = `${binDir}:${saved}`
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = saved
  })
}

// ------------------------------------------------------------------ arguments

test('parseArgs accepts a complete invocation and derives the peer', () => {
  const cfg = parseArgs(['--host', 'claude', '--mode', 'plan', '--cwd', '.', '--prompt', 'p', '--schema', 's', '--out', 'o'])
  assert.equal(cfg.peer, 'codex')
  assert.equal(cfg.timeoutMs, 300_000)
})

test('parseArgs refuses a host that is not one of the two', () => {
  assert.throws(() => parseArgs(['--host', 'gemini', '--mode', 'plan', '--cwd', '.', '--prompt', 'p', '--schema', 's', '--out', 'o']), /--host/)
})

test('parseArgs refuses an unknown mode, an unknown flag and an out-of-range timeout', () => {
  const base = ['--host', 'claude', '--cwd', '.', '--prompt', 'p', '--schema', 's', '--out', 'o']
  assert.throws(() => parseArgs([...base, '--mode', 'review']), /--mode/)
  assert.throws(() => parseArgs([...base, '--mode', 'plan', '--danger']), /Unknown flag/)
  assert.throws(() => parseArgs([...base, '--mode', 'plan', '--timeout-ms', '10']), /timeout-ms/)
})

test('the peer is always the other agent', () => {
  assert.equal(PEER_OF.claude, 'codex')
  assert.equal(PEER_OF.codex, 'claude')
})

test('an unresolved host degrades instead of guessing one', async () => {
  // verify's lane E passes the literal string `unresolved` when Phase 0 could
  // not say which agent it is running inside. Guessing would ask a CLI to
  // consult itself, so the only safe answer is to decline — with exit 0 and a
  // status the lane can report, not a crash.
  const res = await main(['--host', 'unresolved', '--mode', 'diff', '--cwd', '.', '--prompt', 'p', '--schema', 's', '--out', 'o'])
  assert.equal(res.status, 'peer_unavailable')
  assert.match(res.reason, /--host must be/)
})

// -------------------------------------------------------------- the two CLIs

test('the codex invocation is read-only and takes its prompt on stdin', () => {
  const { command, argv } = buildInvocation({ peer: 'codex', cwd: '/repo', schemaPath: SCHEMA, lastMessagePath: '/out/m.json' })
  assert.equal(command, 'codex')
  assert.deepEqual(argv.slice(0, 4), ['exec', '--ephemeral', '--sandbox', 'read-only'])
  assert.equal(argv.at(-1), '-')
  assert.ok(argv.includes('--output-last-message'))
})

test('the claude invocation is restricted to read-only tools', () => {
  const { command, argv } = buildInvocation({ peer: 'claude', cwd: '/repo', schemaPath: SCHEMA, lastMessagePath: '/out/m.json' })
  assert.equal(command, 'claude')
  assert.ok(argv.includes('-p'))
  assert.ok(argv.includes('--restricted'))
  assert.deepEqual(argv[argv.indexOf('--tools') + 1], 'Read,Glob,Grep')
})

// A guard that only ever refuses is a guard nobody proved lets the right thing
// through — so both directions, per AGENTS.md.
test('neither invocation can carry a flag that lets the peer write or skip approval', () => {
  const forbidden = [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    'workspace-write',
    'danger-full-access',
    '--add-dir',
  ]
  for (const peer of ['codex', 'claude']) {
    const { argv } = buildInvocation({ peer, cwd: '/repo', schemaPath: SCHEMA, lastMessagePath: '/out/m.json' })
    for (const flag of forbidden) assert.ok(!argv.includes(flag), `${peer} argv carries ${flag}`)
  }
})

test('a model is passed through only when one was asked for', () => {
  const without = buildInvocation({ peer: 'codex', cwd: '/r', schemaPath: SCHEMA, lastMessagePath: '/m' })
  assert.ok(!without.argv.includes('--model'))
  const with_ = buildInvocation({ peer: 'codex', cwd: '/r', schemaPath: SCHEMA, lastMessagePath: '/m', model: 'gpt-5.6' })
  assert.equal(with_.argv[with_.argv.indexOf('--model') + 1], 'gpt-5.6')
})

// ------------------------------------------------------------------- schemas

// A real run against Codex returned HTTP 400: "'uniqueItems' is not permitted".
// Structured-output endpoints accept a strict subset of JSON Schema, and a
// schema they reject makes every crosscheck fail with a message about
// `response_format` that says nothing about the actual review. No unit test
// could have caught it — so the keyword list it cost us lives here now.
const UNSUPPORTED = ['uniqueItems', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'contains']

function walk(node, hit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, hit))
  if (!node || typeof node !== 'object') return
  for (const key of Object.keys(node)) {
    if (UNSUPPORTED.includes(key)) hit.push(key)
    walk(node[key], hit)
  }
}

for (const name of ['schema-plan.json', 'schema-diff.json']) {
  test(`${name} uses only keywords a structured-output endpoint accepts`, () => {
    const schema = JSON.parse(readFileSync(join(root, 'skills/blueprint/scripts', name), 'utf8'))
    const hit = []
    walk(schema, hit)
    assert.deepEqual(hit, [], `${name} carries ${hit.join(', ')} — the peer will reject it with a 400`)
  })

  test(`${name} is strict enough for the endpoint to accept it`, () => {
    // The other half of the same contract: strict mode requires every object to
    // close itself and to require every property it declares. Getting this wrong
    // fails the same way — at request time, on every run.
    const schema = JSON.parse(readFileSync(join(root, 'skills/blueprint/scripts', name), 'utf8'))
    const objects = []
    ;(function collect(node) {
      if (Array.isArray(node)) return node.forEach(collect)
      if (!node || typeof node !== 'object') return
      if (node.type === 'object' && node.properties) objects.push(node)
      Object.values(node).forEach(collect)
    })(schema)
    assert.ok(objects.length >= 3, 'expected the schema to describe several objects')
    for (const o of objects) {
      assert.equal(o.additionalProperties, false, 'every object must close itself')
      assert.deepEqual(
        Object.keys(o.properties).sort(),
        [...(o.required || [])].sort(),
        'every declared property must be required',
      )
    }
  })
}

// ----------------------------------------------------------------- citations

function repoWith(content) {
  const dir = scratch()
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/app.ts'), content)
  return dir
}

test('a citation that is exactly right passes', () => {
  const dir = repoWith('const a = 1\nexport function parse(input) {\n  return input\n}\n')
  assert.deepEqual(checkCitation(dir, 'src/app.ts:2', 'export function parse(input)'), { ok: true })
})

test('a citation passes when only whitespace differs', () => {
  const dir = repoWith('const a = 1\n    export   function parse(input) {\n')
  assert.equal(checkCitation(dir, 'src/app.ts:2', 'export function parse(input)').ok, true)
})

test('a multi-line range is checked across the whole range', () => {
  const dir = repoWith('a\nfunction parse(\n  input\n) {}\n')
  assert.equal(checkCitation(dir, 'src/app.ts:2-4', 'function parse( input ) {}').ok, true)
})

test('a quote that is not at the cited line is rejected', () => {
  const dir = repoWith('const a = 1\nexport function parse(input) {\n')
  const r = checkCitation(dir, 'src/app.ts:1', 'export function parse(input)')
  assert.equal(r.ok, false)
  assert.match(r.why, /not at src\/app\.ts:1/)
})

test('a file that does not exist is rejected', () => {
  const dir = repoWith('x\n')
  assert.match(checkCitation(dir, 'src/nope.ts:1', 'x').why, /does not exist/)
})

test('a line past the end of the file is rejected', () => {
  const dir = repoWith('one\ntwo\n')
  assert.match(checkCitation(dir, 'src/app.ts:99', 'two').why, /99 was cited/)
})

test('an absolute path and a traversal are both rejected', () => {
  const dir = repoWith('x\n')
  assert.match(checkCitation(dir, '/etc/passwd:1', 'root').why, /absolute/)
  assert.match(checkCitation(dir, '../../../etc/passwd:1', 'root').why, /does not exist|outside/)
})

test('a locator that is not path:line is rejected', () => {
  const dir = repoWith('x\n')
  assert.match(checkCitation(dir, 'src/app.ts', 'x').why, /not a path:line/)
})

test('a directory citation is rejected, not thrown out of the wrapper', () => {
  // `src` exists and is inside the repo, so it clears both earlier guards. An
  // unguarded read then throws EISDIR and the whole run produces no result —
  // one bad citation costing the entire crosscheck.
  const dir = repoWith('x\n')
  const r = checkCitation(dir, 'src:1', 'anything')
  assert.equal(r.ok, false)
  assert.match(r.why, /not a file/)
})

test('verifyCitations drops the objection that cited badly and keeps the one that did not', () => {
  const dir = repoWith('const a = 1\nexport function parse(input) {\n')
  const response = {
    findings: [
      {
        id: 'O-001',
        location: { path: 'src/app.ts', line: 2, quote: 'export function parse(input)' },
        evidence: [{ locator: 'src/app.ts:1', quote: 'const a = 1', supports: 'it is there' }],
      },
      {
        id: 'O-002',
        location: { path: 'src/app.ts', line: 2, quote: 'export function render(input)' },
        evidence: [{ locator: 'src/app.ts:2', quote: 'export function render(input)', supports: 'invented' }],
      },
    ],
  }
  const { kept, rejected } = verifyCitations(dir, 'diff', response)
  assert.deepEqual(kept.map((k) => k.id), ['O-001'])
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].id, 'O-002')
})

test('an objection citing only the plan is kept — there is no file to check it against', () => {
  const dir = repoWith('x\n')
  const response = {
    objections: [{ id: 'O-001', evidence: [{ kind: 'plan', locator: 'S-003', quote: 'step three', supports: 'contradicts S-001' }] }],
  }
  const { kept, rejected } = verifyCitations(dir, 'plan', response)
  assert.equal(kept.length, 1)
  assert.equal(rejected.length, 0)
})

// -------------------------------------------------------------------- shapes

test('a peer that says ok while having read nothing is rejected', () => {
  const err = validateShape('diff', { status: 'ok', context_error: '', files_read: [], findings: [] })
  assert.match(err, /files_read is empty/)
})

test('insufficient_context with nothing read is a legitimate answer', () => {
  assert.equal(validateShape('diff', { status: 'ok', context_error: '', files_read: ['a.ts'], findings: [] }), null)
  assert.equal(validateShape('diff', { status: 'insufficient_context', context_error: 'no repo', files_read: [], findings: [] }), null)
})

test('a malformed response names what is wrong with it', () => {
  assert.match(validateShape('diff', { status: 'nope', files_read: [], findings: [] }), /status must be/)
  assert.match(validateShape('plan', { status: 'ok', files_read: ['a'], objections: 'no' }), /objections must be an array/)
  assert.match(validateShape('plan', { status: 'ok', files_read: ['a'], objections: [{ id: 'O-001' }] }), /no evidence array/)
})

test('the claude envelope is unwrapped, and a codex last-message is read as-is', () => {
  const payload = { status: 'ok', context_error: '', files_read: ['a.ts'], findings: [] }
  assert.deepEqual(parsePeerOutput({ peer: 'codex', lastMessage: JSON.stringify(payload) }).response, payload)
  assert.deepEqual(
    parsePeerOutput({ peer: 'claude', stdout: JSON.stringify({ subtype: 'success', structured_output: payload }) }).response,
    payload,
  )
  assert.deepEqual(
    parsePeerOutput({ peer: 'claude', stdout: JSON.stringify({ subtype: 'success', result: JSON.stringify(payload) }) }).response,
    payload,
  )
})

test('unparseable output is reported as unparseable, never salvaged', () => {
  assert.equal(parsePeerOutput({ peer: 'codex', lastMessage: 'Here is what I think:' }).status, 'peer_output_invalid')
  assert.equal(parsePeerOutput({ peer: 'codex', lastMessage: '' }).status, 'peer_output_invalid')
  assert.equal(parsePeerOutput({ peer: 'claude', stdout: JSON.stringify({ subtype: 'error_during_execution' }) }).status, 'peer_unavailable')
})

// ---------------------------------------------------------------- end to end

function run(dir, extra = []) {
  const out = join(dir, 'out')
  const prompt = join(dir, 'prompt.txt')
  writeFileSync(prompt, 'the brief')
  return main(['--host', 'claude', '--mode', 'diff', '--cwd', dir, '--prompt', prompt, '--schema', SCHEMA, '--out', out, ...extra])
}

const GOOD = {
  status: 'ok',
  context_error: '',
  files_read: ['src/app.ts'],
  findings: [
    {
      id: 'O-001',
      severity: 'blocking',
      location: { path: 'src/app.ts', line: 2, quote: 'export function parse(input)' },
      claim: 'parse never validates input',
      failure_scenario: 'a null input reaches the sink',
      evidence: [{ locator: 'src/app.ts:2', quote: 'export function parse(input)', supports: 'no guard' }],
      suggested_fix: 'guard at the boundary',
    },
  ],
}

test('a peer that answers well produces ok, and its finding survives', async () => {
  const dir = repoWith('const a = 1\nexport function parse(input) {\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(GOOD))})
`)
  const res = await withPath(bin, () => run(dir))
  assert.equal(res.status, 'ok')
  assert.equal(res.findings.length, 1)
  assert.deepEqual(res.rejected_citations, [])
  assert.deepEqual(res.files_read, ['src/app.ts'])
})

test('a peer that invents a line has that finding dropped before anyone reads it', async () => {
  const dir = repoWith('const a = 1\nexport function parse(input) {\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const lying = { ...GOOD, findings: [{ ...GOOD.findings[0], location: { path: 'src/app.ts', line: 2, quote: 'export function fabricated()' } }] }
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(lying))})
`)
  const res = await withPath(bin, () => run(dir))
  assert.equal(res.status, 'ok')
  assert.equal(res.findings.length, 0)
  assert.equal(res.rejected_citations[0].id, 'O-001')
})

test('an unauthenticated peer is unavailable, and says how to fix it', async () => {
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `process.exit(1)`)
  const res = await withPath(bin, () => run(dir))
  assert.equal(res.status, 'peer_unavailable')
  assert.equal(res.remedy, 'codex login')
})

test('a peer that is not installed is unavailable, not a crash', async () => {
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  // An empty bin dir plus a PATH that cannot resolve `codex` anywhere.
  const saved = process.env.PATH
  process.env.PATH = bin
  try {
    const res = await run(dir)
    assert.equal(res.status, 'peer_unavailable')
    assert.match(res.reason, /not on PATH/)
  } finally {
    process.env.PATH = saved
  }
})

test('an auth probe that hangs is bounded by the run budget, and the total stays inside it', async () => {
  // checkAuth used a fixed 20 s that `--timeout-ms` knew nothing about, so a
  // 5 s run could wait 25 s. The probe now gets a quarter of the budget, the
  // run gets the rest, and the elapsed time is what the caller asked for.
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const a = process.argv.slice(2)
if (a[0] === 'login') setTimeout(() => process.exit(0), 30000)
`)
  const started = Date.now()
  const res = await withPath(bin, () => run(dir, ['--timeout-ms', '4000']))
  const elapsed = Date.now() - started
  assert.equal(res.status, 'peer_unavailable')
  assert.match(res.reason, /did not answer within 1000ms/)
  assert.ok(elapsed < 4500, `waited ${elapsed}ms on a 4000ms budget`)
  assert.ok(res.duration_ms >= 900, 'duration_ms must include the probe')
})

test('the claude schema argument is minified, and an oversized schema is refused before the spawn', async () => {
  const { argv } = buildInvocation({ peer: 'claude', cwd: '/repo', schemaPath: SCHEMA, lastMessagePath: '/out/m.json' })
  const schema = argv[argv.indexOf('--json-schema') + 1]
  assert.ok(!schema.includes('\n'), 'the schema must be one line')
  assert.deepEqual(JSON.parse(schema), JSON.parse(readFileSync(SCHEMA, 'utf8')))

  const dir = repoWith('x\n')
  const huge = join(dir, 'huge.json')
  writeFileSync(huge, JSON.stringify({ type: 'object', description: 'x'.repeat(70 * 1024) }))
  const prompt = join(dir, 'prompt.txt')
  writeFileSync(prompt, 'the brief')
  const res = await main(['--host', 'claude', '--mode', 'diff', '--cwd', dir, '--prompt', prompt, '--schema', huge, '--out', join(dir, 'out')])
  assert.equal(res.status, 'peer_unavailable')
  assert.match(res.reason, /one argument/)
})

test('a non-zero exit is unavailable and carries the stderr tail', async () => {
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
process.stderr.write('rate limited')
process.exit(3)
`)
  const res = await withPath(bin, () => run(dir))
  assert.equal(res.status, 'peer_unavailable')
  assert.match(res.reason, /exited 3/)
  assert.match(res.reason, /rate limited/)
})

test('output that is not JSON is invalid, and no model is asked to rescue it', async () => {
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], 'I looked at the diff and it seems fine.')
`)
  const res = await withPath(bin, () => run(dir))
  assert.equal(res.status, 'peer_output_invalid')
})

test('a peer that says it could not read the repository is unavailable, not a clean run', async () => {
  // It answered honestly and its answer is worth nothing. Reporting it as ok
  // with an empty findings list is how "nobody looked" comes to read exactly
  // like "looked and found nothing".
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const blind = { status: 'insufficient_context', context_error: 'sandbox denied reads', files_read: [], findings: [] }
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(blind))})
`)
  const res = await withPath(bin, () => run(dir))
  assert.equal(res.status, 'peer_unavailable')
  assert.match(res.reason, /sandbox denied reads/)
})

test('relative --schema and --out are resolved against our cwd, not the peer\'s', async () => {
  // The child runs with its working directory set to the repo. A relative path
  // therefore means two different places, and the peer writes its answer where
  // this process never looks — a successful consultation reported as a failure.
  const dir = repoWith('const a = 1\nexport function parse(input) {\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
const schema = a[a.indexOf('--output-schema') + 1]
const out = a[a.indexOf('--output-last-message') + 1]
if (!require('path').isAbsolute(schema) || !require('path').isAbsolute(out)) {
  process.stderr.write('relative path leaked to the peer: ' + schema + ' ' + out)
  process.exit(9)
}
if (!fs.existsSync(schema)) { process.stderr.write('schema not found from the peer cwd'); process.exit(8) }
fs.writeFileSync(out, ${JSON.stringify(JSON.stringify(GOOD))})
`)
  const cwd = process.cwd()
  process.chdir(root)
  try {
    const prompt = join(dir, 'prompt.txt')
    writeFileSync(prompt, 'the brief')
    const res = await withPath(bin, () =>
      main([
        '--host', 'claude', '--mode', 'diff', '--cwd', dir, '--prompt', prompt,
        // Both deliberately relative to OUR cwd, which is not the repo under review.
        '--schema', 'skills/blueprint/scripts/schema-diff.json',
        '--out', 'tests/.tmp-peer-out',
      ]),
    )
    assert.equal(res.status, 'ok', `wrapper failed: ${res.reason || ''}`)
    assert.equal(res.findings.length, 1)
  } finally {
    process.chdir(cwd)
    rmSync(join(root, 'tests/.tmp-peer-out'), { recursive: true, force: true })
  }
})

test('a peer that hangs is killed, and its partial output is discarded', async () => {
  const dir = repoWith('x\n')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  fakeCli(bin, 'codex', `
const fs = require('fs')
const a = process.argv.slice(2)
if (a[0] === 'login') process.exit(0)
fs.writeFileSync(a[a.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(GOOD))})
setTimeout(() => {}, 60000)
`)
  const res = await withPath(bin, () => run(dir, ['--timeout-ms', '1500']))
  assert.equal(res.status, 'peer_unavailable')
  assert.match(res.reason, /exceeded 1500ms/)
  assert.ok(!res.findings, 'a timed-out run must not carry findings')
})

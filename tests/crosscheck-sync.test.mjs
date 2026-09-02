// Shared engines ship inside every skill that needs them, so that any one
// skill survives `npx skills add --skill <name>` on its own. Duplication under
// a test is a packaging decision; duplication that drifts is two
// implementations wearing one name, and the drift is invisible until the two
// skills disagree about what the peer was told or what a cheat looks like.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Each group: the file, and every skill that carries a copy. Edit one copy and
// `cp` it to the others.
const SHARED = [
  { rel: 'references/crosscheck.md', skills: ['blueprint', 'verify'] },
  { rel: 'scripts/schema-plan.json', skills: ['blueprint', 'verify'] },
  { rel: 'scripts/schema-diff.json', skills: ['blueprint', 'verify'] },
  { rel: 'scripts/peer-run.mjs', skills: ['blueprint', 'verify', 'build'] },
  { rel: 'scripts/forbidden-repairs.mjs', skills: ['verify', 'build'] },
]

for (const { rel, skills } of SHARED) {
  test(`${rel} is identical across ${skills.join(', ')}`, () => {
    const first = readFileSync(join(root, 'skills', skills[0], rel))
    assert.ok(first.length > 0, `${rel} is empty`)
    for (const other of skills.slice(1)) {
      const copy = readFileSync(join(root, 'skills', other, rel))
      assert.deepEqual(
        copy,
        first,
        `skills/${skills[0]}/${rel} and skills/${other}/${rel} have drifted. Edit one, copy it to the others.`,
      )
    }
  })
}

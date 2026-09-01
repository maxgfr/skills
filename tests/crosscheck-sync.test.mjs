// The crosscheck mechanism ships inside both skills so that either one survives
// `npx skills add --skill <name>` on its own. Duplication under a test is a
// packaging decision; duplication that drifts is two implementations wearing one
// name, and the drift is invisible until the two skills disagree about what the
// peer was told.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SHARED = [
  'references/crosscheck.md',
  'scripts/peer-run.mjs',
  'scripts/schema-plan.json',
  'scripts/schema-diff.json',
]

for (const rel of SHARED) {
  test(`${rel} is identical in blueprint and verify`, () => {
    const a = readFileSync(join(root, 'skills/blueprint', rel))
    const b = readFileSync(join(root, 'skills/verify', rel))
    assert.ok(a.length > 0, `${rel} is empty`)
    assert.deepEqual(
      a,
      b,
      `skills/blueprint/${rel} and skills/verify/${rel} have drifted. Edit one, copy it to the other.`,
    )
  })
}

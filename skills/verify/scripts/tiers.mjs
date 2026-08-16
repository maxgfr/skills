#!/usr/bin/env node
// tiers.mjs — the cost tiers, as data rather than a table in a document.
//
// A run's cost is agents, and most agents are skeptics: one per candidate
// finding, a panel per blocking one. More finder lenses produce more
// candidates, which produce more skeptics, so the two multiply. The tier is the
// dial.
//
// This is a script and not prose because two of the workflow's guards punish a
// preset that is merely *nearly* right, and neither failure is visible in a
// review of the resolved config:
//
//   1. `finders: []` does NOT mean zero lenses. verify.mjs falls back to all
//      six when the array is empty. Only `lanes.defects: false` turns lane C
//      off, so every tier here carries a non-empty `finders` array even when
//      the lane is off.
//   2. Lane gating is opt-out (`lanes.gates !== false`), and a MISSING
//      `behavior` key resolves to "quick", not "off". A partial `lanes` object
//      therefore leaves lanes running that the tier meant to disable, so every
//      tier spells out all four keys.
//
// Usage:
//   node tiers.mjs                 # every tier, as JSON
//   node tiers.mjs <name>          # one resolved tier, as JSON
//   node tiers.mjs <name> --pretty

// The default has to do the job. It is the one people actually invoke, and a
// default that only runs the gates answers "do the commands pass", not "is this
// change any good" — which is the question `/verify` is asked. `ultralight`
// stays available for when the gates really are all you want.
export const DEFAULT_TIER = 'light'

export const LENS_NAMES = [
  'correctness',
  'failure-handling',
  'state-async',
  'trust-input',
  'wiring',
  'leftovers',
]

export const TIERS = {
  // Gates only: run the repo's real commands, report the exit codes, stop.
  // It produces no model-authored finding, so there is nothing to refute and
  // law 2 holds by construction. It is not a defect hunt and not a merge gate —
  // opt in when the gates really are the question, not as a default.
  ultralight: {
    lanes: { gates: true, spec: false, defects: false, behavior: 'off' },
    finders: ['correctness'], // never used — lane C is off — but see note 1 above
    judges: { panel: 1, panel_blocking: 1 },
    effort: { gates: 'low', planner: 'low', finders: 'medium', judges: 'medium' },
  },
  // The default. Actually verifies the change: reads the diff for defects,
  // checks it against the promise, and refutes every candidate before reporting
  // it. What it gives up against `normal` is the behaviour proof — the lane that
  // starts servers and runs CLIs, and by far the slowest — and the three-skeptic
  // panel on blocking claims.
  //
  // The spec lane carries its own data guard: with no promise to check against,
  // the matrix produces no requirements and the lane costs nothing.
  light: {
    lanes: { gates: true, spec: true, defects: true, behavior: 'off' },
    finders: ['correctness', 'failure-handling', 'wiring'],
    judges: { panel: 1, panel_blocking: 1 },
    effort: { gates: 'low', planner: 'low', finders: 'medium', judges: 'medium' },
  },
  normal: {
    lanes: { gates: true, spec: true, defects: true, behavior: 'quick' },
    finders: ['correctness', 'failure-handling', 'wiring', 'leftovers'],
    judges: { panel: 1, panel_blocking: 3 },
    effort: { gates: 'low', planner: 'low', finders: 'high', judges: 'high' },
  },
  deep: {
    lanes: { gates: true, spec: true, defects: true, behavior: 'full' },
    finders: [...LENS_NAMES],
    judges: { panel: 1, panel_blocking: 3 },
    effort: { gates: 'low', planner: 'low', finders: 'high', judges: 'high' },
  },
}

export const TIER_NAMES = Object.keys(TIERS)

// A fresh object every time: the caller merges config files and flags on top,
// and a shared reference would let one run's overrides leak into the next.
export function resolveTier(name = DEFAULT_TIER) {
  const tier = TIERS[name]
  if (!tier) {
    throw new Error(`unknown tier ${JSON.stringify(name)} — expected one of ${TIER_NAMES.join(', ')}`)
  }
  return {
    tier: name,
    lanes: { ...tier.lanes },
    finders: [...tier.finders],
    judges: { ...tier.judges },
    effort: { ...tier.effort },
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2)
  const pretty = args.includes('--pretty')
  const name = args.find((a) => !a.startsWith('--'))
  try {
    const out = name ? resolveTier(name) : Object.fromEntries(TIER_NAMES.map((n) => [n, resolveTier(n)]))
    process.stdout.write(JSON.stringify(out, null, pretty ? 2 : 0) + '\n')
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}

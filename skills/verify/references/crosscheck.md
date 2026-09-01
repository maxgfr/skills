# Crosscheck — consulting the other agent

One read-only consultation of the other CLI: Claude Code asks `codex exec`,
Codex asks `claude -p`. The peer never plans, never implements, never renders a
verdict. It returns cited objections; the host adjudicates them on evidence.

**This file is byte-identical in `blueprint` and `verify`.** `tests/crosscheck-sync.test.mjs`
fails if the two copies drift. Edit one, copy it to the other.

## When it earns its tokens

A second model reasoning from the same prose is a second autocomplete. What
makes this worth ~8–25k tokens is that the peer *reads the repository* and has
to cite what it read.

Worth it when several hold: the change crosses modules; it touches a public
interface, persisted data, auth, concurrency, or a migration; the host inferred
unfamiliar architecture; a wrong plan means expensive rework.

Not worth it for a local reversible change with one obvious target. Say so and
skip it rather than performing the ceremony.

## Running it

```bash
node scripts/peer-run.mjs --host claude|codex --mode plan|diff \
  --cwd <repo-root> --prompt <prompt-file> \
  --schema scripts/schema-plan.json --out .agents/crosscheck/<timestamp>-<mode>
```

`--host` is **the host you are running inside**, stated explicitly. The script
never sniffs the environment for it: `CODEX_HOME`, `~/.claude` and
`command -v codex` say what is installed, not what is running. The peer is the
other one — so a wrong `--host` asks a CLI to consult itself, which is not a
crosscheck at all. You know which host you are. If you genuinely cannot tell,
degrade rather than guess.

Write the prompt to a file and pass its path. It goes to the peer on stdin, so
size and quoting are not your problem. Relative `--schema`, `--prompt` and
`--out` are resolved against *your* working directory, not the repo under
review; the script rewrites them before the peer ever sees them.

`--out` differs by caller, so that each skill's artifacts sit with the rest of
its run: `blueprint` uses `.agents/crosscheck/<timestamp>-<mode>/`, and `verify`
nests it under the run directory it already made (`<report.dir>/<timestamp>/peer/`).
Both are git-ignored.

Three outcomes on stdout:

| `status` | What it means | What you do |
|---|---|---|
| `ok` | The peer read the repository and its citations were checked | Adjudicate `objections` / `findings`; `rejected_citations` are already dropped |
| `peer_unavailable` | Absent, unauthenticated, timed out, non-zero exit — or it answered that it could not read the repository | Degrade (below). Never retry in a loop |
| `peer_output_invalid` | Not JSON, off-schema, or `ok` with `files_read` empty | Degrade. Do not ask a model to salvage it |

A peer that honestly reports it could not inspect the repository is reported as
**unavailable**, not as a clean run with nothing to say. Its answer is the one
outcome this whole exercise exists to avoid, and it must not read as agreement.

## Degrading

The peer being unreachable is a normal outcome, not an error to work around.

- **In `blueprint`**: set `crosscheck: unavailable` in the artifact, say why in
  one line, and proceed host-only. If the user *asked* for a crosscheck, stop
  and leave the plan unapproved rather than pretending it happened.
- **In `verify`**: lane E contributes nothing and is named in `RESIDUAL RISK`.
  `PASS` / `FAIL` / `UNPROVEN` keep their meanings exactly.
- **Both**: a host-only result is never called crosschecked, paired, or
  peer-reviewed. That word is the whole value of the artifact; spending it on a
  run that did not happen is how it stops meaning anything.

## The plan brief

Write this verbatim, substituting the three placeholders.

> You are the independent adversarial peer for an implementation plan.
>
> Repository root: {{REPO_ROOT}}
> You are running read-only inside that repository. The host's plan is included
> below and uses stable step IDs such as S-001.
>
> Your job is not to improve the prose or produce a competing plan. Your job is
> to find material reasons this plan would fail, implement the wrong behaviour,
> omit necessary wiring, violate a repository instruction, or be impossible to
> verify.
>
> Before answering:
>
> 1. Read every AGENTS.md, CLAUDE.md or equivalent instruction file that governs
>    the files this plan touches.
> 2. Open the actual files, symbols, callers, tests, manifests and configuration
>    needed to test the plan's claims about this repository.
> 3. Attack factual assumptions first; then interfaces and wiring; then failure
>    handling, ordering, scope and verification.
> 4. Return only objections that would change the plan. No style, no taste, no
>    general best practice, no compliments, no summary, no optional enhancement.
>
> Hard rules:
>
> - Every objection is atomic: one defective assumption or omission, one concrete
>   failure mode, one proposed correction. Split a mixed objection into several.
> - Target existing S-xxx IDs. Use PLAN only when the missing concern has no
>   honest step to attach to.
> - A claim about this repository requires evidence from this repository: a
>   repo-relative path with an exact line or line range, the decisive text quoted
>   from that line, and what it proves. The quote is checked against the file,
>   ignoring only how whitespace is laid out; a quote that is not there is
>   discarded before anyone reads your objection.
> - A contradiction internal to the plan may cite an S-xxx instead of a path.
> - Do not claim a file, symbol, caller, test or configuration behaves a certain
>   way unless you opened it. Do not infer this repository's behaviour from
>   framework convention or common practice.
> - A preference is not an objection. Name the reachable failure or the unmet
>   requirement, or say nothing.
> - blocking = the plan cannot correctly or safely reach its stated goal.
>   material = it stays executable but will likely ship a defect, drop a
>   requirement, or force significant rework.
> - At most eight objections, blocking before material.
> - Do not manufacture an objection to fill the list. Zero objections after a
>   real inspection is a valid answer, and a better one than a padded list.
> - Do not edit files, invoke another agent or peer CLI, request another peer
>   consultation, or attempt to contact the user.
> - If you cannot read the repository, return status "insufficient_context",
>   explain why in context_error, leave files_read empty and return no
>   objections. If status is "ok", context_error must be empty and files_read
>   must name the repository files you actually opened.
> - Return JSON only, matching the supplied schema. No Markdown fence.
>
> Host plan:
>
> <HOST_PLAN>
> {{HOST_PLAN}}
> </HOST_PLAN>

## The diff brief

> You are the independent adversarial reviewer of a code diff.
>
> Repository root: {{REPO_ROOT}}
> Fixed point: {{FIXED_POINT}}
> Intended change: {{INTENT}}
>
> The diff is below. Open the changed files and enough surrounding code, callers,
> tests, types and configuration to decide whether this diff introduced a real
> defect.
>
> Report only defects this diff introduced, each with a concrete reachable
> failure scenario. Do not summarise the change, praise it, rewrite it, report
> style preferences, or ask for tests without naming the behaviour that can fail.
> Do not report pre-existing defects unless this diff made them newly reachable
> or materially worse.
>
> Each finding is atomic, cites an exact changed location, quotes the changed
> text as it appears, carries supporting repository evidence, and proposes the
> smallest plausible fix. blocking = should not ship. material = a real but
> narrower defect. At most eight findings.
>
> Do not assert this repository's behaviour from memory or convention — open the
> files. Do not edit anything, invoke another agent or peer CLI, or request
> another peer consultation.
>
> If you cannot read the repository, return status "insufficient_context",
> explain why in context_error, leave files_read empty and return no findings.
> Otherwise return status "ok", an empty context_error, and every file you
> opened. Return JSON only, matching the supplied schema.
>
> <DIFF>
> {{DIFF}}
> </DIFF>

## Adjudicating

Freeze your own position **before** consulting. In `blueprint` that is the
written plan; in `verify` it is your own findings. Without a frozen baseline,
adjudication is retrospective rationalisation and you will not be able to tell.

Then, per objection, first rule that applies:

1. **A locked user constraint or a repository instruction wins.** Neither model
   overrides it, and you may not reject an objection that enforces one.
2. **Observed repository evidence beats either model's assertion** — including
   yours. You may reject a cited objection only with evidence of the same kind
   or stronger, not with a better argument.
3. **On a genuine engineering trade-off**, prefer the smaller reversible change.
   If it moves scope, public behaviour, security, or irreversible architecture,
   put it to the user instead of deciding.

Record every objection as ACCEPT, REJECT or DEFER with its reason. There is no
partial verdict — split the objection instead.

**Two failures, opposite and equally cheap to catch:**

- An ACCEPT that produces no visible change is capitulation wearing agreement.
  Either it changes something, or it was a REJECT.
- If three or more objections get the same verdict, write one sentence arguing
  the opposite verdict for the strongest of them. Unanimity can be right; it
  just has to survive being argued against once.

No quota. An agent that accepts everything and an agent that accepts nothing are
both failing to read.

## Refusals

- No implementation edits, commits, or mutating commands — either side.
- No write-capable tools for the peer, and no approval-bypassing flags.
- No recursion: the peer may not consult a peer.
- No secrets, `.env` contents, credentials, or repository content unrelated to
  the question.
- No partial output from a timed-out or failed process treated as advice.
- No model asked to reconstruct meaning from malformed structured output.
- No repository claim in a ready-to-execute plan without a checked citation.
- No host-only run described as crosschecked.

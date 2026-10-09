# Tiers

Read `~/.agents/models.json`, then `<repo>/.agents/models.json`, which wins key by key. Under your host's name (`claude`, `codex`, `opencode`…), `small`, `medium` and `large` are `{ "model", "effort" }` or a bare model name, and `review` is the reviewers' tier (default `medium`). A missing tier, a bare name's effort, or a tool that takes no model means your own model and effort.

Give each step the tier its work needs; when two lines fit, take the larger:

- `large` for a step that builds or restyles a UI: components, pages, styles, layout, text on screen.
- At least `medium` for a step that touches security: authentication, authorization, sessions, uploads and file paths, parsing user input, SQL and migrations, secrets, crypto, outbound requests. Mark it `security`; its reviewer is `large`.
- `medium` for a step whose logic spans calls or state: a form saved twice, a cache, a retry.
- `small` for the rest.

A failed try moves the step one tier up, from `small` to `medium` to `large`, three tries at most. A `small` or `medium` implementer that judges the step beyond it hands it straight to `large`, without spending a try. A repair runs at `medium` in its first round and at `large` after.

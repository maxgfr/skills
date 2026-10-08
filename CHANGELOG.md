## [6.0.1](https://github.com/maxgfr/skills/compare/v6.0.0...v6.0.1) (2026-10-08)


### Bug Fixes

* **build:** say each tier carries its own effort, and that build leaves the worktree uncommitted ([c6e14bf](https://github.com/maxgfr/skills/commit/c6e14bff11de01b2c85e722f71123ab223de2b4f))

# [6.0.0](https://github.com/maxgfr/skills/compare/v5.0.0...v6.0.0) (2026-10-08)


* feat!: the session chooses solo or delegate and each step's tier ([7ec5605](https://github.com/maxgfr/skills/commit/7ec560521bb2ba75223ec76da2ba8c97805730bd))


### BREAKING CHANGES

* the solo and attempts keys of models.json are gone;
only small, medium, large, review and audit are read.

# [5.0.0](https://github.com/maxgfr/skills/compare/v4.1.1...v5.0.0) (2026-10-08)


* feat!: skills are plain Markdown, no scripts ([e5bfe8a](https://github.com/maxgfr/skills/commit/e5bfe8a5a0eac8db65d9a4f2a5c59d34a1cfd14b))


### BREAKING CHANGES

* the skill scripts and the build Workflow are removed; the
skills no longer need Node.

## [4.1.1](https://github.com/maxgfr/skills/compare/v4.1.0...v4.1.1) (2026-10-08)


### Bug Fixes

* **verify:** detect-gates no longer turns CI noise into gates ([ccbc933](https://github.com/maxgfr/skills/commit/ccbc93387d96fc282bb3edec09ce31787056490c))
* **verify:** name tracked files a gate rewrote, and print the gate notes ([78a664d](https://github.com/maxgfr/skills/commit/78a664d78c47e39e6d1dd78926924160cb391777))

# [4.1.0](https://github.com/maxgfr/skills/compare/v4.0.0...v4.1.0) (2026-10-08)


### Features

* short plans built by the session, automatic from plan mode ([0707a71](https://github.com/maxgfr/skills/commit/0707a7143272fa4eb1629cdca217bddb1b459c4c))

# [4.0.0](https://github.com/maxgfr/skills/compare/v3.2.0...v4.0.0) (2026-10-08)


* feat!: lean skills, one approval, build chains into verify ([1bab66b](https://github.com/maxgfr/skills/commit/1bab66b5dae5ff0fb6f7e3a680f958bda8f1cc1a))


### BREAKING CHANGES

* the `auto` and `then verify` arguments are gone (the chain
is automatic), and the build workflow no longer returns `next`.

# [3.2.0](https://github.com/maxgfr/skills/compare/v3.1.0...v3.2.0) (2026-10-08)


### Features

* automatic skills, one-call reviews, verify in the build worktree ([0e19c78](https://github.com/maxgfr/skills/commit/0e19c78c089987c08045dd3d4781ef5088a6bbe9))

# [3.1.0](https://github.com/maxgfr/skills/compare/v3.0.0...v3.1.0) (2026-10-08)


### Features

* **build:** one reviewer per wave, worktree from local HEAD, plan Verify commands checked ([e7ee07e](https://github.com/maxgfr/skills/commit/e7ee07ee38fc1714a4e79871afe35377557ec722))
* configure each tier's model and effort, and which tier does which job ([d0c4451](https://github.com/maxgfr/skills/commit/d0c44516ced87b9bf8736ecae06dda9a4ebed081))

# [3.0.0](https://github.com/maxgfr/skills/compare/v2.1.0...v3.0.0) (2026-10-08)


* feat!: minimal skills on abstract model tiers ([d72e240](https://github.com/maxgfr/skills/commit/d72e2407e1b10c363a3ef058d89e7060448faf00))


### Bug Fixes

* **build:** keep a forbidden-repair stop to one short line ([05b2657](https://github.com/maxgfr/skills/commit/05b265774385eed43bf0b698fc0935c05ee5d8b6))
* **verify:** show the line that explains a failed gate ([d751eae](https://github.com/maxgfr/skills/commit/d751eae8ee668a777734322472d75aa85ffd130e))


### Features

* **verify:** gates only by default, skip gates an aggregate already runs ([19cfdab](https://github.com/maxgfr/skills/commit/19cfdabe840cdca7f281771299bdee89f08557d6))


### BREAKING CHANGES

* `build peer`, `blueprint crosscheck`, `blueprint grill`,
`verify light|normal|deep|report|crosscheck` and the verify/build config
files are gone. Map tiers to models in .agents/models.json instead.

# [2.1.0](https://github.com/maxgfr/skills/compare/v2.0.2...v2.1.0) (2026-10-08)


### Features

* **skills:** let the agent invoke blueprint, build and verify on request ([08e063f](https://github.com/maxgfr/skills/commit/08e063fc16e0dcb62617625e7d6228ac33636c0a))

## [2.0.2](https://github.com/maxgfr/skills/compare/v2.0.1...v2.0.2) (2026-09-09)


### Bug Fixes

* **skills:** preserve manual invocation across agent hosts ([05cab73](https://github.com/maxgfr/skills/commit/05cab737e8a294fe9e9d82d1f2f36bb243de0ce5))

## [2.0.1](https://github.com/maxgfr/skills/compare/v2.0.0...v2.0.1) (2026-09-09)


### Bug Fixes

* require reproducible regression checks in compact plans ([434e03f](https://github.com/maxgfr/skills/commit/434e03f6fde6b4cdd56bc143d627d58d627e4bf4))
* verify installed plugin version and label structural host tests ([c8fd2d6](https://github.com/maxgfr/skills/commit/c8fd2d6014faa2b1e9f27b3fc065a1fd13ca9d22))

# [2.0.0](https://github.com/maxgfr/skills/compare/v1.4.0...v2.0.0) (2026-09-07)


* feat!: make the default skill flow explicit and lightweight ([1261c2f](https://github.com/maxgfr/skills/commit/1261c2f0ef5abeff2e074b7f98351dbd68ccb7a2))


### BREAKING CHANGES

* blueprint, build, and verify now require explicit invocation, and verify defaults to a one-shot gates-only run.

# [1.4.0](https://github.com/maxgfr/skills/compare/v1.3.3...v1.4.0) (2026-09-03)


### Features

* add native Codex plugin support ([78aac27](https://github.com/maxgfr/skills/commit/78aac27133c1e99525465b2bf7652f5b89bec111))

## [1.3.3](https://github.com/maxgfr/skills/compare/v1.3.2...v1.3.3) (2026-09-02)


### Bug Fixes

* **verify:** judge a package.json on its scripts, not on which line changed ([4295830](https://github.com/maxgfr/skills/commit/42958304362ac9a6e088866af45e5bbec5f79e73))

## [1.3.2](https://github.com/maxgfr/skills/compare/v1.3.1...v1.3.2) (2026-09-02)


### Bug Fixes

* **build:** stop retrying a peer step with a prompt that cannot carry the feedback ([8260328](https://github.com/maxgfr/skills/commit/8260328e9561e5904a25bdb855f9c12e46710141))

## [1.3.1](https://github.com/maxgfr/skills/compare/v1.3.0...v1.3.1) (2026-09-02)


### Bug Fixes

* **build:** tell an agent that never ran from a step that failed review ([1e78203](https://github.com/maxgfr/skills/commit/1e78203a75fb951aa759bc1bbe7887bcd1af39e2))
* **verify:** refuse a package.json whose scripts block was deleted wholesale ([0de7c1a](https://github.com/maxgfr/skills/commit/0de7c1adb507393e2b594accbc4757aa407bc0ab))

# [1.3.0](https://github.com/maxgfr/skills/compare/v1.2.0...v1.3.0) (2026-09-02)


### Bug Fixes

* bound the peer auth check by the run budget and minify the schema argument ([30aae79](https://github.com/maxgfr/skills/commit/30aae7916c3c7ce14129a89f5eff60a13a018f84))
* **verify:** build the untracked patch in-process, blank each line once ([8606f73](https://github.com/maxgfr/skills/commit/8606f73777cd23178577ddf7300842995fd40560))
* **verify:** cap what the report agent is handed ([77e44dd](https://github.com/maxgfr/skills/commit/77e44dddc3ae3af9fa33866f50273d961e22bb9a))
* **verify:** read each manifest once in detect-gates, and stop denying concurrently ([3053e83](https://github.com/maxgfr/skills/commit/3053e838a3f8a285dc5e37dc977660fc54f65817))
* **verify:** scope the package.json gate rule to scripts, catch renamed CI files, resolve the plan path ([8d7f1bd](https://github.com/maxgfr/skills/commit/8d7f1bd4ed26051e14e7f849d7fe1c7938acb7e6))


### Features

* add build — execute an approved plan step by step, guarded, then hand off to verify ([dcfef56](https://github.com/maxgfr/skills/commit/dcfef5649f1580b43d1ec36df053fae4062deb19))
* add using-maxgfr and the session-start and stop hooks ([4edf0cf](https://github.com/maxgfr/skills/commit/4edf0cf4c76e466245c007bb20d8af83c4845017))
* **blueprint:** auto mode chains build and verify after approval ([3ae97af](https://github.com/maxgfr/skills/commit/3ae97afe8fe462b0d5bb265b25a790a830bf113c))
* enforce the SKILL.md line budget, validate hooks, trim verify's router ([3951423](https://github.com/maxgfr/skills/commit/39514236469eb1bce69e77c64a7e86037ac77e3d))

# [1.2.0](https://github.com/maxgfr/skills/compare/v1.1.2...v1.2.0) (2026-09-01)


### Bug Fixes

* close the seams between blueprint, verify and the peer crosscheck ([eb3e276](https://github.com/maxgfr/skills/commit/eb3e276fdf52093b4b59e4bae4209eca6dda2d2f))


### Features

* add blueprint, and an opt-in peer crosscheck for both skills ([c022f7e](https://github.com/maxgfr/skills/commit/c022f7e77a8a4e0a761c992ba2bddac5e2dde6f9))

## [1.1.2](https://github.com/maxgfr/skills/compare/v1.1.1...v1.1.2) (2026-08-25)


### Bug Fixes

* make verify compatible with Codex ([aa8d8e1](https://github.com/maxgfr/skills/commit/aa8d8e1725609d3c278d2e468c8e74c1e68bf9b9))

## [1.1.1](https://github.com/maxgfr/skills/compare/v1.1.0...v1.1.1) (2026-08-16)


### Bug Fixes

* **verify:** make the default tier do the job, not just run the gates ([8a94e71](https://github.com/maxgfr/skills/commit/8a94e711cf36b2974acaabf50bea30c5da61e219))

# [1.1.0](https://github.com/maxgfr/skills/compare/v1.0.0...v1.1.0) (2026-08-16)


### Features

* **verify:** make the gates-only tier the default, and stop pinning models ([eb26307](https://github.com/maxgfr/skills/commit/eb263075b677f735fddd1e66f08f1f230737ba8a))

# 1.0.0 (2026-08-16)


### Bug Fixes

* stop reading a nested path as a skill-relative reference ([53f511f](https://github.com/maxgfr/skills/commit/53f511f7b7e4282552d6e6611c176e7006c4b8bf))
* take the listing cap from the docs, and stop rejecting valid triggers ([bc6a616](https://github.com/maxgfr/skills/commit/bc6a616d0954f9e5412e7b1af6aa862cc2753426))
* **verify:** scope each guard rule to where a cheat can actually live ([bd5118a](https://github.com/maxgfr/skills/commit/bd5118abf57a8948934a7b1e6320675c1cb976a5))


### Features

* namespace the plugin as maxgfr, so the skill is /maxgfr:verify ([2e2ba03](https://github.com/maxgfr/skills/commit/2e2ba036f340dc95de24db237b414707a7aff987))
* release with semantic-release instead of changesets ([10e8802](https://github.com/maxgfr/skills/commit/10e8802b8f6ef25a33658628400864915255e7ed))
* the verify skill ([fc6ab09](https://github.com/maxgfr/skills/commit/fc6ab097e2b0e4863e652f8dade3f3c7e5f13b14))
* **verify:** add cost tiers so a quick pass is not a full audit ([09e3371](https://github.com/maxgfr/skills/commit/09e337172bc84694f2c795cd5b9629c840c581d5))
* **verify:** detect the repo's own aggregate check gate ([f902fe9](https://github.com/maxgfr/skills/commit/f902fe99cd38f6fd71cb5ae014a0a0e864c1fb55))

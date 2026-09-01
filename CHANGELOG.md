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

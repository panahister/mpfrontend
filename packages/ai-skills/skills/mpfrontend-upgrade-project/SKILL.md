---
name: mpfrontend-upgrade-project
description: Upgrade an existing MP Frontend consumer as one reviewed package/CLI/skills cohort with dry-run, regeneration and rollback evidence. Use for an authorized bounded upgrade, never for automatic major migrations.
---

# Upgrade a consumer cohort

Read repository instructions and inventory exact installed package, lockfile, CLI, skills-lock and
accepted design-candidate versions. Review the target changelog/compatibility notes and define one
bounded compatible cohort. Do not mix independently convenient package versions or rebuild a published
version with different contents.

Before mutation, record the current working-tree diff and runnable gates. Use `mpfrontend skills update
--dry-run --json`, FTG/design dry-runs and package-manager resolution output to expose planned changes.
An authored skill, generated-output or design collision is a stop condition; never force it away. Git
history is useful rollback evidence but this skill does not authorize commits, resets or checkout.

Update manifests and lockfile together. Regenerate only outputs whose approved source/configuration or
generator version requires it, then prove authored overrides remain intact. Run offline/frozen install
when the distribution supports it, affected Nx `lint`, `typecheck`, `test`, `build`,
`generated-check`/`design-verify`, skills check and a clean packed-consumer check appropriate to the
change. Compare artifact identities and browser-critical behavior before and after.

If a gate fails, preserve diagnostics and restore only files owned by this upgrade when the user's
authorized rollback is unambiguous; never overwrite unrelated local work. Report old/new cohort,
changed files, exact evidence and known migration gaps.

No major upgrade, auth replacement, accepted design-baseline change, Git publication, package
publication or deployment is implied. Those require explicit decisions and authority.

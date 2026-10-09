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

The quality profile is part of the cohort: `@mpfrontend/workspace-config` moves with the other
packages, and its rules change only by upgrading it. A workspace created before the profile adopts it as
a bounded upgrade: create a scratch workspace and app with the upgraded CLI outside the repository, copy
the root `eslint.config.mjs`, `prettier.config.mjs`, `.prettierignore`, `check` script,
`tools/ci/check.sh` and the pinned devDependencies, then give each project the `format`, `format:check`,
`lint` and `test` targets and an `eslint.config.mjs` that spreads the root profile. Run `pnpm format` as
its own formatting-only change, then fix every lint finding; do not widen allowed paths or switch a rule
off to pass.

A consumer of the previous cohort that used its built-in `ar` locale keeps it by adding it in its own
repository, since MP Frontend now ships English only: register `ar: { direction: 'rtl' }` in the app's
locale registry; keep or add `messages/ar.ts` in every catalog set, listed in each set's `translations`,
with text for every key the set uses (the core messages no longer hold it), and run `catalog-check`; in
the Security BFF set `apiLocales: { supported: ['en', 'ar'], defaultLocale: 'en' }` and add `ar` to
`supportedUiLocales` and `preferenceCookie.locales`. A BFF without `apiLocales` now sends the default
locale upstream. Pass the app's registry to `formatNumber` and `formatValue`. Follow the upgrade note of
the nx-plugin README; never put the product's text into MP Frontend.

If a gate fails, preserve diagnostics and restore only files owned by this upgrade when the user's
authorized rollback is unambiguous; never overwrite unrelated local work. Report old/new cohort,
changed files, exact evidence and known migration gaps.

No major upgrade, auth replacement, accepted design-baseline change, Git publication, package
publication or deployment is implied. Those require explicit decisions and authority.

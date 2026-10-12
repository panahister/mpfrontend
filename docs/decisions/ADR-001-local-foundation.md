# ADR-001: Nx, pnpm, independent consumers, and one cohort from a registry

Date: 2026-10-06, revised for 1.0 on 2026-10-12
Status: Proposed for 1.0. The owner accepts it at the audit of 1.0, and it then reads "Accepted for 1.0". The
acceptance of 2026-10-06 (for the proof of concept) covered the decisions below that are unchanged.

## Context

The foundation needs one deterministic task graph, exact package-manager behavior, independently
deployable Next.js applications, contract generation from reviewed OpenAPI inputs, themes in light, dark and
system modes for left-to-right and right-to-left languages, secure server-side sessions, and realtime recovery.
Reference products must prove the package boundary rather than importing source through workspace aliases. The
packages are consumed by products that are not in this repository, so what they may rely on from one version to the
next has to be stated and checked.

## Decision

- Use pnpm workspaces for dependency management and Nx for the task graph, generators, affected builds,
  and cache boundaries.
- Pin Node.js, pnpm, Nx, TypeScript, framework, and tooling versions in the repository.
- Keep reusable packages in `mpfrontend` and every product in an independent consumer repository.
- Release the sixteen packages as one cohort under one version, from the main branch, by the release workflow,
  to the public npm registry under `@mpfrontend`, with npm provenance and, once configured, trusted publishing and
  no stored token. A published version is never published again with other bytes and never unpublished
  (amended: this replaces the transfer of prerelease packages as hash-checked archives "until an approved registry
  exists"; the archives of a release, with their SHA-256, stay available for a consumer without registry access).
- State the compatibility policy in README "Versioning" and enforce it on every build: the public API is the exports
  of each package's entry points, an entry point named `internal` is outside the guarantee, and every build compares
  the API with the last published version, whose archives are named with the integrity of their bytes (added).
- Use OpenAPI as the reviewed HTTP contract input and finite FTG profiles for generated presentation
  models and transport adapters.
- Keep customer and operations applications independently buildable and deployable.
- Ship English as the only built-in language and support LTR/RTL at the foundation level without
  embedding a product theme; every other language belongs to the product that uses it (amended
  2026-10-08).
- Keep product-owned design input optional through the `none` and `existing` source modes.

## Consequences

An independent consumer catches missing exports, task-order defects, source aliases, undeclared build
outputs, and package-cohort drift that an in-workspace example can conceal. It is a fresh workspace built from the
packed archives of the cohort, and a release does not publish until it passes.

One version for sixteen packages means a change to one package moves every package. That is the cost of a pin that
cannot drift: the application template, the Nx plugin's workspace cohort and the AI procedures write the exact
version, and a test refuses a pin that differs. The API check against the published archives means a build needs
network access to the registry and fails, rather than skips, when it has none.

The foundation cannot claim a capability until both source and at least one independent consumer execute
it. Product-specific UX remains outside reusable packages even when a reference product is the first
consumer of a new primitive.

## References

- [Nx module-boundary guidance](https://nx.dev/docs/features/enforce-module-boundaries)
- [Next.js installation and project structure](https://nextjs.org/docs/app/getting-started/installation)
- [Architecture](../ARCHITECTURE.md)
- [Release guide](../RELEASE-GUIDE.md) and README "Versioning"

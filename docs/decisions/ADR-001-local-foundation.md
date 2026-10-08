# ADR-001: Nx, pnpm, and independent consumers

Date: 2026-10-06
Status: Accepted for the proof of concept

## Context

The foundation needs one deterministic task graph, exact package-manager behavior, independently
deployable Next.js applications, contract generation from reviewed OpenAPI inputs, multilingual themes,
secure server-side sessions, and realtime recovery. Reference products must prove the package boundary
rather than importing source through workspace aliases.

## Decision

- Use pnpm workspaces for dependency management and Nx for the task graph, generators, affected builds,
  and cache boundaries.
- Pin Node.js, pnpm, Nx, TypeScript, framework, and tooling versions in the repository.
- Keep reusable packages in `mpfrontend` and every product in an independent consumer repository.
- Transfer prerelease packages as immutable, hash-checked archives until an approved registry exists.
- Use OpenAPI as the reviewed HTTP contract input and finite FTG profiles for generated presentation
  models and transport adapters.
- Keep customer and operations applications independently buildable and deployable.
- Ship English as the only built-in language and support LTR/RTL at the foundation level without
  embedding a product theme; every other language belongs to the product that uses it (amended
  2026-10-08).
- Keep product-owned design input optional through the `none` and `existing` source modes.

## Consequences

An independent consumer catches missing exports, task-order defects, source aliases, undeclared build
outputs, and package-cohort drift that an in-workspace example can conceal. The additional archive lock is
temporary operational cost; registry publication should replace it without weakening immutable cohort
verification.

The foundation cannot claim a capability until both source and at least one independent consumer execute
it. Product-specific UX remains outside reusable packages even when a reference product is the first
consumer of a new primitive.

## References

- [Nx module-boundary guidance](https://nx.dev/docs/features/enforce-module-boundaries)
- [Next.js installation and project structure](https://nextjs.org/docs/app/getting-started/installation)
- [Architecture](../ARCHITECTURE.md)

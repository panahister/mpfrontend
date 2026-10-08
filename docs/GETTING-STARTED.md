# Getting started

MP Frontend is currently distributed as source and locally packed packages. It is not yet published to a
package registry. Use the Tiffin reference when you want a complete product example; use this guide when
you want to evaluate or contribute to the foundation itself.

## Prerequisites

- Git
- Node.js `24.19.0`
- pnpm `11.25.0`
- Docker for the Redis-backed session integration gate

The pinned versions are part of the reproducibility contract. Do not silently substitute floating major
versions when investigating a failure.

## Clone and verify

```bash
git clone https://github.com/panahister/mpfrontend.git
cd mpfrontend
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm check --skip-nx-cache
```

`pnpm check` runs lint, type checking, tests, and builds across the Nx workspace. The explicit
`--skip-nx-cache` option proves the source rather than replaying previous outputs.

## Prove the package boundary

```bash
pnpm pack:local
pnpm exec nx run distribution:consumer-check
```

The first command produces and verifies the twelve package archives. The second creates an independent
consumer, installs the packed cohort, exercises both supported design-source modes, installs all eighteen
AI procedures, and runs the consumer-level security, realtime, generation, drift, and preservation checks.

Generated archives and temporary consumers are verification output. They are not committed releases.

## Run the session integration gate

```bash
pnpm exec nx run security-bff:test-redis --skip-nx-cache
pnpm exec nx run distribution:negative-controls --skip-nx-cache
```

These targets create isolated local Redis-backed scenarios. They verify multi-replica session behavior,
refresh coordination, restart and outage behavior, quotas, snapshot recovery, and stale-authority fences.
The negative-control target deliberately removes required guards and must observe the expected failures.

## Start a consumer

The public source supports two design-source choices:

```bash
mpfrontend init --name acme-portal --directory ./acme-portal --design-source none --json
```

Use `none` when the product starts from code-owned tokens and components.

```bash
mpfrontend init --name acme-portal --directory ./acme-portal --design-source existing --json
mpfrontend design attach \
  --directory ./acme-portal \
  --source existing \
  --binding ./design.binding.json \
  --json
mpfrontend design status --directory ./acme-portal --json
```

Use `existing` when the product already owns an approved design system. The binding and normalized export
remain local to that consumer. MP Frontend does not fetch or publish the design source.

Until registry publication exists, the supported public evaluation path is the vendored, hash-checked
cohort in [MP Frontend Tiffin Reference](https://github.com/panahister/mpfrontend-tiffin-reference).
Do not install an unpublished package name from an arbitrary registry.

## Repository-scoped AI procedures

`@mpfrontend/ai-skills` contains fourteen Base procedures and four optional Design procedures. They cover
architecture inspection, feature implementation, auth/access integration, contract generation, realtime,
testing, upgrades, and release preparation. Installation is repository-scoped and refuses conflicting or
partially owned targets. Procedures preserve the same CLI contracts and approval gates as manual work.

Format validation proves that the procedures are installable. It does not prove that every AI model will
make identical product decisions; human review remains required.

## Next reading

- [Frontend engineering conventions](FRONTEND-CONVENTIONS.md)
- [Architecture](ARCHITECTURE.md)
- [Design synchronization](../packages/ftg-cli/DESIGN-SYNC.md)
- [Shared runtime contract](R2-SHARED-RUNTIME.md)
- [Reference CI contract](R3-REFERENCE-CI.md)
- [Generated reads](R4-GENERATED-READS.md)
- [Generated requests](R4-GENERATED-REQUESTS.md)
- [Implementation status](IMPLEMENTATION-STATUS.md)

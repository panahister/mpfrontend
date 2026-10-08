# Implementation status

Updated: 2026-10-08.

MP Frontend is a verified public proof of concept. This document separates what the current source proves
from the work required for a stable package and production deployment.

## Verified source cohort

| Component | Version | Latest focused evidence |
|---|---:|---:|
| `@mpfrontend/ftg-cli` | `0.1.0-dev.18` | 28/28 |
| `@mpfrontend/nx-plugin` | `0.1.0-dev.17` | 19/19 |
| `@mpfrontend/ftg-core` | `0.1.0-dev.5` | included in source and consumer gates |
| `@mpfrontend/ai-skills` | `0.1.0-dev.11` | 8/8 plus 18/18 procedure format validation |
| `@mpfrontend/workspace-config` | `0.1.0-dev.0` | 64/64 |
| `@mpfrontend/security-bff` | `0.1.0-dev.6` | 12/12 installed consumer assertions |
| `@mpfrontend/realtime-core` | `0.1.0-dev.5` | 5/5 installed consumer assertions |
| Complete Nx workspace | thirteen packages | 52/52 lint, typecheck, test, and build targets |
| Local package cohort | thirteen archives | 13/13 pack and manifest verification |

Fresh independent consumer `mpfrontend-packed-consumer-5f3mP1` executed the packed CLI rather than the
source workspace. It passed code-first and consumer-owned design initialization, explicit refusal of the
removed public-template mode, private attachment and drift checks, all eighteen AI procedures, seven
design lifecycle commands, security and realtime assertions, the feature, route and package generators
(dry-run, creation, refusal of an existing destination and an Nx generator dry-run), the generated
workspace's own uncached `pnpm check` (format check, then lint, typecheck, test, build and
generated-check) over the generated app, features, routes and package, four lint negative controls,
generated-contract checks, and authored-file preservation. Dependency audit was explicitly not
run in that local fixture.

## Capability status

| Capability | Current state | Evidence boundary |
|---|---|---|
| Deterministic workspace and feature scaffolding | Implemented | Workspace, app, feature (screen and list), route and shared-package generators, each a CLI command and an Nx generator with dry-run and refusal of an existing destination; source tests and the packed consumer, whose generated features, routes and package pass its own `pnpm check` |
| Workspace quality profile | Implemented | Shared ESLint, Prettier and TypeScript configuration; the packed consumer's own `pnpm check` (format, lint, typecheck, test, build, generated-check) and three lint negative controls (app-to-app import, raw colour, hand-written CSS) |
| OpenAPI normalization and finite read/write generation | Implemented for selected profiles | Required/optional JSON, bodyless requests, typed responses, and explicit empty responses |
| Secure server-side OIDC session lifecycle | Implemented | Encrypted Redis records, refresh lease/CAS, revocation, restart, outage, and negative controls |
| Realtime admission and recovery | Implemented | Bounded tickets, quotas, replay/snapshot, reconnect, and stale-authority controls |
| English/Arabic and LTR/RTL foundations | Implemented | Runtime primitives and Tiffin consumer tests |
| Consumer-owned design attachment | Implemented | `none` and `existing`; hash, path, symlink, lock, and drift refusal |
| Public MP Frontend Figma library | Not shipped | Deliberately outside the MVP scope |
| Repository-scoped AI procedures | Implemented | Fourteen Base and four optional Design procedures |
| Registry package distribution | Not shipped | Current reference vendors immutable, hash-checked archives |
| Stable public API guarantee | Not declared | Packages remain prerelease |

## Reference implementation

[MP Frontend Tiffin Reference](https://github.com/panahister/mpfrontend-tiffin-reference) is the selected
end-to-end consumer. Its clean checkout verifies the exact twelve-package cohort with lock digest
`b98535404c82706c548fe741a2f192787e5bf3d689bfaa799d536efe9bf909a0` and passes nineteen uncached Nx
targets. Its public theme is independently authored and contains no private Figma key, export, binding,
or design provenance.

The reference exercises anonymous restaurant/menu browsing, OIDC login and signup, customer ordering,
kitchen decisions, courier dispatch and position, live tracking, delivery, notifications, role-aware
operations, English/Arabic, and LTR/RTL. That product evidence belongs to the reference and backend
repositories; it is not inferred from the reusable packages alone.

## Release gates still open

- Publish immutable packages to an approved registry and prove installation without vendored archives.
- Establish semantic-version compatibility policy and automated public API baselines.
- Run dependency audit and remote GitHub CI for the published commit.
- Complete production TLS, key custody, HA Redis, multi-region/failover, and load acceptance.
- Complete formal accessibility testing across the supported component and screen matrix.
- Prove broader OpenAPI dialect/profile coverage before describing the generator as general-purpose.
- Obtain independent security review for any production deployment.

## Claim policy

A source check proves only the source and scenario it executed. Compatibility, security, accessibility,
and production-readiness claims require their own evidence. Unsupported profiles fail explicitly instead
of being approximated.

# Independent reference and CI contract

The Tiffin reference is an independent consumer, not an in-repository example package. It must build from
its own lockfile and the exact MP Frontend package cohort it declares.

## Immutable package cohort

The reference commits twelve prerelease package archives under `artifacts/packages/` together with
`core-artifacts.lock.json`. The lock records package names, versions, archive basenames, SHA-256 digests,
and expected exports. `scripts/verify-core-artifacts.mjs` validates:

- the complete twelve-package inventory;
- exact archive bytes;
- consumer dependency and override declarations;
- matching pnpm lockfile integrity entries;
- path containment and child-symlink refusal.

This is a temporary source-distribution mechanism until an approved package registry exists. Hashes prove
byte identity relative to the reviewed lock; they do not independently prove authorship or security.

## Clean-checkout gate

```bash
node scripts/verify-core-artifacts.mjs
pnpm install --frozen-lockfile
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NEXT_TELEMETRY_DISABLED=1 \
  pnpm check --skip-nx-cache
```

The complete gate runs nineteen Nx targets across the customer app, operations app, BFFs, presentation
contracts, themes, and product-owned adapters. Application builds depend on their library builds, so an
absent adapter output cannot be concealed by a warm workspace.

## Current cohort

| Package | Version |
|---|---:|
| CLI | `0.1.0-dev.18` |
| Nx plugin | `0.1.0-dev.17` |
| FTG core | `0.1.0-dev.5` |
| OpenAPI generator | `0.1.0-dev.6` |
| AI procedures | `0.1.0-dev.11` |
| UI | `0.1.0-dev.4` |
| Security BFF | `0.1.0-dev.6` |
| Realtime core | `0.1.0-dev.5` |

The exact twelve-archive lock digest is
`b98535404c82706c548fe741a2f192787e5bf3d689bfaa799d536efe9bf909a0`. A clean publication checkout has
passed archive verification, frozen installation, and all nineteen uncached targets.

## CI limits

The workflow verifies source and immutable package transport. It does not deploy the backend, publish a
package, mutate Figma, or certify production availability, accessibility, or security. Dependency audit
is an independent networked gate and must be reported separately from deterministic source checks.

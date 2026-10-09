# Implementation status

Updated: 2026-10-08.

MP Frontend is a verified public proof of concept. This document separates what the current source proves
from the work required for a stable package and production deployment.

## Verified source cohort

| Component | Version | Latest focused evidence |
|---|---:|---:|
| `@mpfrontend/ftg-cli` | `0.1.0-dev.18` | 32/32 |
| `@mpfrontend/nx-plugin` | `0.1.0-dev.17` | 19/19 |
| `@mpfrontend/ftg-core` | `0.1.0-dev.5` | included in source and consumer gates |
| `@mpfrontend/ai-skills` | `0.1.0-dev.11` | 8/8 plus 18/18 procedure format validation |
| `@mpfrontend/workspace-config` | `0.1.0-dev.0` | 90/90 |
| `@mpfrontend/app-layout` | `0.1.0-dev.0` | 6/6 |
| `@mpfrontend/security-bff` | `0.1.0-dev.6` | 40/40 source tests, 15/15 Redis integration, 12/12 installed consumer assertions |
| `@mpfrontend/realtime-core` | `0.1.0-dev.5` | 5/5 installed consumer assertions |
| Complete Nx workspace | fourteen packages | 56/56 lint, typecheck, test, and build targets |
| Local package cohort | fourteen archives | 14/14 pack and manifest verification |

Fresh independent consumer `mpfrontend-packed-consumer-RE2qBH` executed the packed CLI rather than the
source workspace. It passed code-first and consumer-owned design initialization, explicit refusal of the
removed public-template mode, private attachment and drift checks, all eighteen AI procedures, seven
design lifecycle commands, security and realtime assertions, the feature, route and package generators
(dry-run, creation, refusal of an existing destination and an Nx generator dry-run), the generated
workspace's own uncached `pnpm check` (format check, then lint, typecheck, test, build, generated-check
and catalog-check) over the generated app, features, routes and package, a built-CSS check of the
Tailwind structural classes and the theme order, the served first paint of the English-only app (theme
from the preference cookie; a locale it does not register and an invalid value ignored), a product app
whose only locale is a right-to-left private-use fixture locale (right to left on the first visit, logical CSS,
the product's text everywhere and no English fallback), five lint negative controls, three catalog-check
negative controls,
generated-contract checks, and authored-file preservation. Dependency audit was explicitly not
run in that local fixture.

## Capability status

| Capability | Current state | Evidence boundary |
|---|---|---|
| Deterministic workspace and feature scaffolding | Implemented | Workspace, app, feature (screen and list), route and shared-package generators, each a CLI command and an Nx generator with dry-run and refusal of an existing destination; source tests and the packed consumer, whose generated features, routes and package pass its own `pnpm check` |
| Workspace quality profile | Implemented | Shared ESLint, Prettier and TypeScript configuration; the packed consumer's own `pnpm check` (format, lint, typecheck, test, build, generated-check, catalog-check) and its lint negative controls: a relative import across apps, the app-to-package tag constraint (refused when on, accepted when off), a raw colour, hand-written CSS, an import past a feature's public entry, literal text, a translation joined to other text and a physical left or right |
| OpenAPI normalization and finite read/write generation | Implemented for selected profiles | Required/optional JSON, bodyless requests, typed responses, and explicit empty responses |
| Secure server-side OIDC session lifecycle | Implemented | Encrypted Redis records, refresh lease/CAS, revocation, restart, outage, and negative controls |
| Confidential client authentication | Implemented | `private_key_jwt` (RFC 7523 assertion: token-endpoint audience, unique `jti`, 60-second lifetime, key id for rotation) and `client_secret_basic`, host-supplied credentials kept out of logs, errors, responses and `/context`; source tests and negative controls; no real identity provider was used |
| Session cookie and lifetime hardening | Implemented | `__Host-` session cookie (production default), session SameSite apart from the Lax login cookie (Strict by default in production), bounded idle (default 30 minutes) and absolute lifetimes failing closed with 401, session id rotation after sign-in and on authorization-claim changes at refresh; source tests, the Redis integration gate and negative controls |
| Hierarchical tree selector | Implemented | Controlled `Tree` (tree view and tree table) on the WAI-ARIA tree pattern with consumer-defined states and rules, right-to-left arrows, row virtualization; DOM tests of the keyboard, accessible names and a ten-thousand-node tree with happy-dom, not in a real browser or with a screen reader |
| Dialog and one-time code | Implemented | `Dialog` (native dialog, aria-modal, focus guard, Escape, focus return), `OneTimeCodeField` (digits only, configurable length, one-time-code autocomplete, paste, error state) and `ConfirmWithCode` (sends through a consumer callback, clears on close and failure, no storage); DOM tests in both directions with happy-dom, not in a real browser or with a screen reader |
| Re-authentication and step-up | Implemented | Route `maxAge` and `acr` requirements, typed step-up answers (also from RFC 9470 upstream challenges) that never name the provider, `auth_time` and `acr` checks of the new ID token, replacement of the weaker session, allowlisted return paths and resubmission only of idempotent requests; source tests and negative controls; not run against a real identity provider |
| OpenID Connect back-channel logout | Implemented | Signed logout-token validation (issuer keys, `iss`, `aud`, `iat`, `exp`, event, `sid` or `sub`, no `nonce`), `jti` replay refusal, revocation by `sid` then `sub` through a hashed vault index, 400 for invalid tokens and 503 during a store outage; source tests, the Redis integration gate and negative controls; not run against a real identity provider |
| Production profiles of the Security BFF and the presentation server | Implemented | Typed profiles that refuse startup with named reasons (https origins, durable TLS-authenticated vault with a host key ring, client authentication, Secure cookies; shared tickets and connection budget), 503 readiness without memory fallback, and negative controls for each condition; no production deployment was run |
| Realtime admission and recovery | Implemented | Bounded tickets, quotas, replay/snapshot, reconnect, and stale-authority controls |
| English built in; LTR/RTL foundations | Implemented | English is the only built-in locale. A configurable registry where a product registers its own locales with direction and digits, next to English or as its default and only locale; an allowlisted upstream Accept-Language in the Security BFF (English by default); i18n, BFF and generator tests with a right-to-left private-use fixture locale; the packed consumer serves a product whose only locale is that fixture, right to left with logical CSS and without English fallback. Every other language belongs to the product |
| Claim projection and preference cookie | Implemented | `contextClaims` from the ID token (refreshed ID token at refresh) or, by choice, the access token, bounded to 4 KiB and token-free; the preference-cookie contract for `ui_locales` and the first paint; BFF and i18n tests; the packed consumer's first paint follows the cookie and ignores an invalid value without echoing it |
| Typed message catalogs | Implemented | ICU MessageFormat through `intl-messageformat` with parameters typed from the base catalog (compile-time tests of missing and extra parameters), per-locale plural, select, numbers and dates through Intl, `mpfrontend catalog check` and the `no-literal-text` lint rule; the packed consumer's template uses catalog messages only and observes the literal-text and catalog negative controls |
| Shared application frame and template styling | Implemented | `@mpfrontend/app-layout` markup tests in both directions and for the keyboard path; the packed consumer's build compiles Tailwind v4 over the UI and shell output (`p-6` of Card is a rule of the built CSS) and loads the app theme after the neutral tokens. A browser check of a generated app, left to right and right to left, was run once by hand, before the template became English only; it is not an automated gate |
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
operations, English and a second right-to-left language, and LTR/RTL. That product evidence belongs to
the reference and backend repositories; it is not inferred from the reusable packages alone.

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

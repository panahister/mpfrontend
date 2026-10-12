# Implementation status

Updated: 2026-10-12.

MP Frontend is a verified public proof of concept. This document separates what the current source proves
from the work required for a stable package and production deployment.

## Verified source cohort

Every count in this section was recomputed from uncached runs with Node 24.19.0 and pnpm 11.25.0
(`pnpm check --skip-nx-cache`, `pnpm pack:local`, `pnpm exec nx run distribution:consumer-check`,
`pnpm exec nx run distribution:negative-controls`, `pnpm exec nx run security-bff:test-redis`,
`pnpm public:verify` and `pnpm exec nx run distribution:registry-install`), on the tree of the commit that records
it. A commit cannot name itself: the commit
before this one is `94b7692`, and the public verification line was run again on the tree that includes this
document.

| Component | Version | Latest focused evidence |
|---|---:|---:|
| `@mpfrontend/ftg-cli` | `0.2.0` | 33/33 |
| `@mpfrontend/nx-plugin` | `0.2.0` | 25/25 |
| `@mpfrontend/ftg-core` | `0.2.0` | 14/14 source tests, and the consumer gate |
| `@mpfrontend/ai-skills` | `0.2.0` | 8/8 plus 18/18 procedure format validation |
| `@mpfrontend/access-core` | `0.2.0` | 19/19 |
| `@mpfrontend/access-react` | `0.2.0` | 20/20 source tests, and the installed consumer's first paint and browser bundle |
| `@mpfrontend/ui` | `0.2.0` | 31/31 |
| `@mpfrontend/data-react` | `0.2.0` | 11/11 source tests, and the installed consumer's served list |
| `@mpfrontend/workspace-config` | `0.2.0` | 109/109 |
| `@mpfrontend/app-layout` | `0.2.0` | 6/6 |
| `@mpfrontend/presentation-server` | `0.2.0` | 21/21 |
| `@mpfrontend/security-bff` | `0.2.0` | 67/67 source tests, 15/15 Redis integration, 12/12 installed consumer assertions |
| `@mpfrontend/realtime-core` | `0.2.0` | 11/11 source tests, 5/5 installed consumer assertions |
| Release tooling | the cohort's guards, record, API reports and registry install | 15/15 source tests, the guards' self-test, and the local registry install with its two seeded controls |
| Complete Nx workspace | seventeen projects: sixteen packages and the distribution tooling | 66/66 lint, typecheck, test, build and API-check tasks, 413 source tests |
| Local package cohort | sixteen archives | 16/16 pack and manifest verification |
| Distribution negative controls | ninety-six controls | 96/96 expected failures observed |
| Public repository verification | one script over the working tree | `documents=59 files=363` |

From `0.1.0` on, one version names the whole cohort: the root `package.json` declares it, every package carries
it, and every pin of a framework package (the app template, the Nx plugin's workspace cohort, the AI procedures)
equals it; the release guard and a test refuse a pin that differs. The declared version is the next one to publish,
and a version the registry already holds is never built again, so a change after a publication moves the version.
`0.1.0` is published ([release record](releases/0.1.0.md)); the version the tree declares, `0.2.0`, is a working version on the way to `1.0.0` and is never published. Before `0.1.0`, each package's version moved when anything it packed changed: the cohort
of 2026-10-12 is listed with its SHA-256 in `docs/releases/2026-10-12-package-cohort.md`, and `CHANGELOG.md` lists
the change of each package since then under its version. The OpenAPI generator stamp (`GENERATOR_VERSION`,
`0.1.0-dev.6`) is not a package version and did not move, because the generator code did not change.

The `files` figure of the public verification is a walk of the working tree, not a count of tracked files:
the script visits every file below the repository root except the folders `.git`, `node_modules`, `.nx`,
`.next`, `dist` and `artifacts`, so an untracked file counts and a tracked file inside one of those folders
would not. `documents` is the number of Markdown files found by the same walk. The figure recorded is the one a
fresh clone of the commit prints; a working tree with an untracked file prints more.

Fresh independent consumer `mpfrontend-packed-consumer-dlmBR2` (the run on the tree of this commit) executed the packed
CLI rather than the source workspace. It passed code-first and consumer-owned design initialization, explicit
refusal of the removed public-template mode, private attachment and drift checks, all eighteen AI procedures,
seven design lifecycle commands, security and realtime assertions, the feature, route and package generators
(dry-run, creation, refusal of an existing destination and an Nx generator dry-run), the generated
workspace's own uncached `pnpm check` (format check, then lint, typecheck, test, build, generated-check
and catalog-check) over the generated app, features, routes and package, a built-CSS check of the
Tailwind structural classes and the theme order, the served first paint of the English-only app (theme
from the preference cookie; a locale it does not register and an invalid value ignored), a product app
whose only locale is a right-to-left private-use fixture locale (right to left on the first visit, logical CSS,
the product's text everywhere and no English fallback), six lint rules observed refusing a planted case
(module boundaries, raw colour, hand-written CSS, a feature's public entry, literal text, and physical left or
right in a class name, an inline style and a stylesheet), the app-to-package tag constraint refused when on
and accepted when off, four catalog-check negative controls, generated-contract checks, authored-file
preservation, and the access bindings: the served first paint of a server component that loads a snapshot through
the server-only loader holds only the granted action and link, the built browser code holds no server-only loader
code, and a client page that imports the server entry receives its refusal module; and the list route: its first
paint holds the page that a fake BFF answered for the URL state, and the BFF received only the parameters the
operation declares (an invalid size became the default, a key the state does not declare was not sent), the same
through the app's read route. The template's contract test of its list protocol ran in the generated workspace's
own check, against a contract that declares the list's query parameters. Dependency audit was explicitly not run in that local fixture.

## Capability status

| Capability | Current state | Evidence boundary |
|---|---|---|
| Deterministic workspace and feature scaffolding | Implemented | Workspace, app, feature (screen and list), route and shared-package generators, each a CLI command and an Nx generator with dry-run and refusal of an existing destination; source tests and the packed consumer, whose generated features, routes and package pass its own `pnpm check` |
| Workspace quality profile | Implemented | Shared ESLint, Prettier and TypeScript configuration; the packed consumer's own `pnpm check` (format, lint, typecheck, test, build, generated-check, catalog-check) and its lint negative controls: a relative import across apps, the app-to-package tag constraint (refused when on, accepted when off), a raw colour, hand-written CSS, an import past a feature's public entry, literal text, a translation joined to other text and a physical left or right in a class name and in a stylesheet |
| OpenAPI normalization and finite read/write generation | Implemented for selected profiles | Required/optional JSON, bodyless requests, typed responses, and explicit empty responses |
| Secure server-side OIDC session lifecycle | Implemented | Encrypted Redis records, refresh lease/CAS, revocation, restart, outage, and negative controls |
| Confidential client authentication | Implemented | `private_key_jwt` (RFC 7523 assertion: token-endpoint audience, unique `jti`, 60-second lifetime, key id for rotation) and `client_secret_basic`, host-supplied credentials kept out of logs, errors, responses and `/context`; source tests and negative controls; no real identity provider was used |
| Session cookie and lifetime hardening | Implemented | `__Host-` session cookie (production default), session SameSite apart from the Lax login cookie (Strict by default in production), bounded idle (default 30 minutes) and absolute lifetimes failing closed with 401, session id rotation after sign-in and on authorization-claim changes at refresh; source tests, the Redis integration gate and negative controls |
| Hierarchical tree selector | Implemented | Controlled `Tree` (tree view and tree table) on the WAI-ARIA tree pattern with consumer-defined states and rules, right-to-left arrows, row virtualization; DOM tests of the keyboard, accessible names and a ten-thousand-node tree with happy-dom, not in a real browser or with a screen reader |
| Dialog and one-time code | Implemented | `Dialog` (native dialog, aria-modal, focus guard, Escape, focus return), `OneTimeCodeField` (digits only, configurable length, one-time-code autocomplete, paste, error state) and `ConfirmWithCode` (sends through a consumer callback, clears on close and failure, no storage); DOM tests in both directions with happy-dom, not in a real browser or with a screen reader |
| Re-authentication and step-up | Implemented | Route `maxAge` and `acr` requirements, typed step-up answers (also from RFC 9470 upstream challenges) that never name the provider, `auth_time` and `acr` checks of the new ID token, replacement of the weaker session, allowlisted return paths and resubmission only of idempotent requests; source tests and negative controls; not run against a real identity provider |
| OpenID Connect back-channel logout | Implemented | Signed logout-token validation (issuer keys, `iss`, `aud`, `iat`, `exp`, event, `sid` or `sub`, no `nonce`), `jti` replay refusal, revocation by `sid` then `sub` through a hashed vault index, 400 for invalid tokens and 503 during a store outage; source tests, the Redis integration gate and negative controls; not run against a real identity provider |
| Production profiles of the Security BFF and the presentation server | Implemented | Typed profiles that refuse startup with named reasons (https origins, durable TLS-authenticated vault with a host key ring, client authentication, Secure cookies; shared tickets and connection budget), 503 readiness without memory fallback, and negative controls for each condition; no production deployment was run |
| Streamed request and response bodies | Implemented | A route of the BFF allowlist may declare `stream` (request and response media types, a maximum request size, the response headers it passes from a closed set, idle and total timeouts and a session check interval; no defaults). Content-Length is required (411 without it, 413 above the maximum, 415 for another media type, each before any upstream call); bodies stream with backpressure in both directions, with a bounded window of at most about 256 KiB per transfer in the BFF (what the relay pulled from the client and the upstream has not taken is measured, at most 128 KiB); an answer of another media type is refused with 502; a route whose answer may be HTML, XHTML, SVG, XML or script is refused at startup unless it passes both Content-Disposition and Content-Security-Policy; the session is read again at the route's interval and when the body ends; idle and total timeouts and client cancellation abort the upstream call. `@mpfrontend/presentation-server/relay` and the template's transfer route relay it as streams. Source tests with several megabytes each way, a session read that fails in the middle of a transfer (503 at the interval and at the end of the body, a cut connection during a download), an upstream that answers before it reads the upload, an empty answer and a content-encoded answer, nineteen negative controls, a generated-app test (each streaming gate of the relay tests and of the generated-app test waits within a bound, so a relay that holds a whole body fails instead of hanging the run) and the packed consumer's `next start` transfer of 8 MiB each way; not run against a real gateway, backend or browser |
| Access bindings for React | Implemented | Run-time snapshot validation (shape, context reference and revision, expiry, expected context, known keys), a provider read during server rendering (a new snapshot replaces the old one whole, expiry closes every entry on an idle screen, the loader is asked again on focus, stale work is fenced), hooks for a capability and a field, a guard, a link, a page manifest with navigation and a test check of duplicate ids, unregistered ids and unlisted routes, a server-only loader memoized per request, and field access in `ResourceTable` and `ResourceForm`; source tests with server rendering and happy-dom, negative controls, and the packed consumer's first paint and browser bundle; not run in a real browser or against a real access endpoint |
| Server data, URL state and backend list paging | Implemented | Reads keyed by the access scope over TanStack Query (a change of scope aborts in-flight reads, removes the old scope's data and drops late answers), writes never retried automatically and invalidating the reads they change, typed URL state over nuqs read the same way on the server and in the browser (history entries, defaults for invalid values, hidden fields dropped from the URL), a list protocol checked against the captured contract that sends only declared parameters, and `ResourceTable` with a declared client or server mode; the app template's list route uses them. Source tests with happy-dom and the nuqs React adapter, negative controls, and the packed consumer's served list and contract test; not run in a real browser or against a real backend |
| Realtime admission and recovery | Implemented | Bounded tickets, quotas, replay/snapshot, reconnect, and stale-authority controls |
| English built in; LTR/RTL foundations | Implemented | English is the only built-in locale. A configurable registry where a product registers its own locales with direction and digits, next to English or as its default and only locale; an allowlisted upstream Accept-Language in the Security BFF (English by default); i18n, BFF and generator tests with a right-to-left private-use fixture locale; the packed consumer serves a product whose only locale is that fixture, right to left with logical CSS and without English fallback. Every other language belongs to the product |
| Claim projection and preference cookie | Implemented | `contextClaims` from the ID token (refreshed ID token at refresh) or, by choice, the access token, bounded to 4 KiB and token-free; the preference-cookie contract for `ui_locales` and the first paint; BFF and i18n tests; the packed consumer's first paint follows the cookie and ignores an invalid value without echoing it |
| Typed message catalogs | Implemented | ICU MessageFormat through `intl-messageformat` with parameters typed from the base catalog (compile-time tests of missing and extra parameters), per-locale plural, select, numbers and dates through Intl, `mpfrontend catalog check` and the `no-literal-text` lint rule; the packed consumer's template uses catalog messages only and observes the literal-text and catalog negative controls |
| Shared application frame and template styling | Implemented | `@mpfrontend/app-layout` markup tests in both directions and for the keyboard path; the packed consumer's build compiles Tailwind v4 over the UI and shell output (`p-6` of Card is a rule of the built CSS) and loads the app theme after the neutral tokens. A browser check of a generated app, left to right and right to left, was run once by hand, before the template became English only; it is not an automated gate |
| Consumer-owned design attachment | Implemented | `none` and `existing`; hash, path, symlink, lock, and drift refusal |
| Public MP Frontend Figma library | Not shipped | Deliberately outside the MVP scope |
| Repository-scoped AI procedures | Implemented | Fourteen Base and four optional Design procedures |
| Registry package distribution | Published, `0.1.0` | The release workflow (started by hand; guards before the build, the complete gate, a record of SHA-256 and integrity, publication by an approved job in the environment `npm` on main with npm provenance, `latest` never given to a prerelease), its guards' source tests and self-test, and an install from two throw-away local registries: the generated scope binding keeps a decoy registry from serving `@mpfrontend`, exact pins keep a newer version out, each with a seeded control observed failing. The workflow ran on GitHub on 2026-10-12: a rehearsal, two attempts that stopped before any package reached the registry (a path that npm read as a repository, a token without the box that bypasses two-factor authentication), and the re-run that published all sixteen. `npm audit signatures` over the published cohort verified 190 packages with 0 invalid and 0 missing, and each of the sixteen carries a provenance attestation naming the release commit. The audit step of the registry-install script first failed on an npm peer conflict when it installed the sixteen into a bare folder; it was repaired for 0.1.1 and now passes against the published cohort |
| Public API and compatibility policy | Declared | README "Versioning": semantic versions, a minor version may break while the major version is 0 and a patch never breaks, a deprecated export stays for a minor version; one `api-report.json` per package compared on every check, and with the last published version at a release; no version is published yet, so no published baseline exists |

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

- Publish the first release (the owner's steps of docs/RELEASE-GUIDE.md) and prove installation from the public
  registry with `npm audit signatures`.
- Run dependency audit and remote GitHub CI for the published commit.
- Complete production TLS, key custody, HA Redis, multi-region/failover, and load acceptance.
- Complete formal accessibility testing across the supported component and screen matrix.
- Prove broader OpenAPI dialect/profile coverage before describing the generator as general-purpose.
- Obtain independent security review for any production deployment.

## Claim policy

A source check proves only the source and scenario it executed. Compatibility, security, accessibility,
and production-readiness claims require their own evidence. Unsupported profiles fail explicitly instead
of being approximated.

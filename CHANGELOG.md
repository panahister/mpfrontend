# Changelog

The change of each package, newest cohort first. From `0.1.0` on, one version names the whole cohort, and a
published version is never built again; before it, each package's version moved when anything it packed changed.
The SHA-256 of each archive of a cohort is in its release notes or record under `docs/releases/`.

## Unreleased

The next release is `0.1.0`: one version for all sixteen packages, the first published to the public npm registry
under `@mpfrontend`. It ranks above every `0.1.0-dev.N` archive packed before it. Not published yet; the release
record with the SHA-256 and the integrity of each archive is written by the release workflow when it publishes.
Every package now names its repository, its license and its publish configuration (public access, provenance).

| Package | Version | Change |
|---|---|---|
| `@mpfrontend/access-core` | `0.1.0-dev.2` to `0.1.0` | Run-time validation of an access snapshot (shape, context reference and revision, expiry, the expected context, known keys), a field state (hidden, disabled or enabled), a snapshot reader, and a typed page manifest with its navigation and its test check. `can`, `fieldAccess`, `projectFields` and `dirtyPatch` are unchanged |
| `@mpfrontend/access-react` | new, `0.1.0` | React bindings for access: a provider read during server rendering that replaces a snapshot whole, closes at expiry and asks again on focus; hooks for a capability and a field; a guard; a link; navigation; a server-only loader entry that a browser bundle cannot include; the route list of an app for the manifest test |
| `@mpfrontend/ai-skills` | `0.1.0-dev.12` to `0.1.0` | The access, form, table and feature procedures use the access bindings and the page manifest; the table and feature procedures follow the conventions for server data, URL state and the list protocol; the release and upgrade procedures follow the cohort version, the release workflow and the registry. They require CLI `0.1.0` |
| `@mpfrontend/app-layout` | `0.1.0-dev.0` to `0.1.0` | Registry metadata only |
| `@mpfrontend/data-react` | new, `0.1.0` | Server data and URL state in client components: reads keyed by the access scope over TanStack Query, whose old scope is cancelled and removed at a change, writes never retried automatically, and typed URL state over nuqs that the server reads the same way, with history entries, defaults for invalid values and hidden fields dropped |
| `@mpfrontend/ftg-cli` | `0.1.0-dev.19` to `0.1.0` | No source change. It depends on the cohort's AI procedures, Nx plugin and FTG core, and its design-sync document names the new version |
| `@mpfrontend/ftg-core` | `0.1.0-dev.6` to `0.1.0` | A list protocol: how a backend operation pages, sorts and filters, declared as data and checked against the captured contract, with a request builder that sends only the declared parameters |
| `@mpfrontend/i18n` | `0.1.0-dev.1` to `0.1.0` | Registry metadata only |
| `@mpfrontend/nx-plugin` | `0.1.0-dev.18` to `0.1.0` | A generated workspace pins the CLI, the Nx plugin and the workspace configuration at the cohort version and binds the `@mpfrontend` scope to the public npm registry in `.npmrc`. The app template pins every framework package at the cohort version and has a query client, a URL state adapter and a visitor access snapshot; its list feature reads its URL state the same way on the server and in the browser, reads pages under the access scope through the app's own read route, and sends only the parameters of a list protocol that a test checks against the contract |
| `@mpfrontend/presentation-server` | `0.1.0-dev.4` to `0.1.0` | Registry metadata only |
| `@mpfrontend/primitives` | `0.1.0-dev.1` to `0.1.0` | Registry metadata only |
| `@mpfrontend/realtime-core` | `0.1.0-dev.6` to `0.1.0` | Registry metadata only |
| `@mpfrontend/security-bff` | `0.1.0-dev.7` to `0.1.0` | A streamed route whose answer may be HTML, XHTML, SVG, XML or script is refused at startup unless it passes both Content-Disposition and Content-Security-Policy. The README states the measured bound of what the relay of a streamed body holds. Registry metadata |
| `@mpfrontend/tokens` | `0.1.0-dev.1` to `0.1.0` | Registry metadata only |
| `@mpfrontend/ui` | `0.1.0-dev.5` to `0.1.0` | `ResourceTable` and `ResourceForm` take field access: a column or field the person may not view is not rendered, a field they may not edit is disabled, and a save passes only the changed fields they may edit. `ResourceForm` takes helper and error texts per field. `ResourceTable` takes a declared client or server mode with controlled paging, sorting and filtering |
| `@mpfrontend/workspace-config` | `0.1.0-dev.0` to `0.1.0` | Registry metadata only |

What a product notices when it upgrades: every framework package moves to `0.1.0`, pinned exactly, and a generated
workspace binds the scope to the public registry. Nothing changes until it passes `access` or `control` to
`ResourceTable` or `access` to `ResourceForm`; with `access`, `ResourceForm` calls `onSubmit` with the patch. A list
feature generated from now on has a contract test that fails until the captured contract declares the query
parameters its list protocol sends (`page`, `size` and `search` in the template), and its read route answers an
invalid list query with the defaults instead of 400. A Security BFF route that streams a script-capable answer and
does not name both `content-disposition` and `content-security-policy` stops its start.

## 2026-10-12

Release notes: [docs/releases/2026-10-12-package-cohort.md](docs/releases/2026-10-12-package-cohort.md).
Compared with the archives packed before the hardening round. Not published to a registry.

| Package | Version | Change |
|---|---|---|
| `@mpfrontend/access-core` | `0.1.0-dev.1` to `0.1.0-dev.2` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/ai-skills` | `0.1.0-dev.11` to `0.1.0-dev.12` | The procedures teach what this cohort adds: the workspace quality profile, the feature, route and shared-package generators, the shared application frame, typed message catalogs and their check, English as the only built-in language with the upgrade path for a product that kept another default, the production profiles, confidential client authentication, session hardening, back-channel logout, re-authentication and step-up, the dialog, one-time-code field and tree selector, the logical-properties rule, and streamed request and response bodies. They require CLI `0.1.0-dev.19` |
| `@mpfrontend/app-layout` | new, `0.1.0-dev.0` | A shared application frame that a generated app is styled through |
| `@mpfrontend/ftg-cli` | `0.1.0-dev.18` to `0.1.0-dev.19` | Generates English-only applications; feature, route and shared-package generators; a catalog check of typed message catalogs that also reports a translated key the code uses and the base catalog does not define |
| `@mpfrontend/ftg-core` | `0.1.0-dev.5` to `0.1.0-dev.6` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/i18n` | `0.1.0-dev.0` to `0.1.0-dev.1` | English is the only built-in locale. A configurable locale registry with a direction per locale, typed message catalogs and their check, the registry's digits applied to messages in any locale, and a locale preference read by the security BFF |
| `@mpfrontend/nx-plugin` | `0.1.0-dev.17` to `0.1.0-dev.18` | The shared workspace quality profile in generated workspaces; feature, route and shared-package generators; the application template styled through the shared frame, English only, with its catalog check, a `design-verify` target and the streamed-transfer route; app folders created only when needed |
| `@mpfrontend/presentation-server` | `0.1.0-dev.3` to `0.1.0-dev.4` | A production profile. In production it refuses a ticket store over a vault without TLS or authentication, and a shared ticket store that does not declare its security (`TICKET_STORE_SECURITY_REQUIRED`). A relay that streams request and response bodies |
| `@mpfrontend/primitives` | `0.1.0-dev.0` to `0.1.0-dev.1` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/realtime-core` | `0.1.0-dev.5` to `0.1.0-dev.6` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/security-bff` | `0.1.0-dev.6` to `0.1.0-dev.7` | A production profile that refuses, among others, a provider origin that is not HTTPS. Confidential client authentication. A hardened session cookie, a default lifetime of 30 minutes idle and 8 hours absolute, and session id rotation, a rotated session indexed before it is stored. OpenID Connect back-channel logout. Re-authentication and step-up. Allowlisted claims projected into the session context, and a locale preference. Upstream locales default to English only. Request and response bodies streamed per route |
| `@mpfrontend/tokens` | `0.1.0-dev.0` to `0.1.0-dev.1` | No source change. The archive now carries the `LICENSE` file and the current README |
| `@mpfrontend/ui` | `0.1.0-dev.4` to `0.1.0-dev.5` | An accessible dialog, a one-time-code field that accepts a decimal digit of any script, and a controlled hierarchical tree selector |
| `@mpfrontend/workspace-config` | new, `0.1.0-dev.0` | The shared quality profile of a generated workspace: TypeScript, Prettier and ESLint, with rules for module boundaries, raw colours, hand-written CSS, a feature's public entry, literal text and logical properties in class names, inline styles and stylesheets |

What a product notices when it upgrades: a shared ticket store without a `security` declaration stops a
production start; sessions end after 30 minutes idle or 8 hours by default; the production profile refuses a
non-HTTPS identity-provider origin; English is the only built-in locale.

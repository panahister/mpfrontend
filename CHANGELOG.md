# Changelog

The change of each package, newest cohort first. From `0.1.0` on, one version names the whole cohort, and a
published version is never built again; before it, each package's version moved when anything it packed changed.
The SHA-256 of each archive of a cohort is in its release notes or record under `docs/releases/`.

## 1.0.0 (not yet released)

The first stable version. From it on README "Versioning" holds: only a major version breaks the public API, and every
build compares the API with the last published version. Nothing between `0.1.0` and `1.0.0` was published; this section
lists every change since `0.1.0` in the packages, the behaviour changes first. One version names all sixteen packages.

### Behaviour changes

- **Security BFF.** A streamed answer of a type that a browser would run as a document (HTML, XHTML, SVG, XML or
  script) is refused whole with a 502 (`UPSTREAM_INLINE_SCRIPT_REFUSED`) unless the upstream sent
  `Content-Disposition: attachment` or a `Content-Security-Policy` with the `sandbox` directive. Before, the startup
  check only proved that the route could pass both headers, and an answer without them was served inline. To move: have
  the upstream send one of the two.
- **React access bindings.** The server entry `@mpfrontend/access-react/server` throws `ACCESS_SERVER_ENTRY_IN_BROWSER`
  when it loads where a `document` exists, so a bundler that does not read the `browser` export condition still cannot
  run it in a browser. To move: import it only from server code; a test environment that defines `document` must not
  load it.
- **Server data (`@mpfrontend/data-react`).** `useScopedQuery`'s `initialData` seeds only the scope the hook mounted in.
  Before, after a change of scope with no new server render, the old scope's page seeded the new scope's key and was
  treated as fresh; now the new scope reads for itself. A hook that mounts without a valid snapshot is not seeded.
- **URL state (`@mpfrontend/data-react`).** `useTableUrlState` drops a sort or a filter on a field the person may not
  view from the URL only while the provider's status is `granted`. Before, a closed, missing or expired snapshot also
  made the reader say "may not view", and a linked URL lost its sort and filters on a screen that had merely expired.
- **Forms (`@mpfrontend/ui`).** `ResourceForm` with `access` requires `original`, in its type (the props are a union) and
  at run time, where a caller the types do not reach gets `RESOURCE_FORM_ORIGINAL_REQUIRED`. Before, a missing `original`
  made every shown field count as changed and the save sent them all. This is the choice that fails closed, in the
  type and at run time. A form for a new record passes an empty `original`. To move: pass `original` wherever `access`
  is passed.

### API changes against `0.1.0`

An entry point named `internal` is outside the compatibility guarantee: the API report does not hold it, README
"Versioning" says so, and a test and the packed-consumer check fail if a template, a generator or a generated file
imports one. Nothing was removed: 44 exports that no template, generator or reference app imports moved to the
`internal` entry of their package, and a need that comes later is a request for an additive public export in a minor
version. 31 other exports that only cohort packages import stay public, because a public declaration names them or the
documents offer them to a consumer. Seven exports of the Security BFF stay public as well: the types `ApiRoute`,
`SessionPolicy` and `StepUpChallenge` and the values `productionRefusals` and `CLIENT_ASSERTION_LIFETIME_SECONDS`, exported
from `@mpfrontend/security-bff`, because the first three are the shape of the public `BffConfig` and of the step-up answer
and the package's README offers the other two; and `createMemorySessionVault` and `redisVaultSecurity`, exported from
`@mpfrontend/security-bff/session-store`, where the README places them. A count of public exports in this repository counts
every key of each entry of `api-report.json`.

- `@mpfrontend/ai-skills`: `SKILLS_VERSION` and `SKILLS_CLI_VERSION` are typed `string`, because their literal type moved
  the API with every version. To `internal`: `installSkills`, `checkSkills`, `skillCatalog`, `SkillsError`.
- `@mpfrontend/ftg-core`: to `internal`: `normalizeRequests`, `normalizeResources`, `resolveSchema`, `fieldsFor`,
  `validateRead`, `validListState`.
- `@mpfrontend/primitives`: to `internal`: `buttonState`, `fieldState`, `isControlUnavailable`; the two state types stay.
- `@mpfrontend/access-core`: to `internal`: `DENIED`, `elementCapability`.
- `@mpfrontend/data-react`: to `internal`: `QueryKeyScope`.
- `@mpfrontend/ftg-cli`: to `internal`: `GeneratorConfig`, `InputError`, `loadContract`.
- `@mpfrontend/i18n`: to `internal`: `builtInLocales`, `MessageError`, `MessageValue`.
- `@mpfrontend/nx-plugin`: to `internal`: `diskReader`, `planFeature`, `planPackage`, `planRoute`, `workspaceFormatter`.
- `@mpfrontend/presentation-server`: to `internal`: `presentationProductionRefusals`, `SocketContext`.
- `@mpfrontend/realtime-core`: to `internal`: `RealtimeContext`, `reconnectDelay`, `SnapshotRecovery`.
- `@mpfrontend/security-bff`: to `internal`: `clientAssertion`, `defaultApiLocales`, `defaultAuthorizationClaims`,
  `projectClaims`, `SESSION_LIMITS`. The seven above stay public.
- `@mpfrontend/ui`: to `internal`: `nextFocus`, `treeKey`, `visibleRows`. The props of `ResourceForm` are a union: with
  `access`, `original` is required (see the behaviour changes).
- `@mpfrontend/workspace-config`: to `internal`: `codeFiles`, `globalEntryAtRules`, `styleFiles`, `visibleTextAttributes`
  (formerly of the `./eslint` entry).

### Documents

The conventions said that a filter on personal data is sent in a request body. No list read does that: a declared filter
is in the URL and in the query of the backend request, so a filter on personal data is not declared, and no body-based
list read is shipped. The conventions and the data package's README say what the URL state does with a closed or an
expired snapshot.

### Versions

Every package moves to `1.0.0`. A generated workspace pins the CLI, the Nx plugin, the workspace configuration and the
framework packages at `1.0.0`; the AI procedures require CLI `1.0.0`; `@mpfrontend/ftg-cli`'s design-sync document names
the version. The other changes since `0.1.0` are in the release tooling, not in the packages: the release workflow passes
no npm token, checks the npm and Node of its publish job and makes a dry run of `npm publish` on one archive in every
run, the record reads the changelog section of the version, the audit step of the registry check no longer fails on a
peer conflict, and every build compares the API with the published archives.

## 0.1.0 (2026-10-12)

The first release: one version for all sixteen packages, published to the public npm registry under `@mpfrontend`. It
ranks above every `0.1.0-dev.N` archive packed before it. The record with the SHA-256 and the integrity of each archive
is [docs/releases/0.1.0.md](docs/releases/0.1.0.md). Every package now names its repository, its license and its publish
configuration (public access, provenance).

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
| `@mpfrontend/nx-plugin` | `0.1.0-dev.18` to `0.1.0` | A generated workspace pins the CLI, the Nx plugin and the workspace configuration at the cohort version and binds the `@mpfrontend` scope to the public npm registry in `.npmrc`. The app template pins every framework package at the cohort version and has a query client, a URL state adapter and a visitor access snapshot; its list feature reads its URL state the same way on the server and in the browser, reads pages under the access scope through the app's own read route, and sends only the parameters of a list protocol that a test checks against the contract. The template's transfer test fails within a bound when a relay holds a whole body |
| `@mpfrontend/presentation-server` | `0.1.0-dev.4` to `0.1.0` | Registry metadata only |
| `@mpfrontend/primitives` | `0.1.0-dev.1` to `0.1.0` | Registry metadata only |
| `@mpfrontend/realtime-core` | `0.1.0-dev.6` to `0.1.0` | Registry metadata only |
| `@mpfrontend/security-bff` | `0.1.0-dev.7` to `0.1.0` | A streamed route whose answer may be HTML, XHTML, SVG, XML or script is refused at startup unless it passes both Content-Disposition and Content-Security-Policy. The README states the measured bound of what the relay of a streamed body holds, and what an early answer to an upload does. Registry metadata |
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

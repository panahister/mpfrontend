---
name: mpfrontend-implement-feature
description: Implement one approved MP Frontend feature slice across an existing consumer app, generated API boundary and UI, then verify its real states. Use only when story, contract, access and design decisions already exist.
---

# Implement an approved feature slice

Requires the reviewed MP Frontend CLI `0.1.0` cohort. Read repository instructions, the approved
story and acceptance criteria before editing. Stop when the API contract, permission, tenant rule,
business transition or DLS behavior is absent or contradictory; never invent it to complete a screen.

Map the slice before coding: route and entry point, approved OpenAPI operations, generated read/request
models, authored domain transformations, access decisions, visual states and the smallest affected Nx
projects. Keep route files thin. Product rules and presentation stay consumer-owned. Treat generated
FTG outputs and accepted design artifacts as read-only; change their declared source/configuration and
regenerate instead of hand-editing them.

Create the structure with the generators, not by hand: `pnpm exec mpfrontend create feature --app
<app-directory> --name <feature> [--resource <ftg-resource>] --dry-run --json`, then without `--dry-run`,
and `mpfrontend create route` for each screen (a detail view is a child route, for example
`<feature>/[position]`). A feature keeps the view in `ui/`, workflow state in `model/` and `hooks/`,
requests and persistence in `api/` and small pure helpers in `utils/`; code outside it imports only its
`index.ts`, which lint enforces. Types and rules that several features of one entity share go in
`src/entities/<entity>/`; code that two apps need goes in a package from `mpfrontend create package`.
Never invent a contract or an endpoint to fill a generated file; a screen feature stays unbound until
an approved contract adapter exists. Every visible text of the feature is a message in its
`model/messages/<locale>.ts` catalogs, with named parameters placed by each message; translate the
locales the generator reports as `untranslated`, and keep `catalog-check` and the `no-literal-text` lint
rule passing. A sensitive write sends an `Idempotency-Key`; when the BFF answers `STEP_UP_REQUIRED`, keep
the person's input, run the step-up and resubmit only a request whose `resubmit` is `idempotent`, with the
same key. Never replay a write without a key automatically. A feature that uploads or downloads a file
uses the app's transfer route (`/api/transfer/...`), which relays a streamed BFF route as streams: send
the file as the request body with its Content-Type and Content-Length, the CSRF token and, for a
sensitive write, an idempotency key; read a download as a stream; handle 411, 413, 415, 401, 502 and 504
as states of the slice. Never read a whole file into memory to send it, and never invent a route,
media type or size that the BFF's approved stream policy does not declare.

Use `mpfrontend-integrate-openapi`, `form-from-api` or `table-from-api` only for selected finite contract
shapes. Every new route gets one entry in the app's page manifest (`definePageManifest`) with the capability its
page and menu entry need and its elements and fields, and the manifest test (`assertPageManifest` with
`appRoutes`) stays green. Read and write server data in client components only through `@mpfrontend/data-react` (`useScopedQuery`,
`useScopedMutation`, under the app's `QueryScope`), through the app's own routes or the BFF; never retry a write
automatically and never add a global client store. Keep page, sort, filter and similar screen state in the URL with
`listUrlState` and `useTableUrlState`, never the scope or a personal value. A list over a backend declares its
paging, sorting and filtering as a `ListProtocol` checked against the contract. Present access from the server's
snapshot with `@mpfrontend/access-react`
(`AccessProvider`, `AccessGuard`, `AccessLink`, `useCapability`, `useFieldState`) as `mpfrontend-apply-access`
describes; never from a role name. Publish protected asynchronous results through `@mpfrontend/access-core`
`AuthorityFence` (`useAccessCapture()` inside a provider) and keep backend/BFF authorization authoritative. Compose `@mpfrontend/ui` primitives through the
consumer DLS adapter; do not copy sample branding into neutral code.

Implement loading, empty, success, validation, denied and recoverable error states required by the
criteria. Preserve unsaved input across safe retries and refuse stale identity/tenant/role-revision
results. Locale, theme, responsive and keyboard behavior are part of the slice when the approved
design includes them.

Run affected Nx `lint`, `typecheck`, `test`, `build`, `generated-check` and `design-verify` targets
uncached where defined. Exercise positive and negative API/access states and inspect the actual browser
surface at required viewports/locales/themes. Report exact commands and counts plus any unverified
criteria. Implementation does not authorize Git operations, deployment, publication, Figma writes,
role creation or acceptance-baseline changes.

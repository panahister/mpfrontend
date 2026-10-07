---
name: mpfrontend-implement-feature
description: Implement one approved MP Frontend feature slice across an existing consumer app, generated API boundary and UI, then verify its real states. Use only when story, contract, access and design decisions already exist.
---

# Implement an approved feature slice

Requires the reviewed MP Frontend CLI `0.1.0-dev.18` cohort. Read repository instructions, the approved
story and acceptance criteria before editing. Stop when the API contract, permission, tenant rule,
business transition or DLS behavior is absent or contradictory; never invent it to complete a screen.

Map the slice before coding: route and entry point, approved OpenAPI operations, generated read/request
models, authored domain transformations, access decisions, visual states and the smallest affected Nx
projects. Keep route files thin. Product rules and presentation stay consumer-owned. Treat generated
FTG outputs and accepted design artifacts as read-only; change their declared source/configuration and
regenerate instead of hand-editing them.

Use `mpfrontend-integrate-openapi`, `form-from-api` or `table-from-api` only for selected finite contract
shapes. Publish protected asynchronous results through `@mpfrontend/access-core` `AuthorityFence` and
keep backend/BFF authorization authoritative. Compose `@mpfrontend/ui` primitives through the
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

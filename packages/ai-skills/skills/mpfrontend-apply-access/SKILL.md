---
name: mpfrontend-apply-access
description: Apply an approved capability and field/action visibility matrix to an MP Frontend consumer while preserving server authority and stale-response safety. Use after roles, resources and grants are defined elsewhere.
---

# Apply approved access decisions

Requires the reviewed MP Frontend CLI `0.1.0` cohort, `@mpfrontend/access-core` and
`@mpfrontend/access-react`. Read the approved capability catalog, persona/tenant matrix and consumer
instructions. Do not create roles, resources, permissions or grants and do not infer authority from a sample
identity.

Keep backend or BFF enforcement authoritative. UI guards control presentation only and never turn a hidden
control into an authorization boundary. The consumer's server resolves its rules into an explicit snapshot (context
reference, revision, expiry, capabilities, fields); the browser decides no rule, never reads a role name or token
claim and never calls the identity provider or a policy service. Do not add an "open unless denied" mode in the
browser: the server resolves such a rule into the snapshot. Do not make the optional `roles` of a Security BFF
route mandatory.

Register each approved page, menu entry, element and field once in the app's page manifest
(`definePageManifest`): a route with the capability its page and menu entry need, its elements (an element's own
stable id is its capability key unless it names another) and the field keys its components read. Load the
snapshot in a server component with `createAccessLoader` of `@mpfrontend/access-react/server` (the consumer's own
endpoint through the BFF, the request's context reference, `manifestKeys`, an explicit `timeoutMs`) and pass
`clientSnapshot(result, pageKeys(manifest, page))` to an `AccessProvider`. Present with `AccessGuard`,
`AccessLink`, `useCapability`, `useFieldState`, `useNavigation` and the `access` property of `ResourceTable` and
`ResourceForm`. Denied is hidden by default; use a guard's `fallback` or `whenDenied="disabled"` only where the
approved UX says so, never by guessing.

Wrap protected asynchronous reads in `AuthorityFence`: inside a provider, capture with `useAccessCapture()` before
a request and call `assertCurrent()` before publishing its result. The context identity must distinguish subject,
tenant, effective capability revision and session, so the server's context reference and revision change with them
and results captured under an older authority cannot publish into a newer view. On identity/tenant/role changes,
invalidate protected caches and realtime subscriptions without destroying safe unsaved drafts.

Test unauthenticated, forbidden, permitted, tenant-isolated, stale-token, refreshed-token, revoked-role
and delayed-response cases, an expired snapshot on an idle screen and a revision change during a pending request.
Run `assertPageManifest(manifest, {routes: await appRoutes('src/app'), ids})` with `appRoutes` from
`@mpfrontend/access-react/testing`. Include a failing control that proves removing the fence, a guard or the
server check would expose the defect. Exercise the actual browser surface for every approved persona, check that
the first paint holds no denied entry, and verify the API still refuses direct unauthorized requests.

Report the exact matrix covered, commands/counts and unresolved policy decisions. This skill does not
authorize identity-administration writes, production policy changes, deployment or publication.

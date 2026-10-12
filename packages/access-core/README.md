# @mpfrontend/access-core

Local development package. Runtime: universal. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

`AuthorityFence` aborts in-flight browser work and rejects stale publication after a consumer-owned
authority identity changes. Capture before starting a request and assert again immediately before
publishing its result. Identical context refreshes preserve work; switching away and back does not
resurrect an old response. Consumers choose the identity (subject, tenant, role revision/session).
This is a UI isolation guard, not permission enforcement; it cannot recall an upstream mutation.

## Snapshot validation and field state

`parsePageAccess(value, {now, contextRef, keys})` validates a snapshot at run time before anything reads it:
exactly the five members (so no identity or token data rides along), a bounded context reference and revision,
a finite expiry, boolean grants and field access, the context the caller expects and, when given, the known keys.
A malformed, expired or mismatched snapshot is refused whole (`MALFORMED`, `EXPIRED`, `CONTEXT_MISMATCH`,
`UNKNOWN_KEY`) and grants nothing. `pickPageAccess` keeps only the listed keys. `fieldState` returns `hidden`,
`disabled` or `enabled`; a control that is already disabled or busy stays disabled. `accessReader(snapshot)`
reads one snapshot for components and is closed without one. `can`, `fieldAccess`, `projectFields` and
`dirtyPatch` are unchanged.

## Page manifest

`definePageManifest` lists every route of an app once: the capability its page needs, the capability of its menu
entry, its elements and the field keys its components read, and the navigation groups. `buildNavigation` shows a
page when the snapshot grants its menu and its page capability, and a group when it grants the group's menu and
at least one child shows: a parent grants no child, and a group with no visible child is pruned.
`checkPageManifest` and `assertPageManifest` report a duplicate id, an id the app uses that the manifest does not
register and a route with no entry. `pageKeys`, `navigationKeys` and `manifestKeys` give the keys a provider
needs and the keys a snapshot is checked against. The React bindings are `@mpfrontend/access-react`.

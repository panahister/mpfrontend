# @mpfrontend/access-react

Local development package. Runtime: client, with a server-only entry. Public API is exported from
`src/index.tsx`, `src/server.ts` and `src/testing.ts` and compiled into dist. Nx owns build, typecheck, lint and
test targets. Consumer applications install packed artifacts. See ../../docs/IMPLEMENTATION-STATUS.md for
observed evidence and remaining work.

React bindings for an access snapshot of `@mpfrontend/access-core`. The consumer's server decides what each
person may see and do: it resolves its own rules into an explicit snapshot (context reference, revision, expiry,
capabilities and fields) and sends it through the BFF. The UI shows menus, pages, actions and fields from that
snapshot only; whatever it does not grant stays closed. A hidden control is not authorization: the BFF, the
gateway and every service still check each request. No export takes a role name or reads a token claim, and
nothing here calls the identity provider or a policy service.

## Server entry: `@mpfrontend/access-react/server`

`createAccessLoader({load, contextRef, keys, timeoutMs})` returns a function of one request object (for example
`await headers()` in a server component). It calls the consumer's `load` (its own endpoint, reached through the
BFF) with an abort signal bounded by `timeoutMs`, validates the answer at run time (shape, context reference and
revision, expiry, the request's `contextRef`, the known `keys`) and memoizes the result for that request object.
A malformed, expired or mismatched snapshot, a failed load and a slow one grant nothing.
`clientSnapshot(result, keys)` keeps only the keys a provider's components need (`pageKeys` and `navigationKeys`
of the page manifest), never identity or token data, and is `null` when nothing is granted.

The entry is never part of a browser bundle: its `browser` export condition resolves to a module that throws
`ACCESS_SERVER_ENTRY_IN_BROWSER`.

## Client entry: `@mpfrontend/access-react`

- `AccessProvider` holds one snapshot for its subtree and is read during server rendering, so the first paint
  shows no forbidden entry. It validates the snapshot it receives (`keys` and `contextRef` when given). A new
  snapshot replaces the old one whole. At `expiresAt` it closes every entry, on an idle screen too, with a timer.
  When the window regains focus it calls `reload(signal)`, and the answer replaces the snapshot; an answer that
  arrives after the snapshot was replaced is dropped. Work captured with `useAccessCapture()` is aborted and cannot
  publish once the context or revision changes (`AuthorityFence`).
- `useCapability(key)` returns whether the capability is granted. `useFieldState(key, {disabled, busy})` returns
  `hidden`, `disabled` or `enabled`; a control that is already disabled or busy stays disabled. `useAccess()` returns
  the reader for loops and forms (`ResourceForm` and `ResourceTable` of `@mpfrontend/ui` take it as `access`).
  `useAccessScope()` returns the context reference and revision in use; `useAccessStatus()` returns `granted`,
  `missing`, `invalid` or `expired`.
- `AccessGuard` renders its children only when its capability is granted and otherwise nothing. A `fallback`, or
  `whenDenied="disabled"` with a render function, only when that guard asks for it.
- `AccessLink` renders no anchor, href, prefetch or focus target when denied; `as` takes the router's link
  component, for example `next/link`.
- `useNavigation(manifest)` builds navigation from the page manifest and the snapshot.

A missing provider, a missing, malformed or expired snapshot and an unknown key close every kind of entry: menu,
page, element and field. The browser decides no rule; a rule such as "open unless denied" is resolved by the
consumer's server into the snapshot.

## Page manifest

`definePageManifest` (from `@mpfrontend/access-core`) lists every route once: the capability its page needs, the
capability of its menu entry, its elements (an element's own stable id is its capability key unless it names
another) and the field keys its components read, plus navigation groups. A test of the consumer runs
`assertPageManifest(manifest, {routes: await appRoutes('src/app'), ids})`, with `appRoutes` from
`@mpfrontend/access-react/testing`; it fails on a duplicate id, an id the app uses that the manifest does not
register, and a route with no manifest entry.

# @mpfrontend/data-react

Part of [MP Frontend](https://github.com/panahister/mpfrontend), released to the public npm registry as one cohort: every `@mpfrontend`
package at the same exact version. Runtime: client, with a universal shared entry. Install it through a workspace that `mpfrontend init`
created, which pins the cohort and binds the scope to the registry in `.npmrc`. [Versioning](https://github.com/panahister/mpfrontend#versioning)
states the compatibility policy and [Implementation status](https://github.com/panahister/mpfrontend/blob/main/docs/IMPLEMENTATION-STATUS.md) the
evidence.

The conventions for server data and URL state in client components. `@tanstack/react-query` and `nuqs` are peer
dependencies: the app owns its `QueryClient` and its nuqs adapter.

## Server data: `@mpfrontend/data-react`

- `QueryScope` sits inside the app's `QueryClientProvider` and the `AccessProvider` of `@mpfrontend/access-react`.
  When the context reference or the revision of the access snapshot changes, it cancels and removes every query of
  another scope and every query without a scope.
- `useScopedQuery({operation, params, read})` keys a read by the scope, the operation and the parameters, runs only
  under a valid snapshot, passes an `AbortSignal` that also aborts at a change of scope, and drops an answer that
  arrives after the change. `read` goes through the app's own route or the BFF.
- `useScopedMutation({operation, write, invalidates})` never retries a write automatically and invalidates the
  named reads of the current scope after it succeeds.

## URL state: `@mpfrontend/data-react/shared` and `useTableUrlState`

`listUrlState(protocol, {size, sizes, sort})` defines the URL state of a list over a `ListProtocol` of
`@mpfrontend/ftg-core`: typed keys `page`, `size`, `sort` (`field.asc` or `field.desc`) and one per declared filter,
with defaults and limits. Only the sort fields and filters that the protocol declares are read; an invalid value
falls back to its default; values equal to their defaults are left out of the URL. `read(searchParams)` gives the
state on the server for the first render; `useListUrlState` and `useTableUrlState` give it in the browser, where each
change is a new history entry and a new size, sort or filter starts at the first page. With field access, a sort or
a filter on a field the person may not view is dropped and removed from the URL on load, when a valid snapshot says so;
a closed or expired snapshot says nothing and leaves the URL as it was linked. The scope never enters the
URL. `scopedQueryKey` and `inScope` are the key functions of the convention.

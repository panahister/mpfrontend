---
name: mpfrontend-table-from-api
description: Render a validated MP Frontend read model with ResourceTable and consumer-owned labels, formatting and detail navigation, with paging, sorting and filtering declared from the contract. Does not infer mutations, backend parameters or field permissions.
---

# Render a selected read model

Read the consumer instructions, approved operation and pinned public exports. Use the installed
`mpfrontend-integrate-openapi` procedure if no generated read exists. Inspect the selected
operation, responseStatus and responsePath: metadata selects columns, but `parseRead` validates the
whole response. Do not cast an unvalidated payload into table rows or convert response fields into
form inputs. Missing success schemas require API/projection review, not fabricated examples.

Place generated parsing before state/rendering while preserving the consumer's authority and abort
fences. Extract rows from the validated model in an authored adapter. Use `ResourceTable` from
`@mpfrontend/ui`, a caption, localized labels, a value formatter and stable domain row keys when
available. When the page has an access snapshot, pass `access={useAccess()}` from `@mpfrontend/access-react`: a
column whose field the person may not view is removed with its header. Field access comes from the server's
snapshot; do not derive permissions from fields or role names. Keep authorized detail navigation consumer-owned
and render a detail link with `AccessLink`, which renders nothing when denied. Untrusted text stays React text, not
injected HTML. Do not reveal sensitive columns merely because the API describes them.

Paging, sorting and filtering follow the documented conventions. Declare how the operation encodes them as a
`ListProtocol` of `@mpfrontend/ftg-core` in the entity of the resource (parameter names and encodings, where the
answer holds the rows and the total) and keep its test, `checkListProtocol` against the captured contract, green:
send only parameters the operation declares, never an invented one. Define the URL state with `listUrlState` of
`@mpfrontend/data-react/shared`; the server screen reads it for the first render and the client binds it with
`useTableUrlState`. Read pages with `useScopedQuery` through the app's own route, which reads the same URL state and
calls the server boundary with `listSearchParams`. Give `ResourceTable` a declared `mode`: `server` when the backend
pages, sorts or filters (it never does so itself), `client` only when the whole data set is in hand; never mix
them. Its control texts come from the feature's catalog. Never put the scope, a token, a secret or a personal value
in the URL. Implement loading, error and empty states; do not pretend the table is a virtualized grid. Keep
horizontal overflow inside the table, not the viewport, and use logical alignment for right to left. Refresh must
not overwrite an unrelated editing draft.

Test the actual response adapter with malformed data, status mismatch, nullable/optional values,
empty results, meaningful row-key/detail behavior and, with an access snapshot, a column the person may not view.
Test the protocol against the contract, a link and a refresh that restore the list, back and forward, an invalid URL
value that falls back to its default, and a change of access scope while a page is loading. Prove the parser runs before protected data
is published and that an isolated parser-removal control fails a real assertion. Check labels,
number/date formatting, loading/retry and keyboard detail access left to right and right to left, light/dark and
mobile widths. Run the actual generated-check and Nx gates uncached.

Report the selected contract, the list protocol, rows actually observed and unresolved grid/access features.
No API exposure, business write, deployment or publication is authorized by this procedure.

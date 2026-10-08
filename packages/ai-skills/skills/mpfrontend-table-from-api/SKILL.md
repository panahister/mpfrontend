---
name: mpfrontend-table-from-api
description: Render a validated MP Frontend read model with ResourceTable and consumer-owned labels, formatting and detail navigation. Does not infer mutations, backend paging or field permissions.
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
available. Keep authorized detail navigation consumer-owned; do not derive permissions from fields.
Untrusted text stays React text, not injected HTML. Do not reveal sensitive columns merely because
the API describes them.

The current table is finite: columns, rows, formatting and an optional detail cell. Implement loading,
error, empty, paging, sorting and filtering in the consumer using the real API semantics; do not
pretend it is a virtualized grid or invent server-side query parameters. Reconcile page indexes and
empty pages explicitly after refresh. Keep horizontal overflow inside the table, not the viewport,
and use logical alignment for right to left. Refresh must not overwrite an unrelated editing draft.

Test the actual response adapter with malformed data, status mismatch, nullable/optional values,
empty results and meaningful row-key/detail behavior. Prove the parser runs before protected data
is published and that an isolated parser-removal control fails a real assertion. Check labels,
number/date formatting, loading/retry and keyboard detail access left to right and right to left, light/dark and
mobile widths. Run the actual generated-check and Nx gates uncached.

Report the selected contract, rows actually observed and unresolved grid/paging/access features.
No API exposure, business write, deployment or publication is authorized by this procedure.

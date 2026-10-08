---
name: mpfrontend-form-from-api
description: Bind a scalar MP Frontend ResourceForm to an explicitly generated required JSON request, with authored defaults and protected submission. Not response-to-form inference, nested widgets or guarded PATCH generation.
---

# Bind a selected request form

Read the consumer instructions, pinned package exports and approved operation first. A review does
not authorize a mutation. This finite workflow needs compatible FTG request generation; use
`mpfrontend skills list --json` and the installed `mpfrontend-integrate-openapi` procedure when the
request is not yet generated. Do not invent a mutation or turn response fields into editable inputs.

Inspect the generated `requests` metadata and `RequestModels` for the exact named operation. The
supported default ResourceForm fields are string, boolean, number and integer. Author defaults,
labels, domain constraints and the payload adapter outside generated output. Refuse object/array
fields rather than serialize them into scalar controls. Nullable, enum and optional-field UX needs
an explicit authored adapter; the generic scalar form is not a complete schema widget registry.

Use `ResourceForm` from `@mpfrontend/ui`, with the selected request's fields, controlled values,
localized saveLabel, labels and onChange. A required JSON boolean can validly be false: do not
interpret it as mandatory consent. Keep permission/busy disabled states, empty-form rejection,
integer/decimal behavior and errors accessible. Remount or clear the draft when authority or the
edited resource changes. A remote refresh must not silently overwrite an active editing draft.

Construct the declared body in an authored adapter, call generated `parseRequest` immediately before
submission, then retain the existing protected transport, CSRF, idempotency and authority fencing.
Validate at the server boundary too; never trust a browser-only guard. Backend business rules and
permissions remain authoritative. Handle actual 200/201/202 response contracts independently;
no fallback success, read-derived partial PUT, guessed PATCH or field-access inference.

Test the actual adapter with valid and rejected inputs, unknown/read-only fields, disabled and
empty forms, both boolean values and relevant domain limits. Prove invalid input never reaches
the transport; remove that guard only in an isolated negative-control fixture and require the
real assertion to fail. Verify labels and focus/error behavior left to right and right to left, and light/dark.
Run the consumer's actual generation/check, lint, typecheck, test and build targets uncached.

Report the selected operation, observed tests and remaining widget/access/concurrency gaps.
No live write, deployment, publication or complete production-form acceptance is implied.

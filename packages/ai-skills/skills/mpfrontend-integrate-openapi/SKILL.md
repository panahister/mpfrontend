---
name: mpfrontend-integrate-openapi
description: Integrate approved local OpenAPI 3.1 responses or explicitly selected required JSON requests with FTG models and standalone validators, preserving authored overrides. Does not invent APIs, authorize writes or infer form transforms.
---

# Integrate an explicit API contract

Requires MP Frontend CLI `0.1.0-dev.18`. Read the consumer instructions and the named API owner's
contract before edits. An implementation request permits scoped integration; a review alone does not.

Establish the public presentation boundary: browser paths, server operation bindings, auth/roles,
errors and the fields intentionally exposed. A backend URL, response example or DTO is not an
approved browser contract. Preserve the internal/private boundary and any existing exposure policy.
Record upstream identity/digest and explicit projection differences; do not fabricate missing success
schemas. Ask the API owner to correct its OpenAPI or get a reviewed projection before proceeding.

The current generator supports finite OpenAPI 3.1 object/array read shapes, required versus nullable,
primitive enums and scalar dictionaries. It rejects recursive/unsupported composed types, meaningful
reference siblings and mixed fixed/dictionary signatures. Unsupported diagnostics are prerequisites,
not permission to erase constraints. Response fields are always non-editable; a response cannot
become a write contract merely because it lacks readOnly annotations.

Configure a local `ftg.config.json` with `openapi`, `output` and explicit `resources` selections
(`name`, `operationId`, optional `responsePath` and explicit `responseStatus` 200/201/202; default 200).
`responsePath` selects table fields; generated `ReadModels` and `parseRead` validate the **whole
selected JSON response**, not just the selected row. Do not relabel a 201/202 operation as 200.
Use a new/owned generated output location, retaining all authored overrides separately.

For an authorized input integration, select a separate `requests` entry by its exact `name` and
`operationId`. The current profile requires a mutation operation with a required application/json
object body and explicitly closed objects at every level. `RequestModels`, `requests` metadata and
`parseRequest` validate this declared body: read-only fields are excluded/forbidden, write-only
inputs are included, and unknown fields/constraints are not stripped or coerced. An open or optional
body requires a reviewed contract/profile decision, not a guessed allowlist. Form defaults, widgets,
read-to-form mappings and dirty-field transforms remain authored. A complete PUT body is not a
guarded partial update; do not infer PATCH, concurrency or field permissions from these types.

Check `pnpm exec mpfrontend --version`. Run `pnpm exec ftg generate --config <config> --dry-run
--json`, inspect the plan, then generate only within the requested implementation scope. Run
`pnpm exec ftg check --config <config> --json`. A lock/collision/drift failure needs inspection of
its actual owner; never delete a live writer marker or use force overwrite.

Use the exact pinned Ajv/ajv-formats runtime-helper dependencies from the compatible template.
Generation compiles standalone validators; do not compile schemas dynamically in the browser or
weaken CSP with unsafe-eval. Call generated `parseRead` before protected results reach state/rendering,
while keeping the consumer's authority/abort fence. Its generic error must not log response payloads.

Verify valid and malformed actual-contract responses, nullable/optional fields, required values,
extra/write-only fields, formats and numeric/string/array limits as applicable. No coercion, default
insertion, field stripping or business mutation may hide an invalid read. Prove drift failure in an
isolated fixture and show that regeneration preserves authored overrides. Run actual Nx targets
uncached; compare the FTG manifest hash with the immutable contract served to Swagger.

For selected requests, also prove rejection of read-only/unknown fields, malformed nested inputs,
and missing write-only required values without logging them. Validate before the existing protected
server mutation path; generated validation never replaces CSRF, identity, roles or backend enforcement.
Prove unknown resource/request names cannot invoke inherited validator-object properties.

Report observed commands, counts, contract identities and gaps. Format/source installation does not
prove Codex/Claude behavioral parity. Do not change Figma, publish, deploy or claim production-ready
authorization, HA or complete write-model acceptance from generated read models.

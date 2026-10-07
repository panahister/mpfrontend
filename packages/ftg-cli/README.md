# @mpfrontend/ftg-cli

Local development package. Runtime: tooling. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

## Repository commands

```sh
mpfrontend init --name my-product --directory ./my-product --design-source none --dry-run --json
mpfrontend init --name my-product --directory ./my-product --design-source existing --json
mpfrontend design attach --directory ./my-product --source existing --binding design.binding.json --json
mpfrontend design status --directory ./my-product --json
mpfrontend create app --name customer --directory ./my-product/apps/customer --dry-run
mpfrontend skills list --json
mpfrontend skills install --directory ./my-product --for both --profile base --dry-run --json
mpfrontend skills check --directory ./my-product --json
ftg generate --config ./my-product/apps/customer/ftg.config.json --dry-run --json
ftg check --config ./my-product/apps/customer/ftg.config.json --json
```

`init` creates a neutral pinned Nx/pnpm shell in a **new** directory; an existing directory or symlink
is refused. It does not install dependencies, run Git, access/modify Figma, deploy, publish or configure
protected runtime authority. The catalog template requires an explicitly supplied approved OpenAPI
contract. The generated README describes the sequence; a scaffold/build is not production acceptance.
Development packages are not published: local validation supplies verified tarball overrides.

Design-source selection is an explicit workspace contract:

- `none` is a fully usable code-first workspace and may attach a source later.
- `existing` is a consumer-owned private or product DLS. Attachment validates only the local binding;
  the source, normalized exports, mappings, assets and distribution rights remain in the consumer.

The MVP does not publish, require or offer a Figma Community DLS. A product without a DLS can remain
code-first with `none`; a product with any approved existing Figma/DLS uses `existing`.

Initialization records `disabled` or `pending` state in `.mpfrontend/design-source.json`; it never
captures or writes Figma. `design attach` changes only that root contract, is dry-run capable,
exclusive and idempotent for the exact same attachment, and refuses source changes once attached.
`design status` revalidates an attached consumer binding. It does not import or accept a design
baseline. See [the design contract](./DESIGN-SYNC.md).

All eighteen approved finite source procedures are available. Actual agent behavioral acceptance remains
separate. Skill ownership
and repository concurrency rules are described in @mpfrontend/ai-skills, not hidden by placeholders.

FTG refuses generation/check/dry-run while an output `.ftg-write.lock` marker exists. Writers acquire
it exclusively and compare planned files before replacement; rollback preserves a concurrent change
instead of silently overwriting it. A crashed writer can leave its marker/partial output: inspect the
files and reconcile their manifest before an operator removes the stale marker. There is no force
option or automatic age-based deletion. Multi-file output is not a crash-atomic filesystem transaction.

FTG generator dev.6 emits selected full 200/201/202 JSON-response or explicit empty-204
`ReadModels`/`parseRead`, standalone CJS validators and
declarations in the same owned output/manifest as resource field metadata. `responsePath` selects
table fields only; it does not truncate the response reader. Validators are compiled during generation
using Ajv 8.20.0 and ajv-formats 3.0.1; consumers need those exact runtime-helper dependencies.
Runtime does not compile schemas or require unsafe-eval. Invalid data throws a generic error without
logging payloads; values are never coerced, defaulted or stripped. Required write-only properties are
omitted from read types/requirements and explicitly rejected in a response, even in an open object.

Read generation currently requires OpenAPI 3.1 finite object/array shapes. Unsupported recursive,
composed or mixed fixed/dictionary models and meaningful reference siblings are rejected rather than
guessed. This is not complete form/write/permission generation. See the
[OpenAPI schema specification](https://spec.openapis.org/oas/v3.1.0.html#schema-object) and
[Ajv standalone design](https://ajv.js.org/standalone.html) for the underlying contracts.

Explicit `requests` selections independently generate `RequestModels`, `requests` field metadata and
`parseRequest` standalone validators. The JSON profile requires a required JSON object mutation body,
closed objects at every level and supported non-recursive schemas. It preserves validation constraints,
includes write-only inputs and forbids read-only/unknown fields. An explicit request selection with
`body: "none"` requires an absent OpenAPI requestBody and emits an undefined-only type/validator and
empty field metadata. Any supplied payload is refused, including null and an empty object. This is a
consumer restriction, not an inference that every server with absent metadata forbids all bodies.
An explicit request selection with `body: "optional-json"` instead requires a present OpenAPI
requestBody whose `required` flag is not true. It emits `undefined` plus the declared finite closed
object shape; an exact null/object union also includes null. Its validator accepts absence and valid
declared values while still rejecting malformed, unknown or incomplete objects.
An explicit response selection with `responseStatus: "204"` and `body: "none"` requires a declared
204 response with no `content`, forbids `responsePath`, and emits an undefined-only read type/validator.
JSON profiles never silently become empty. Other empty statuses, multipart, guarded PATCH, business
rules and inferred widgets remain unsupported. See
[request integration](../../docs/R4-GENERATED-REQUESTS.md) for its tested scope.

The executable reports its own packaged version, not the generator's version. Fresh packed-consumer
validation checks this equality, thirty-six installed Codex/Claude procedure files, required-boolean false,
real client bundling, frozen installation and preservation controls. Advisory upload is separate:
`tools/distribution/consumer.mjs` does not run online audit unless explicitly given `--online-audit`.
Without it the report says `dependencyAudit: not-run`, never passed. Get authorization for metadata
upload to the registry's advisory service before selecting that option.

CLI dev.18 provides source `attach`/`status` plus the seven lifecycle `design` commands against a
finite normalized local export:
[reviewed export lifecycle and evidence contract](./DESIGN-SYNC.md). Base skills install twenty-eight
files; the combined design profile installs thirty-six. An import never changes baseline, a generated
component registry is not React implementation, and acceptance verifies reviewed artifact identities
rather than executing or judging the reported tests. Actual reference design/visual acceptance remains
separate. No Figma write, automatic watcher, deployment or registry action is performed.

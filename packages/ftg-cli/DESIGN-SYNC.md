# Reviewed export synchronization

CLI dev.18 implements explicit source onboarding plus a **finite normalized local export** profile. It does not call Figma, infer
missing behavior, run an LLM, execute test commands, publish or monitor for updates. The caller must
have implementation authority for the named consumer and separate human review for promotion.
The baseline covers only the declared export, never an assertion that the entire Figma DLS is implemented.

## Select and attach the source

Initialize a new workspace with exactly one mode:

```sh
mpfrontend init --name product --directory ./product --design-source none --json
mpfrontend init --name product --directory ./product --design-source existing --json
```

`none` is code-first and reports `disabled`; it can attach later. `existing` means the product/team owns
its own private or public DLS, its binding, exports and distribution rights. The design-backed mode
starts `pending`; initialization does not inspect, copy, publish or change any Figma file. The MVP does
not ship or depend on a Figma Community design system.

After creating the binding described below, attach and verify it:

```sh
mpfrontend design attach --directory . --source existing --binding design.binding.json --dry-run --json
mpfrontend design attach --directory . --source existing --binding design.binding.json --json
mpfrontend design status --directory . --json
```

Attachment verifies the full canonical binding hash. The attached contract is immutable: selecting
another source or binding requires an explicitly reviewed new workspace/migration, not a force flag.
Paths and symlinks fail closed, writers use an exclusive lock, and dry-run writes nothing. `status`
revalidates current files but never imports or accepts a baseline.

The attachment records the binding path/hash but does not duplicate the private source
identity into `.mpfrontend/design-source.json`; the consumer binding remains authoritative. This reduces
metadata duplication but is not publication sanitization: a private binding/export still stays private.

## Inputs

Place `design.binding.json` at the consumer root. All paths are relative to that root. Snapshot input
can be an explicitly supplied local file; source identity must match. Unknown revision/capture time stay null.
Preserve the original export and its provenance outside core; record any deliberate normalization,
collection/mode projection or omitted scope. Do not invent a capture/revision or distribution rights.

```json
{
  "schemaVersion": 1,
  "id": "product-theme",
  "source": {"fileKey": "supplied-file-key", "nodeId": "1:2"},
  "brandId": "product-brand",
  "modeAttribute": "data-mode",
  "stateDirectory": ".mpfrontend/design/product-theme",
  "outputDirectory": "themes/product-theme/generated",
  "tokens": [{"sourceId": "color:surface", "cssName": "--mp-surface-canvas"}],
  "components": [{"sourceId": "button:1", "adapter": "src/button.tsx", "tests": ["tests/button.test.ts"]}],
  "ignoredTokens": [],
  "ignoredComponents": []
}
```

`modeAttribute` is data-mode or data-theme. State directory must be `.mpfrontend/design/<id>` and
output a themes/packages subdirectory ending in `/generated`. Stable source IDs may contain letters,
digits, dots, colons, underscores and hyphens; prototype keys are refused. CSS names and brand IDs
have constrained syntax. Ignore entries are `{sourceId, reason}` and cannot overlap mapped entries.
Ignored scope is an explicit reviewed exclusion, not full-DLS acceptance.

```json
{
  "schemaVersion": 1,
  "source": {
    "fileKey": "supplied-file-key", "nodeId": "1:2", "revision": null,
    "capturedAt": "2026-10-07T07:00:00.000Z", "extractorVersion": "reviewed-export-v1"
  },
  "modes": ["light", "dark"],
  "tokens": [{
    "id": "color:surface", "name": "Canvas", "type": "color",
    "values": {"light": "#ffffff", "dark": "#101010"}
  }],
  "components": [{
    "id": "button:1", "name": "Button", "variants": {"tone": ["primary", "ghost"]},
    "properties": {"disabled": "boolean"},
    "behavior": {"status": "known", "description": "Disabled prevents pointer and keyboard activation"},
    "assets": []
  }],
  "assets": []
}
```

Token types: color (3/4/6/8-digit hex), dimension (`{value, unit}` with px/rem/em/%), finite number,
or a constrained plain string. A value can instead be `{alias: "stable-token-id"}` in either mode;
cycles, absent targets and incompatible types fail. This is not arbitrary CSS/gradient/expression,
font-asset or multi-collection compilation. The profile explicitly requires light/dark normalized modes;
additional modes/unknown schema fields are rejected rather than discarded. Component variants are
named string lists; properties describe an authored API, not a TypeScript code generator. Behavior
can be unknown for import/diff, but an unknown mapped behavior blocks application/promotion.

Assets are `{id, sha256, mimeType, license}`; component asset IDs must resolve. Unknown license blocks
application. Only metadata is generated: binary assets/fonts and their rights remain consumer-owned.
Do not interpret a declared license string as independent legal clearance.

## Commands and ownership

```sh
mpfrontend design import --binding design.binding.json --snapshot reviewed-export.json --dry-run --json
mpfrontend design import --binding design.binding.json --snapshot reviewed-export.json --json
mpfrontend design validate --binding design.binding.json --candidate <hash> --json
mpfrontend design diff --binding design.binding.json --candidate <hash> --json
mpfrontend design plan --binding design.binding.json --candidate <hash> --dry-run --json
mpfrontend design plan --binding design.binding.json --candidate <hash> --json
mpfrontend design apply --plan <returned-plan-path> --dry-run --json
mpfrontend design apply --plan <reviewed-plan-path> --json
mpfrontend design accept --plan <reviewed-plan-path> --evidence evidence/acceptance.json --dry-run --json
mpfrontend design check --binding design.binding.json --json
```

Import creates a hash-addressed immutable candidate, never a baseline. Plan is bound to the candidate,
CLI version, canonical binding, prior baseline/ownership and current output hashes. Review it before
apply. Apply writes only two owned outputs (`tokens.gen.css`, `components.gen.json`) and an ownership
receipt. CSS is brand-scoped with light/dark and system-dark selectors. Component metadata is not
React implementation. Initial/changed/removed components, asset changes and token rename/removal
produce authored tasks; unchanged mapped components still require adapter/test evidence.

Unknown mappings, unresolved behavior/rights, stale plans and an unowned output collision fail closed.
Paths cannot traverse or enter protected/private configuration; every consumer symlink is refused.
Writers acquire an exclusive `.design-write.lock`, stage files and compare before replacement. Rollback
preserves a concurrent edit and reports conflicts. This is not a crash-atomic filesystem transaction:
after interruption inspect the marker, staged/owned files, hashes and exact plan before operator recovery.
No age-based marker removal, force overwrite or authored-source deletion is implemented. Cooperative
writer locks do not turn an adversarial local filesystem into a sandbox/security boundary.

Exit codes: 0 success, 2 invalid/unsupported inputs or unresolved mapping, 3 stale/drift/failed acceptance,
4 path/ownership/concurrency violation. Dry-run performs no writes. Check before a baseline is accepted
fails with code 3; applying tokens alone is not an accepted synchronization.

## Evidence and acceptance

`accept` consumes a reviewed attestation, **not a test execution engine**. The responsible developer/CI
must actually run each named check and supply its artifact. A digest validates artifact identity and
current files; it cannot prove that a human's claimed result is truthful or that a screenshot is good.
Never use the synthetic unit attestations as real reference/production acceptance.

Evidence JSON has exact schemaVersion, planId, candidateHash, bindingHash and cliVersion; review is
`{approved: true, reviewer: "review identity"}`. Required checks are unit, typecheck, visual-light,
visual-dark, rtl, keyboard and contrast; asset-rights is additionally required when assets exist.
Each check is `{name, passed: true, command, artifact: {path, sha256}}`. Artifacts and the report are
consumer-local under evidence/; hashes use raw bytes. Do not put credentials or private data in reports.

Each task is `{id, status: "implemented", files: [{path, sha256}]}` and must include all required
authored adapter/test paths. Migration/asset tasks require at least one reviewed authored file.
Unknown/duplicate check/task IDs, failed checks, missing tasks/files and changed artifacts refuse
promotion. Re-running checks/code review is the caller's responsibility after any relevant change.
Successful acceptance records the exact candidate/plan/binding/evidence identity. Later check verifies
the accepted outputs, report and referenced current artifacts/authored files; altered evidence fails.
Publication and owner visual approval remain separate gates.

The source regression suite executes all seven commands, semantic behavior/removal/alias scenarios,
safety refusals and isolated acceptance-guard removals. Independent packed-command verification and
real consumer DLS adoption are tracked in the workspace implementation status, not inferred here.

---
name: mpfrontend-reconcile-design-components
description: Reconcile declared added, changed or removed DLS components with MP Frontend consumer adapters and tests using reviewed semantic plans. Not automatic React generation or business-rule inference from Figma.
---

# Reconcile authored component behavior

Requires the reviewed CLI dev.18 cohort, an attached design source and a normalized candidate with explicit interaction evidence.
Read consumer instructions, installed CLI `DESIGN-SYNC.md`, approved source, adapter bindings and
the actual public UI types. Use stable IDs for component identity; display renames do not justify
creating duplicates. Core currently exposes six finite components, not the whole supplied DLS.
Run `design status` before planning; source drift or a pending/disabled source blocks reconciliation.

Run validate/diff/plan for the exact candidate. Inspect variants, props, documented behavior and assets
alongside affected usages. Unknown mapped behavior or unmapped IDs needs a designer/developer decision.
Figma visual/prototype information does not define auth, monetary semantics, validation or API writes.
Do not infer those business rules. Scope authored tasks to the requested product; use neutral exports
and consumer-owned tokens/assets. A missing reusable core behavior needs its own neutral contract/test.

Review the plan before apply. Generated components.gen.json is metadata, never implementation.
Implement approved adapter/interaction changes and regression tests outside owned outputs. For removals,
keep reconciliation bindings until migrations/deprecations are reviewed; do not delete authored code or
extensions automatically. Inspect disabled/loading, pointer/keyboard, focus restoration, errors,
reduced motion and long text as applicable, left to right and right to left, and light/dark/system.

Run actual feature/Nx/visual checks and record current adapter/test hashes in genuine reviewed task
evidence. Unchanged mapped adapters still need matching verification. A CLI evidence digest is not
proof that claimed behavior works; no synthetic fixture attestation may stand in for these runs.
Missing/failed/unimplemented tasks prevent acceptance. Re-plan after source/binding/CLI/output drift.
Promote only when the user authorized acceptance and all required evidence/review passes, then check.

Report mapped scope and unresolved states explicitly. No automatic Figma change, protected business
mutation, deployment or npm/public release authority is included.

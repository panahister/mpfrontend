---
name: mpfrontend-review-design-drift
description: Review an MP Frontend declared design candidate or accepted baseline for semantic, output and evidence drift without applying changes or promoting a baseline.
---

# Review declared design drift

Requires the reviewed CLI dev.18 cohort. Read consumer instructions, installed CLI `DESIGN-SYNC.md`,
accepted source/binding and any supplied candidate's provenance. A review request is read-only:
do not import, persist a plan, apply tokens, edit Figma, run a live write or accept a baseline.
If the candidate is not imported, an explicit import implementation request is a prerequisite.

Begin with the read-only `mpfrontend design status --directory <consumer> --json`. Report disabled or
pending source state as such. For `existing`, source distribution and provenance remain consumer-owned;
binding drift is distinct from candidate/output drift. Do not attach, switch modes or repair files
during a review request.

Run `mpfrontend design check --binding <file> --json` for the accepted declared scope. With a named
candidate, run validate and diff; a plan dry-run can identify affected owned outputs/authored tasks
without writing state. Inspect stable IDs, removals/renames, alias/mode/type changes, component
variants/props/behavior, assets and compatibility severity. Check declared omissions separately:
a token-only export cannot prove that unspecified components are unchanged.

Distinguish source drift from generated-output edits, stale CLI/binding/plans, changed evidence,
unmapped IDs, unknown interaction/rights and another active writer. Baseline import/apply is not
acceptance, and accepted output hashes do not prove a whole design system's visual fidelity.
The CLI checks reviewed artifact identity/current files, not truthfulness of external test claims.

Report the exact source/candidate/CLI identity, observed diagnostics and affected authored paths.
Suggest scoped re-plan, migration, tests or designer review without silently repairing files. Preserve
custom code and a writer's marker; recovery needs inspection and separate authority. Visual/source
conflicts need explicit resolution, not a hidden palette edit. Publication remains a separate gate.

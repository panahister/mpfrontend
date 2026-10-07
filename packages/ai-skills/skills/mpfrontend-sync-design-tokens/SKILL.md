---
name: mpfrontend-sync-design-tokens
description: Plan and apply reviewed light/dark/system token updates from an MP Frontend normalized candidate while preserving authored styles and withholding baseline acceptance until evidence passes.
---

# Synchronize declared consumer tokens

Requires the reviewed CLI dev.18 cohort, an attached design source and a supplied/imported candidate. Read consumer instructions,
installed CLI `DESIGN-SYNC.md`, source provenance and the current accepted binding. The installed
import procedure describes acquisition; no Figma write or automatic watcher is part of this workflow.
Run `design status` first and stop on pending, disabled or drifted source state; do not bypass source
binding verification by invoking lifecycle commands against an unrelated binding.

Validate the exact candidate and inspect semantic diff by stable IDs. Names are not new identities.
Check all declared light/dark values, alias resolution/types, explicit consumer CSS mappings, brand
scope and system mode. Unsupported/unmapped tokens, aliases, missing modes or license issues are
prerequisites, not permission to guess or silently strip declarations. Review removals/renames for
authored usage and compatibility; never delete a custom product extension automatically.

Run `mpfrontend design plan --binding <file> --candidate <hash> --dry-run --json`, then persist a plan
only within implementation scope. Review its output hashes, tasks, diagnostics and required checks.
Apply the reviewed exact path first with dry-run, then through `design apply --plan <path> --json`.
If binding/source/CLI/output hashes changed, re-plan and re-review; there is no force bypass. A busy
or interrupted writer requires inspecting its owner/state before recovery, never age-based deletion.

Wire only the owned generated CSS into consumer composition and keep fonts/icons/structural overrides
authored. Run actual typecheck/unit and light/dark/system, Arabic RTL, keyboard/focus and contrast
checks on affected screens. Do not change source palette/Figma to hide a contrast conflict; record
the source token and reviewed consumer mapping. Preserve identity/preferences/drafts during switching.

Supply genuine reviewed artifacts in the documented evidence schema. CLI verifies identities/digests
but does not execute the reported commands or judge visual quality. Component/asset/migration tasks
remain open until authored code/tests and review satisfy them. Applying tokens is not full-DLS
acceptance. Only a request authorizing promotion allows `design accept`; afterwards run design check.
Report declared scope/results/gaps, and keep publication and owner visual approval separate.

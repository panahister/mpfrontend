---
name: mpfrontend-import-design-system
description: Import a supplied normalized local DLS export as an immutable MP Frontend candidate with source provenance and explicit consumer mappings. Does not change Figma or accept the candidate baseline.
---

# Import a declared design export

Requires MP Frontend CLI dev.18 or the reviewed compatible cohort. Read the consumer instructions,
installed CLI `DESIGN-SYNC.md`, approved source and its distribution limits. Check the actual
`mpfrontend --version`. The CLI consumes a finite normalized export; it does not capture Figma.
Prefer supplied local evidence. If another authorized read connector is available, follow that
connector's instructions; missing access is a prerequisite, not permission to invent source details.

Run `mpfrontend design status --directory <consumer> --json` before import. A pending `existing` source
needs the approved consumer binding attached with `design attach --source existing`. The consumer owns
the Figma/DLS, export, mapping and rights; no public release manifest is accepted in the MVP. A `none`
workspace may transition to `existing` only when the implementation request and supplied provenance
identify a real consumer-owned source. Do not attach merely to make import pass.

Preserve the raw export and digest in the consumer. Record file/node IDs, available source revision,
actual capture/extractor identity and the declared scope. Unknown revision stays null; unavailable
behavior stays unknown. Review any mode/collection/type projection. The current profile supports
light/dark scalar tokens and aliases, declared component variants/properties/behavior and asset
metadata. Unsupported expressions, extra modes or raw export shapes need an explicit adapter/review;
never silently erase them to pass validation. A token-only export is not the complete DLS.

Create a consumer-owned root binding from the documented schema: explicit source IDs to CSS names,
brand/mode selector, adapter/test paths and reasoned exclusions. Keep product assets, snapshots,
fonts and palettes out of neutral core. Unknown asset rights do not become cleared by Figma access.

Run `mpfrontend design import --binding <file> --snapshot <export> --dry-run --json`, inspect its
candidate hash/diagnostics, then import only within the requested implementation scope. Re-import
must preserve immutable bytes. Run validate and diff with that exact candidate; report unmapped
tokens, unknown behavior and unsupported cases. Do not apply or accept a baseline under an import-only
request. Never force over an authored collision or delete another writer's marker.

Report provenance, scope, actual commands and what remains unresolved. No Figma write, watcher,
deployment, package publication or actual agent-parity acceptance follows from an import.

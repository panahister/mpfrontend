# @mpfrontend/ai-skills

Versioned, product-neutral repository workflows installed explicitly by the MP Frontend CLI.
The approved catalog has eighteen finite source procedures. The base profile contains fourteen
implementation, integration, verification, upgrade and release-preparation workflows; the design
profile adds four import/sync/reconcile/review procedures. Availability means a usable procedure for the implemented finite profile,
not complete protected scaffolding, schema widgets, arbitrary locales, DLS coverage or agent parity.
Base installs fourteen; design profile includes all eighteen. Design operations consume a finite reviewed
local export and hashed evidence, not a Figma extractor or test/visual execution engine. The CLI's
packaged DESIGN-SYNC.md defines the exact profile and attestation limits.
The workspace source contract distinguishes a consumer-owned `existing` DLS, a pinned public
`mpfrontend` release and code-first `none`. Skills inspect and preserve that choice; they never switch
it merely to make a workflow pass or publish a private design source.
Installation never runs in npm postinstall and never writes personal/global agent configuration.

`mpfrontend skills list|install|update|check --json` uses the same source for Codex and Claude Code
repository discovery. Installation is idempotent, dry-run performs no writes and locally modified or
unowned skill files cause a collision. AGENTS.md, CLAUDE.md and unrelated skills are preserved.
Format/CLI fixture tests do not establish actual Codex/Claude behavioral equivalence.

Installation holds an exclusive repository-local `skills-install.lock`; a concurrent or interrupted
installation fails closed. Rollback preserves files edited by another agent after replacement and
reports the conflict. This is not a filesystem transaction across a machine crash. If a process dies,
inspect the exact owned files and skills-lock hashes before manually recovering the marker; never
delete a marker belonging to a running process or retry with a force-overwrite flag.

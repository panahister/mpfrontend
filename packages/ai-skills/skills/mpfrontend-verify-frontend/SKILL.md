---
name: mpfrontend-verify-frontend
description: Verify a bounded MP Frontend consumer change using existing Nx and FTG checks plus actual browser evidence. Report readiness gaps without treating a review as authority to fix, deploy or publish.
---

# Verify a bounded change

Requires MP Frontend CLI `0.1.0-dev.18`. Read the consumer's instructions, changed-file scope and
acceptance criteria. A review/diagnosis is read-only apart from normal diagnostic build/test artifacts;
fixes, restarts, business writes and release actions require the corresponding user request.

Check `pnpm exec mpfrontend --version` and `pnpm exec mpfrontend skills check --json`.
Find the actual Nx targets in `project.json`/workspace configuration; do not report success when Nx
says no tasks ran. Run the affected `format:check`, `lint`, `typecheck`, `test`, `build` and
`generated-check` targets uncached where defined, then `pnpm check --skip-nx-cache`. Lint carries the
shared quality profile: module boundaries, no raw colour outside the theme files and no hand-written CSS
outside the theme layer. Report a rule switched off, an `eslint-disable` without a reason or a widened
allowed path as a finding, not as a pass. Verify frozen dependencies, consumer-authored override preservation and
the OpenAPI hash consumed by FTG/Swagger. Missing tests are a gap, not a passing test count.

For UI/API changes, verify the actual deployed surface, response status and failure state. Use the
available browser capability for the required locale/theme/viewport/keyboard states; unavailable
browser evidence stays unverified. Never substitute mock data for a failing real API without labeling
an explicitly approved demo mode. Use synthetic local identities only for authorized test journeys;
do not collect real credentials or real payment/location data.

For protected changes assess server authorization, CSRF/origin checks, stale authority, data projection,
session/store outage and realtime recovery as relevant. UI visibility is not an authorization boundary.
Record a failing control for the safety property being tested. Preserve unsaved drafts in recovery.

Report exact commands/counts, observed browser/API evidence and remaining acceptance gates.
Passing a build does not establish production HA, security, full journey acceptance or distribution
rights. Preparation and review never authorize GitHub/npm publication.

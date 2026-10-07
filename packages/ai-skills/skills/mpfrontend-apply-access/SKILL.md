---
name: mpfrontend-apply-access
description: Apply an approved capability and field/action visibility matrix to an MP Frontend consumer while preserving server authority and stale-response safety. Use after roles, resources and grants are defined elsewhere.
---

# Apply approved access decisions

Requires the reviewed MP Frontend CLI `0.1.0-dev.18` cohort and `@mpfrontend/access-core`. Read the
approved capability catalog, persona/tenant matrix and consumer instructions. Do not create roles,
resources, permissions or grants and do not infer authority from a sample identity.

Keep backend or BFF enforcement authoritative. UI guards control presentation only and never turn a
hidden control into an authorization boundary. Map each approved page, action, record and field rule to
an explicit capability decision; choose hidden versus disabled behavior from the approved UX, not by
guessing.

Wrap protected asynchronous reads in `AuthorityFence`. Its context identity must distinguish subject,
tenant, effective role/capability revision and session so results captured under an older authority
cannot publish into a newer view. On identity/tenant/role changes, invalidate protected caches and
realtime subscriptions without destroying safe unsaved drafts.

Test unauthenticated, forbidden, permitted, tenant-isolated, stale-token, refreshed-token, revoked-role
and delayed-response cases. Include a failing control that proves removing the fence or server check
would expose the defect. Exercise the actual browser surface for every approved persona and verify the
API still refuses direct unauthorized requests.

Report the exact matrix covered, commands/counts and unresolved policy decisions. This skill does not
authorize identity-administration writes, production policy changes, deployment or publication.

# @mpfrontend/access-core

Local development package. Runtime: universal. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

`AuthorityFence` aborts in-flight browser work and rejects stale publication after a consumer-owned
authority identity changes. Capture before starting a request and assert again immediately before
publishing its result. Identical context refreshes preserve work; switching away and back does not
resurrect an old response. Consumers choose the identity (subject, tenant, role revision/session).
This is a UI isolation guard, not permission enforcement; it cannot recall an upstream mutation.

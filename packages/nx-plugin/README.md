# @mpfrontend/nx-plugin

Local development package. Runtime: tooling. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

`createWorkspace`/`workspaceFiles` implement the CLI `init` shell. `createApplication`/`applicationFiles`
implement the catalog application template. These functions refuse existing destinations rather than
merging into user files. Creation is not a filesystem transaction: a write failure can leave an owned
partial **new** directory to inspect, never automatically delete or overwrite. Dry-run writes nothing.
Workspace initialization does not invent an API/DLS, authorization, runtime profile, Git history or
deployment. It records one explicit design-source mode: `none` (disabled/code-first) or `existing`
(pending consumer-owned DLS attachment). The MVP does not ship or require a public Figma DLS. No mode
reads or writes Figma. The independently installed packed CLI now creates the verification workspace itself;
the harness supplies only local unpublished-artifact overrides and an explicit synthetic API fixture.

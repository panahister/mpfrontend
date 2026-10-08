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

`workspaceFiles` writes the quality profile of a new workspace: root `eslint.config.mjs` and
`prettier.config.mjs` that re-export `@mpfrontend/workspace-config`, a `.prettierignore` for tool-owned,
hash-bound and generated files, `nx.json` target defaults with caching for `build`, `typecheck`, `lint`,
`test` and `format:check`, a `check` script (format check, then lint, typecheck, test, build and
generated-check of every project), the CI-neutral `tools/ci/check.sh` and a GitHub Actions workflow that
runs it. `applicationFiles` gives every app `format`, `format:check`, `lint` and `test` targets, an
`eslint.config.mjs` that spreads the workspace profile, a `tsconfig.json` that extends
`@mpfrontend/workspace-config/tsconfig/next.json`, a Tailwind CSS v4 PostCSS entry, and a global style
entry that holds only imports and base element rules. Every generated file is formatted with the shared
profile for the shortest and the longest valid names, and the generated app passes the shared lint rules;
both are tested.

An existing workspace adopts the profile through the `mpfrontend-upgrade-project` procedure: create a
scratch workspace and app with the upgraded CLI outside the repository, copy the profile files and pinned
dependencies from it, add the four targets to each project, run `pnpm format` once in a separate
formatting-only change, and then make `pnpm check` pass without weakening a rule.

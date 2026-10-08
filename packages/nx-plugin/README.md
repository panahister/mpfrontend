# @mpfrontend/nx-plugin

Local development package. Runtime: tooling. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

`createWorkspace`/`workspaceFiles` implement the CLI `init` shell. `createApplication`/`applicationFiles`
implement the application template. `createFeature`/`featureFiles`, `createRoute`/`routeFiles` and
`createPackage`/`packageFiles` implement `mpfrontend create feature|route|package`, and the Nx generators
`application`, `feature`, `route` and `package` in `generators.json` write the same files through the
Nx tree. The template's catalog example is the output of the feature generator (a list feature over the
generated `catalog` read) and of the route generator (`/catalog` and `/catalog/[position]`). These functions refuse existing destinations rather than
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

A feature is `src/features/<feature>/` with `ui/`, `model/`, `hooks/`, `api/`, `utils/` and an `index.ts`
public entry; a list feature also writes its entity in `src/entities/<resource>/` and its server boundary
in `src/api/server/<resource>.ts` when they do not exist, and keeps them when they do. A route is one
thin `page.tsx` that renders a feature screen with the route's base path. A package has the tags
`type:package`, `scope:shared` and `runtime:<runtime>`, a public entry and the quality targets. Every
generator validates names and paths, refuses an existing destination and formats its output with the
workspace's Prettier configuration (the CLI resolves Prettier from the workspace root; the Nx generators
use `formatFiles`). Generated contracts default to `src/api/generated/<contract>`; an existing app's
feature-local output stays valid. Init also writes `CODEOWNERS` with placeholder owners and
`.agents/skills/README.md`; create app writes `.env.example` (names only) and `docs/`. See
[the CLI guide](../../docs/CLI-GUIDE.md).

Every visible text of the application template is a catalog message: the app-wide set in
`src/i18n/messages/<locale>.ts` and one set per feature in `model/messages/<locale>.ts`. The template ships
English only (`en`, the default); the product adds its own locales, left to right or right to left, to the
registry in `src/config/app.ts` and a catalog per added locale to every set, or makes its own locale the
default and only locale. The app's `catalog-check` target runs `mpfrontend catalog check`. A generated
feature gets a catalog per locale of the app's registry, with the default locale's catalog as the base;
locales other than the default start with the default text and are reported as `untranslated`. A list
feature shows booleans with its own `yes` and `no` messages.

The application template is framed by `@mpfrontend/app-layout` and compiles Tailwind CSS v4 with the UI
and shell outputs as sources. `src/app/globals.css` imports Tailwind, the neutral tokens, the component
styles and, last, the app theme `src/theme/theme.css`; it holds no class rule. Upgrade note: apps created
before this template keep their own `globals.css` with the `.mp-shell`, `.mp-controls`, `.mp-status` and
`.mp-alert` classes, which were template classes, not a contract of `@mpfrontend/ui`. Such an app adopts
the shell by adding `@mpfrontend/app-layout`, importing its CSS from the global stylesheet, wrapping the
layout in `AppFrame` and each screen in `PageFrame`, and replacing those classes with utility classes.
The `.mp-*` classes of the UI components are unchanged.

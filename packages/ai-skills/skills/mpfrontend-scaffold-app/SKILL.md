---
name: mpfrontend-scaffold-app
description: Create an independent MP Frontend Next.js app with the installed CLI and verify its Nx build and generated API boundaries. Does not initialize a production deployment or invent product configuration.
---

# Scaffold an app

Requires MP Frontend CLI `0.1.0-dev.18` and the compatible packaged Nx plugin. Read the consumer's
repository instructions before changing files; this skill grants no release or external-write authority.

Obtain the app name, new destination and an approved local OpenAPI projection. Do not choose a
product DLS, identity provider, role catalog or backend endpoint. Confirm `pnpm exec mpfrontend
--version`; unsupported versions need a bounded upgrade decision, not guessed flags.

Run `pnpm exec mpfrontend create app --name <name> --directory <new-directory> --dry-run --json`.
Inspect the proposed paths and run without `--dry-run` only within the user's implementation request.
An existing destination is a collision; never remove it or use a force overwrite to make scaffolding pass.

For an existing pnpm/Nx workspace, preserve its configuration and register its app glob only if missing.
For an explicitly requested new product workspace, choose the design-source contract from evidence:
`existing` for any consumer-owned DLS or `none` for a code-first product. The MVP does not ship or
require a public Figma Community DLS. Do not silently default a known design-backed
product to another source. Use `mpfrontend init --name <workspace-name> --directory
<new-workspace-directory> --design-source <existing|none> --dry-run --json`, inspect its paths, then apply the command
without dry-run only within the implementation request. The destination must not exist; do not
remove/overwrite it on refusal. Init does not install packages or configure a protected runtime.
Never initialize Git, deploy, publish or access/write Figma merely because scaffolding was requested.

For `existing`, report the pending state until an approved consumer binding is attached. For `none`,
continue code-first without pretending design acceptance. `design status` verifies the
recorded choice but neither imports a snapshot nor approves a baseline.

Place the approved contract at the path named by the
generated `ftg.config.json`; never fabricate business fields. Install dependencies and validate a frozen
install, then run the app's actual Nx `build`, `typecheck` and `generated-check` targets uncached.

Create app writes one list route and one detail route over the catalog example, a `preferences`
feature, `.env.example` with variable names only and `docs/overview.md` and `docs/api-contracts.md`;
init writes `CODEOWNERS` with placeholder owners and `.agents/skills/README.md`, the guide for the
workspace's own `project-*` and `domain-*` skills. Report the placeholder owners as a follow-up for the
user; never fill in real owners or environment values yourself. Add features, routes and shared packages
with `mpfrontend create feature`, `create route` and `create package`; see the CLI guide for what each
writes and refuses.

The app frame comes from `@mpfrontend/app-layout` (skip link, header, navigation slot, page frame); the
template passes its own navigation items. `src/app/globals.css` holds only imports and base element
rules: Tailwind v4, the UI and shell sources, the neutral tokens, the component styles and, last, the app
theme file `src/theme/theme.css`. Apps created before the shell keep their own stylesheet; moving them
to the shell replaces their hand-written layout classes with the shell components and utility classes.

Init writes the quality profile: root `eslint.config.mjs` and `prettier.config.mjs` that re-export
`@mpfrontend/workspace-config`, a `check` script, `tools/ci/check.sh` and a GitHub Actions workflow that
runs it. Create app gives the app `format`, `format:check`, `lint` and `test` targets and an app
`eslint.config.mjs` that spreads the workspace profile. Run `pnpm check --skip-nx-cache` on the new
workspace; it runs the format check, lint, typecheck, test, build, generated-check and catalog-check. A
lint failure on
module boundaries, raw colours, hand-written CSS or a physical left or right is fixed in the code, never by
switching a rule off.

Inspect exports and imports: the new app must consume published/packed core packages and its own
authored code, not the platform source checkout or a sample-only Nx target. Preserve authored
overrides and demonstrate FTG regeneration/check. Report the commands and observed output; a
generated directory alone is not a working app. If consumer libraries export build outputs, keep their
Nx graph edges and the app build's explicit `^build` prerequisite; a project-level dependsOn array
replaces the root default. Verify from an isolated checkout without pre-existing library dist so a
local build cannot conceal incorrect task ordering. Declare library dist as an Nx output for restore.
Missing contract or workspace configuration is a
specific prerequisite, not permission to invent production infrastructure.

---
name: mpfrontend-prepare-release
description: Prepare a bounded MP Frontend source and package cohort for release by proving clean-consumer installation, packed contents, API policy and reference gates, then hand the owner the release workflow's rehearsal. Stops before commit, tag, push, registry, deployment or Figma publication.
---

# Prepare release evidence

Obtain the approved release scope, versions, package/repository names, license choice, distribution
rights and acceptance criteria. A missing license, private asset right or repository name is a blocker,
not a default for the agent to choose. Read all repository instructions and inspect existing changes;
do not absorb unrelated work into the candidate.

Verify source for credentials/private keys, personal/product-only data, private design-library links,
provenance gaps and undeclared local dependencies. Run frozen installation plus the actual Nx `lint`,
`typecheck`, `test` and `build` gates, generated/design drift checks and repository skill validation.
Pack the declared cohort and inspect every manifest, export, executable and file list. Packed manifests
must contain no `workspace:` or checkout-only dependency and each immutable version must identify one
content set.

Install the packed artifacts into a fresh independent consumer and exercise real CLI init, skill
install/check, scaffold, FTG generation/drift, security/realtime controls and consumer build. Exercise
both MVP design-source init contracts. Prove `none` remains usable and `existing` attaches a
consumer-owned binding without public-release metadata. Prove the deferred `mpfrontend` public-template
mode is rejected rather than advertised without a shipped Community DLS. Run the approved
reference applications' artifact verification, frozen install and full gates. Confirm a clean-clone
consumer has an obtainable dependency path; ignored local tarballs alone are not a public release
strategy. Keep advisory-service uploads opt-in and report them as not run when unauthorized.

MP Frontend releases one cohort version for every package: the version that the root `package.json` and every
package declare, with every framework pin (the app template, the Nx plugin's cohort, the AI procedures) equal to it;
`node tools/distribution/release.mjs guard --version <v> --ref <ref>` and its `self-test` prove this offline. A version
the registry already holds is never built again: a corrected build takes the next version, and a bad version is
deprecated, never unpublished. Check the API against the policy of README "Versioning" with `pnpm check` (the
`api-check` of every package's `api-report.json`) and, once a version is published, `node
tools/distribution/api-report.mjs registry`; while the major version is 0 a break needs a new minor version and
release notes that say how to move. Run `pnpm exec nx run distribution:registry-install` for the scope binding and
the exact pins against throw-away local registries. The owner then runs the release workflow
(`.github/workflows/release.yml`) without `publish` as a rehearsal, and with it only on main, as
docs/RELEASE-GUIDE.md describes.

Produce the exact candidate file/package/version list, hashes, commands/counts, known limitations and
separately named production gates such as HA/TLS/load/accessibility/security review. For a protected
deployment, show that the Security BFF and the presentation server start with their production profiles
in the target environment and record any `PRODUCTION_PROFILE_REFUSED:` reason as an open gate. Do not convert POC
evidence into a production claim.

Stop before `git init`, commit, tag, push, pull request, registry upload, a run of the release workflow,
deployment, release creation, Figma write/publication or baseline acceptance. Never publish from a workstation,
create an npm token or organization, or change a trusted-publisher or environment setting. Show the owner what would
be published and obtain explicit authority for each external action.

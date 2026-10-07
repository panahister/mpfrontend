---
name: mpfrontend-prepare-release
description: Prepare a bounded MP Frontend source and package cohort for release by proving clean-consumer installation, packed contents and reference gates. Stops before commit, tag, push, registry, deployment or Figma publication.
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

Produce the exact candidate file/package/version list, hashes, commands/counts, known limitations and
separately named production gates such as HA/TLS/load/accessibility/security review. Do not convert POC
evidence into a production claim.

Stop before `git init`, commit, tag, push, pull request, registry upload, deployment, release creation,
Figma write/publication or baseline acceptance. Show the owner what would be published and obtain
explicit authority for each external action.
